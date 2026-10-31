const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

// Metas: meta mensal (mínimo a distribuir), metas individuais por dia, redistribuição manual e
// "Voltar ao automático". Nenhuma meta é alterada sem ação explícita do usuário e dias passados são protegidos.
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const ORIGINS = new Set(['manual', 'redistribuicao', 'automatico']);
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'America/Sao_Paulo';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const sendError = (res, error, fallback) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, ...error.extra });
  console.error('[summary-goals]', error);
  return res.status(500).json({ error: fallback });
};

const roundCents = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseMonthKey = (value) => {
  const monthKey = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) ? monthKey : '';
};

const daysInMonth = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
};

const parseDay = (value, monthKey) => {
  const day = Number(value);
  const max = monthKey ? daysInMonth(monthKey) : 31;
  if (!Number.isInteger(day) || day < 1 || day > max) return null;
  return day;
};

const parseGoal = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const goal = Number(value);
  return Number.isFinite(goal) && goal >= 0 ? roundCents(goal) : null;
};

// "Hoje" no fuso do usuário (o servidor pode estar em UTC).
const getToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateOf = (monthKey, day) => `${monthKey}-${String(day).padStart(2, '0')}`;
const nullableNumber = (value) => (value === null || value === undefined ? null : Number(value));
const isTrue = (value) => value === true || value === 1 || value === '1';

const loadDayRows = async (client, userId, month) => {
  const result = await client.query(
    `SELECT day_of_month, goal, day_off, goal_origin, settled_done, settled_goal
     FROM summary_daily_goals WHERE user_id = $1 AND year_month = $2 ORDER BY day_of_month ASC`,
    [userId, month]
  );
  const byDay = new Map();
  (result.rows || []).forEach((row) => {
    byDay.set(Number(row.day_of_month), {
      goal: nullableNumber(row.goal),
      dayOff: isTrue(row.day_off),
      origin: row.goal_origin || null,
      settledDone: nullableNumber(row.settled_done),
      settledGoal: nullableNumber(row.settled_goal)
    });
  });
  return byDay;
};

// Realizado por dia = receitas dos registros diários (mesma fonte do card "Fiz" da página).
const loadDoneByDay = async (client, userId, month) => {
  const result = await client.query(
    `SELECT SUBSTRING(date FROM 1 FOR 10) AS day_date, SUM(COALESCE(income_value, 0)) AS total
     FROM records WHERE user_id = $1 AND date LIKE $2
     GROUP BY SUBSTRING(date FROM 1 FOR 10)`,
    [userId, `${month}%`]
  );
  const done = {};
  (result.rows || []).forEach((row) => {
    const day = Number(String(row.day_date).slice(8, 10));
    if (day) done[day] = roundCents(row.total);
  });
  return done;
};

// Disponível = hoje ou futuro, sem folga e ainda sem resultado lançado.
const isAvailableDay = (month, day, saved, doneByDay, today) => {
  if (saved?.dayOff || doneByDay[day] > 0) return false;
  return dateOf(month, day) >= today;
};

const upsertDay = (client, userId, month, day, { goal, dayOff, origin }) => client.query(
  `INSERT INTO summary_daily_goals (user_id, year_month, day_of_month, goal, day_off, goal_origin)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (user_id, year_month, day_of_month)
   DO UPDATE SET goal = EXCLUDED.goal, day_off = EXCLUDED.day_off, goal_origin = EXCLUDED.goal_origin, updated_at = NOW()`,
  [userId, month, day, goal, Boolean(dayOff), goal === null ? null : origin]
);

// Confere se as metas atuais ainda são as que o usuário viu na prévia (evita sobrescrever alterações concorrentes).
const assertExpectedGoals = (byDay, expected = {}) => {
  Object.entries(expected || {}).forEach(([dayKey, value]) => {
    const current = byDay.get(Number(dayKey))?.goal ?? null;
    const shown = value === null || value === undefined ? null : roundCents(value);
    if ((current === null ? null : roundCents(current)) !== shown) {
      throw new HttpError(409, `A meta do dia ${String(dayKey).padStart(2, '0')} mudou. Atualize a página e revise antes de confirmar.`);
    }
  });
};

const loadMonthly = async (client, userId, month) => {
  const result = await client.query(
    'SELECT goal, confirmed_at, confirmed_total FROM summary_monthly_goals WHERE user_id = $1 AND year_month = $2',
    [userId, month]
  );
  const row = result.rows && result.rows[0];
  return row
    ? { goal: Number(row.goal), confirmedAt: row.confirmed_at || null, confirmedTotal: nullableNumber(row.confirmed_total) }
    : null;
};

const buildPayload = async (client, userId, month) => {
  const [byDay, monthly, doneByDay] = await Promise.all([
    loadDayRows(client, userId, month),
    loadMonthly(client, userId, month),
    loadDoneByDay(client, userId, month)
  ]);
  const days = {};
  byDay.forEach((value, day) => {
    days[String(day)] = {
      goal: value.goal === null ? undefined : value.goal,
      dayOff: value.dayOff,
      origin: value.origin,
      settledDone: value.settledDone,
      settledGoal: value.settledGoal
    };
  });
  return { month, today: getToday(), days, monthly, doneByDay };
};

const dbClient = { query: (sql, params) => db.query(sql, params) };

router.get('/:month', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  if (!month) return res.status(400).json({ error: 'Mês inválido.' });
  try {
    return res.json(await buildPayload(dbClient, req.session.userId, month));
  } catch (error) {
    return sendError(res, error, 'Falha ao carregar metas diárias.');
  }
});

// Meta mensal (salva no banco; alterar a meta exige nova confirmação da distribuição).
router.put('/:month/monthly', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  const goal = parseGoal(req.body?.goal);
  if (!month) return res.status(400).json({ error: 'Mês inválido.' });
  if (!goal || goal <= 0) return res.status(400).json({ error: 'Informe uma meta mensal maior que zero.' });
  try {
    await db.query(
      `INSERT INTO summary_monthly_goals (user_id, year_month, goal)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, year_month)
       DO UPDATE SET goal = EXCLUDED.goal, confirmed_at = NULL, confirmed_total = NULL, updated_at = NOW()`,
      [req.session.userId, month, goal]
    );
    return res.json(await buildPayload(dbClient, req.session.userId, month));
  } catch (error) {
    return sendError(res, error, 'Falha ao salvar meta mensal.');
  }
});

// Confirmação da distribuição: só quando a soma das metas diárias (sem folgas) alcança a meta mensal.
router.post('/:month/confirm', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  if (!month) return res.status(400).json({ error: 'Mês inválido.' });
  try {
    const payload = await db.withTransaction(async (client) => {
      const monthly = await loadMonthly(client, req.session.userId, month);
      if (!monthly) throw new HttpError(400, 'Salve a meta mensal antes de confirmar a distribuição.');
      const byDay = await loadDayRows(client, req.session.userId, month);
      let distributed = 0;
      byDay.forEach((value) => {
        if (!value.dayOff && value.goal !== null) distributed += value.goal;
      });
      distributed = roundCents(distributed);
      if (distributed < monthly.goal) {
        const missing = roundCents(monthly.goal - distributed);
        throw new HttpError(400, `Faltam ${missing.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para distribuir.`, { missing, distributed });
      }
      await client.query(
        'UPDATE summary_monthly_goals SET confirmed_at = NOW(), confirmed_total = $1, updated_at = NOW() WHERE user_id = $2 AND year_month = $3',
        [distributed, req.session.userId, month]
      );
      return buildPayload(client, req.session.userId, month);
    });
    return res.json(payload);
  } catch (error) {
    return sendError(res, error, 'Falha ao confirmar a distribuição.');
  }
});

// Marca a diferença do dia como tratada sem redistribuir (usuário escolheu manter as metas).
router.post('/:month/settle', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  const day = parseDay(req.body?.day, month);
  if (!month || !day) return res.status(400).json({ error: 'Data inválida.' });
  try {
    const payload = await db.withTransaction(async (client) => {
      const byDay = await loadDayRows(client, req.session.userId, month);
      const saved = byDay.get(day);
      if (!saved || saved.goal === null) throw new HttpError(400, 'Este dia não tem meta definida.');
      const doneByDay = await loadDoneByDay(client, req.session.userId, month);
      await client.query(
        `UPDATE summary_daily_goals SET settled_done = $1, settled_goal = $2, updated_at = NOW()
         WHERE user_id = $3 AND year_month = $4 AND day_of_month = $5`,
        [roundCents(doneByDay[day] || 0), saved.goal, req.session.userId, month, day]
      );
      return buildPayload(client, req.session.userId, month);
    });
    return res.json(payload);
  } catch (error) {
    return sendError(res, error, 'Falha ao registrar a decisão.');
  }
});

// Redistribuição manual confirmada: aplica somente os ajustes escolhidos pelo usuário em dias futuros.
router.post('/:month/redistribute', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  const sourceDay = parseDay(req.body?.source_day, month);
  const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
  if (!month || !sourceDay) return res.status(400).json({ error: 'Data inválida.' });
  if (!allocations.length) return res.status(400).json({ error: 'Informe pelo menos um dia para redistribuir.' });

  try {
    const payload = await db.withTransaction(async (client) => {
      const userId = req.session.userId;
      const today = getToday();
      const [byDay, doneByDay] = await Promise.all([loadDayRows(client, userId, month), loadDoneByDay(client, userId, month)]);
      const source = byDay.get(sourceDay);
      const done = roundCents(doneByDay[sourceDay] || 0);
      if (!source || source.goal === null || done <= 0 || done === source.goal) {
        throw new HttpError(409, 'Não há diferença pendente neste dia. Atualize a página.');
      }
      if (source.settledDone === done && source.settledGoal === source.goal) {
        throw new HttpError(409, 'Esta diferença já foi tratada.');
      }
      const difference = roundCents(source.goal - done);
      const sign = difference > 0 ? 1 : -1;
      assertExpectedGoals(byDay, req.body?.expected_goals);

      let distributed = 0;
      const changes = [];
      const seen = new Set();
      allocations.forEach((item) => {
        const day = parseDay(item?.day, month);
        const amount = roundCents(item?.amount);
        if (!day || seen.has(day)) throw new HttpError(400, 'Dia inválido na redistribuição.');
        seen.add(day);
        if (!(amount > 0)) throw new HttpError(400, 'Informe valores positivos.');
        const saved = byDay.get(day);
        if (!isAvailableDay(month, day, saved, doneByDay, today)) {
          throw new HttpError(400, `O dia ${String(day).padStart(2, '0')} não está disponível (passado, com resultado ou folga).`);
        }
        const from = roundCents(saved?.goal || 0);
        const to = roundCents(from + sign * amount);
        if (to < 0) throw new HttpError(400, `A meta do dia ${String(day).padStart(2, '0')} não pode ficar negativa.`);
        distributed = roundCents(distributed + amount);
        changes.push({ day, from, to });
      });
      if (distributed > Math.abs(difference)) throw new HttpError(400, 'O total informado é maior que o valor a redistribuir.');

      for (const change of changes) {
        await upsertDay(client, userId, month, change.day, { goal: change.to, dayOff: false, origin: 'redistribuicao' });
      }
      await client.query(
        `UPDATE summary_daily_goals SET settled_done = $1, settled_goal = $2, updated_at = NOW()
         WHERE user_id = $3 AND year_month = $4 AND day_of_month = $5`,
        [done, source.goal, userId, month, sourceDay]
      );
      await client.query(
        `INSERT INTO goal_redistributions (user_id, year_month, source_day, kind, amount, changes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, month, sourceDay, sign > 0 ? 'falta' : 'excedente', distributed, JSON.stringify(changes)]
      );
      return buildPayload(client, userId, month);
    });
    return res.json(payload);
  } catch (error) {
    return sendError(res, error, 'Falha ao aplicar a redistribuição.');
  }
});

// "Voltar ao automático" confirmado: grava a prévia aceita. Dias com meta individual/redistribuída só
// são sobrescritos com autorização explícita (overwrite_protected).
router.post('/:month/auto', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  const overwriteProtected = req.body?.overwrite_protected === true;
  if (!month) return res.status(400).json({ error: 'Mês inválido.' });
  if (!assignments.length) return res.status(400).json({ error: 'Não há dias disponíveis para distribuir.' });

  try {
    const payload = await db.withTransaction(async (client) => {
      const userId = req.session.userId;
      const today = getToday();
      const [byDay, doneByDay] = await Promise.all([loadDayRows(client, userId, month), loadDoneByDay(client, userId, month)]);
      assertExpectedGoals(byDay, req.body?.expected_goals);
      const changes = [];
      const seen = new Set();
      assignments.forEach((item) => {
        const day = parseDay(item?.day, month);
        const goal = parseGoal(item?.goal);
        if (!day || seen.has(day) || goal === null) throw new HttpError(400, 'Distribuição inválida.');
        seen.add(day);
        const saved = byDay.get(day);
        if (!isAvailableDay(month, day, saved, doneByDay, today)) {
          throw new HttpError(400, `O dia ${String(day).padStart(2, '0')} não está disponível (passado, com resultado ou folga).`);
        }
        const isProtected = saved && saved.goal !== null && (saved.origin || 'manual') !== 'automatico';
        if (isProtected && !overwriteProtected) {
          throw new HttpError(409, `O dia ${String(day).padStart(2, '0')} tem meta individual ou redistribuída. Confirme a substituição.`);
        }
        changes.push({ day, from: saved?.goal ?? null, to: goal });
      });
      for (const change of changes) {
        await upsertDay(client, userId, month, change.day, { goal: change.to, dayOff: false, origin: 'automatico' });
      }
      await client.query(
        `INSERT INTO goal_redistributions (user_id, year_month, source_day, kind, amount, changes)
         VALUES ($1, $2, NULL, 'automatico', $3, $4)`,
        [userId, month, roundCents(changes.reduce((sum, change) => sum + change.to, 0)), JSON.stringify(changes)]
      );
      return buildPayload(client, userId, month);
    });
    return res.json(payload);
  } catch (error) {
    return sendError(res, error, 'Falha ao aplicar a distribuição automática.');
  }
});

// Meta individual do dia e folga. Metas de dias passados não podem ser alteradas.
router.put('/:month/:day', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  const day = parseDay(req.params.day, month);
  if (!month || !day) return res.status(400).json({ error: 'Data inválida.' });

  const hasGoal = req.body && Object.prototype.hasOwnProperty.call(req.body, 'goal');
  const goal = parseGoal(req.body?.goal);
  const dayOff = Boolean(req.body?.dayOff);
  const origin = ORIGINS.has(req.body?.origin) ? req.body.origin : 'manual';

  try {
    const payload = await db.withTransaction(async (client) => {
      const userId = req.session.userId;
      const byDay = await loadDayRows(client, userId, month);
      const saved = byDay.get(day) || null;
      const currentGoal = saved?.goal ?? null;
      const nextGoal = hasGoal ? goal : currentGoal;
      const goalChanged = (nextGoal === null ? null : roundCents(nextGoal)) !== (currentGoal === null ? null : roundCents(currentGoal));

      if (goalChanged && dateOf(month, day) < getToday()) {
        throw new HttpError(409, 'Metas de dias passados não podem ser alteradas.');
      }

      if (!dayOff && nextGoal === null) {
        await client.query(
          'DELETE FROM summary_daily_goals WHERE user_id = $1 AND year_month = $2 AND day_of_month = $3',
          [userId, month, day]
        );
      } else {
        await upsertDay(client, userId, month, day, {
          goal: nextGoal,
          dayOff,
          origin: goalChanged ? origin : (saved?.origin || 'manual')
        });
      }
      return buildPayload(client, userId, month);
    });
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, 'Falha ao salvar meta diária.');
  }
});

module.exports = router;
