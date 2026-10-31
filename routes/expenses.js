const crypto = require('crypto');
const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const schedule = require('../utils/expense-schedule');

// Módulo de Despesas: programação (personal_expenses) + ocorrências mensais independentes (expense_occurrences).
// Toda operação afeta somente o escopo escolhido; ocorrências pagas nunca são apagadas automaticamente.
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const DEFAULT_CATEGORIES = [
  { value: 'Alimentacao', label: 'Alimentação' },
  { value: 'Casa', label: 'Casa' },
  { value: 'Servicos', label: 'Serviços' },
  { value: 'Carro', label: 'Carro' },
  { value: 'Emprestimo', label: 'Empréstimo' },
  { value: 'Dividas', label: 'Dívidas' },
  { value: 'Renegociacao de dividas', label: 'Renegociação de dívidas' },
  { value: 'Educacao', label: 'Educação' },
  { value: 'Corte de cabelo', label: 'Corte de cabelo' },
  { value: 'Presentes', label: 'Presentes' },
  { value: 'Lazer', label: 'Lazer' },
  { value: 'Gastos extras', label: 'Gastos extras' },
  { value: 'Saude', label: 'Saúde' },
  { value: 'Internet', label: 'Internet' },
  { value: 'Outros', label: 'Outros' }
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sendError = (res, error, fallback) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  console.error('[expenses]', error);
  return res.status(500).json({ error: fallback });
};

const firstRow = async (client, sql, params) => {
  const result = await client.query(sql, params);
  return (result.rows && result.rows[0]) || null;
};

const nowIso = () => new Date().toISOString();
const cleanText = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

const requireOccurrenceRef = (body = {}) => {
  const seriesKey = String(body.series_key || '').trim();
  const originMonth = String(body.origin_month || '').trim();
  if (!seriesKey || !schedule.isMonthKey(originMonth)) throw new HttpError(400, 'Lançamento inválido.');
  return { seriesKey, originMonth };
};

const findSeries = (client, userId, seriesKey) => firstRow(
  client,
  "SELECT * FROM personal_expenses WHERE user_id = $1 AND entry_key = $2 AND COALESCE(type, 'saida') = 'saida'",
  [userId, seriesKey]
);

// Garante que a ocorrência (série + mês de origem) exista como registro próprio e a retorna.
const materializeOccurrence = async (client, userId, seriesKey, originMonth) => {
  const existing = await firstRow(
    client,
    'SELECT * FROM expense_occurrences WHERE user_id = $1 AND series_key = $2 AND origin_month = $3',
    [userId, seriesKey, originMonth]
  );
  if (existing) return existing;

  const series = await findSeries(client, userId, seriesKey);
  if (!series || !schedule.isScheduledInMonth(series, originMonth)) throw new HttpError(404, 'Lançamento não encontrado.');

  const occurrence = schedule.buildOccurrenceFromSeries(series, originMonth);
  return firstRow(
    client,
    `INSERT INTO expense_occurrences (
      user_id, series_key, origin_month, competence_month, description, category, amount, due_date,
      status, paid_at, notes, installment_label, recurrence, is_deleted, transfer_history
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *`,
    [
      userId, occurrence.series_key, occurrence.origin_month, occurrence.competence_month, occurrence.description,
      occurrence.category, occurrence.amount, occurrence.due_date, occurrence.status,
      occurrence.status === 'pago' ? nowIso() : null, occurrence.notes || null, occurrence.installment_label || null,
      occurrence.recurrence, false, '[]'
    ]
  );
};

const isDeletedRow = (row) => row.is_deleted === true || row.is_deleted === 1 || row.is_deleted === '1';

const saveOccurrence = (client, userId, row) => firstRow(
  client,
  `UPDATE expense_occurrences
   SET description = $1, category = $2, amount = $3, due_date = $4, competence_month = $5, status = $6,
       paid_at = $7, notes = $8, transfer_history = $9, is_deleted = $10, updated_at = NOW()
   WHERE id = $11 AND user_id = $12
   RETURNING *`,
  [
    row.description, row.category, row.amount, row.due_date, row.competence_month, row.status,
    row.paid_at || null, row.notes || null, JSON.stringify(row.transfer_history || []), Boolean(row.is_deleted),
    row.id, userId
  ]
);

const loadMonth = async (userId, month) => {
  const [seriesList, rows] = await Promise.all([
    db.all('SELECT * FROM personal_expenses WHERE user_id = $1', [userId]),
    db.all(
      'SELECT * FROM expense_occurrences WHERE user_id = $1 AND (competence_month = $2 OR origin_month = $2)',
      [userId, month]
    )
  ]);
  const items = schedule.buildMonthView(seriesList || [], rows || [], month);
  return { month, items, summary: schedule.summarize(items) };
};

// ---------- Consulta ----------
router.get('/month/:month', async (req, res) => {
  const month = String(req.params.month || '');
  if (!schedule.isMonthKey(month)) return res.status(400).json({ error: 'Mês inválido.' });
  try {
    return res.json(await loadMonth(req.session.userId, month));
  } catch (error) {
    return sendError(res, error, 'Falha ao carregar despesas do mês.');
  }
});

// ---------- Categorias ----------
const listCategories = async (userId) => {
  const [custom, used] = await Promise.all([
    db.all('SELECT name FROM expense_categories WHERE user_id = $1 ORDER BY name ASC', [userId]),
    db.all(
      `SELECT DISTINCT category FROM personal_expenses
       WHERE user_id = $1 AND COALESCE(type, 'saida') = 'saida' AND category IS NOT NULL`,
      [userId]
    )
  ]);
  const categories = [...DEFAULT_CATEGORIES];
  const known = new Set(categories.flatMap((item) => [item.value.toLowerCase(), item.label.toLowerCase()]));
  [...(custom || []).map((row) => row.name), ...(used || []).map((row) => row.category)].forEach((name) => {
    const value = cleanText(name, 40);
    if (!value || known.has(value.toLowerCase())) return;
    known.add(value.toLowerCase());
    categories.push({ value, label: value });
  });
  return categories;
};

router.get('/categories', async (req, res) => {
  try {
    return res.json(await listCategories(req.session.userId));
  } catch (error) {
    return sendError(res, error, 'Falha ao carregar categorias.');
  }
});

router.post('/categories', async (req, res) => {
  const name = cleanText(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Informe o nome da categoria.' });
  try {
    const categories = await listCategories(req.session.userId);
    const existing = categories.find((item) => item.value.toLowerCase() === name.toLowerCase() || item.label.toLowerCase() === name.toLowerCase());
    if (existing) return res.json({ category: existing, categories });
    await db.query(
      'INSERT INTO expense_categories (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO NOTHING',
      [req.session.userId, name]
    );
    return res.status(201).json({ category: { value: name, label: name }, categories: await listCategories(req.session.userId) });
  } catch (error) {
    return sendError(res, error, 'Falha ao criar categoria.');
  }
});

// ---------- Cadastro (nova programação) ----------
router.post('/', async (req, res) => {
  const body = req.body || {};
  const description = cleanText(body.description, 120);
  const amount = schedule.roundMoney(body.amount);
  const dueDate = String(body.due_date || '').slice(0, 10);
  const category = cleanText(body.category, 40) || 'Outros';
  const recurrence = String(body.recurrence || 'unica').trim().toLowerCase();
  const status = body.status === 'pago' ? 'pago' : 'pendente';
  const notes = String(body.notes || '').trim().slice(0, 500);

  if (!description) return res.status(400).json({ error: 'Informe a descrição da despesa.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Informe um valor maior que zero.' });
  if (!schedule.isDateKey(dueDate)) return res.status(400).json({ error: 'Informe a data de vencimento.' });
  if (!schedule.RECURRENCES.includes(recurrence)) return res.status(400).json({ error: 'Recorrência inválida.' });

  let installments = '';
  if (recurrence === 'parcelada') {
    const total = Number(body.installments_total);
    const current = Number(body.installment_current || 1);
    if (!Number.isInteger(total) || total < 2 || total > 360) return res.status(400).json({ error: 'Informe o total de parcelas (mínimo 2).' });
    if (!Number.isInteger(current) || current < 1 || current > total) return res.status(400).json({ error: 'Parcela atual inválida.' });
    installments = `${current}/${total}`;
  }

  const entryKey = crypto.randomUUID();
  const dueMonth = dueDate.slice(0, 7);
  // Campos legados mantidos coerentes para compatibilidade com telas antigas.
  const isFixed = recurrence === 'mensal' ? true : recurrence === 'parcelada' ? null : false;

  try {
    const item = await db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO personal_expenses (
          user_id, entry_key, description, amount, type, category, account, status, status_months,
          date, due_day, installments, is_fixed, installments_start_month, recurrence, end_month, notes
        ) VALUES ($1, $2, $3, $4, 'saida', $5, $6, 'pendente', NULL, $7, $8, $9, $10, $11, $12, NULL, $13)`,
        [
          req.session.userId, entryKey, description, amount, category, String(req.session.profileType || 'outros'),
          dueDate, Number(dueDate.slice(8, 10)), installments, isFixed, dueMonth, recurrence, notes || null
        ]
      );
      // A situação informada vale para a primeira ocorrência; as próximas nascem pendentes.
      const first = await materializeOccurrence(client, req.session.userId, entryKey, dueMonth);
      if (status === 'pago') {
        return saveOccurrence(client, req.session.userId, { ...first, status: 'pago', paid_at: nowIso(), transfer_history: [] });
      }
      return first;
    });
    return res.status(201).json({ ok: true, series_key: entryKey, occurrence: item });
  } catch (error) {
    return sendError(res, error, 'Falha ao cadastrar despesa.');
  }
});

// ---------- Ocorrência: edição individual (não afeta outros meses) ----------
router.patch('/occurrence', async (req, res) => {
  try {
    const { seriesKey, originMonth } = requireOccurrenceRef(req.body);
    const body = req.body || {};
    const row = await db.withTransaction(async (client) => {
      const current = await materializeOccurrence(client, req.session.userId, seriesKey, originMonth);
      if (isDeletedRow(current)) throw new HttpError(404, 'Lançamento não encontrado.');
      const next = { ...current, transfer_history: schedule.parseJson(current.transfer_history, []) };

      if (body.description !== undefined) {
        next.description = cleanText(body.description, 120);
        if (!next.description) throw new HttpError(400, 'Informe a descrição da despesa.');
      }
      if (body.amount !== undefined) {
        next.amount = schedule.roundMoney(body.amount);
        if (!(next.amount > 0)) throw new HttpError(400, 'Informe um valor maior que zero.');
      }
      if (body.category !== undefined) next.category = cleanText(body.category, 40) || 'Outros';
      if (body.notes !== undefined) next.notes = String(body.notes || '').trim().slice(0, 500);
      if (body.due_date !== undefined) {
        const dueDate = String(body.due_date || '').slice(0, 10);
        if (!schedule.isDateKey(dueDate)) throw new HttpError(400, 'Data de vencimento inválida.');
        const newCompetence = dueDate.slice(0, 7);
        if (newCompetence !== current.competence_month) {
          next.transfer_history.push({
            type: 'vencimento_alterado',
            from_month: current.competence_month,
            to_month: newCompetence,
            from_due_date: current.due_date,
            at: nowIso()
          });
        }
        next.due_date = dueDate;
        next.competence_month = newCompetence;
      }
      if (body.status !== undefined) {
        const status = body.status === 'pago' ? 'pago' : 'pendente';
        if (status !== current.status) next.paid_at = status === 'pago' ? nowIso() : null;
        next.status = status;
      }
      return saveOccurrence(client, req.session.userId, next);
    });
    return res.json({ ok: true, occurrence: row });
  } catch (error) {
    return sendError(res, error, 'Falha ao atualizar lançamento.');
  }
});

// ---------- Ocorrência: congelar (transferir pendente para o mês seguinte) ----------
router.post('/occurrence/freeze', async (req, res) => {
  try {
    const { seriesKey, originMonth } = requireOccurrenceRef(req.body);
    const row = await db.withTransaction(async (client) => {
      const current = await materializeOccurrence(client, req.session.userId, seriesKey, originMonth);
      if (isDeletedRow(current)) throw new HttpError(404, 'Lançamento não encontrado.');
      if (current.status === 'pago') throw new HttpError(409, 'Despesas pagas não podem ser congeladas.');

      const fromMonth = current.competence_month;
      const toMonth = schedule.shiftMonth(fromMonth, 1);
      const newDueDate = schedule.dateInMonth(toMonth, Number(String(current.due_date).slice(8, 10)));
      const history = schedule.parseJson(current.transfer_history, []);
      history.push({ type: 'congelado', from_month: fromMonth, to_month: toMonth, from_due_date: current.due_date, at: nowIso() });

      // Mesmo registro, nova competência: sai do mês original, não duplica e não se junta a outro lançamento.
      return saveOccurrence(client, req.session.userId, {
        ...current,
        competence_month: toMonth,
        due_date: newDueDate,
        status: 'pendente',
        paid_at: null,
        transfer_history: history
      });
    });
    return res.json({ ok: true, occurrence: row });
  } catch (error) {
    return sendError(res, error, 'Falha ao congelar lançamento.');
  }
});

// ---------- Exclusões com escopo ----------
// Excluir somente esta ocorrência: marca apenas este lançamento como excluído; nada mais é alterado.
router.post('/occurrence/delete', async (req, res) => {
  try {
    const { seriesKey, originMonth } = requireOccurrenceRef(req.body);
    await db.withTransaction(async (client) => {
      const current = await materializeOccurrence(client, req.session.userId, seriesKey, originMonth);
      if (isDeletedRow(current)) return;
      await saveOccurrence(client, req.session.userId, {
        ...current,
        is_deleted: true,
        transfer_history: schedule.parseJson(current.transfer_history, [])
      });
    });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, 'Falha ao excluir lançamento.');
  }
});

const getRecurringSeriesOrFail = async (client, userId, seriesKey, month) => {
  if (!schedule.isMonthKey(month)) throw new HttpError(400, 'Mês inválido.');
  const series = await findSeries(client, userId, seriesKey);
  if (!series) throw new HttpError(404, 'Despesa não encontrada.');
  if (schedule.getRecurrence(series) === 'unica') throw new HttpError(400, 'Esta despesa não é recorrente.');
  if (month < schedule.getStartMonth(series)) throw new HttpError(400, 'O mês informado é anterior ao início da despesa.');
  return series;
};

// Encerrar recorrência: a programação para de gerar ocorrências depois do mês informado. Nada é apagado.
router.post('/series/:key/end', async (req, res) => {
  const month = String(req.body?.month || '');
  try {
    await db.withTransaction(async (client) => {
      await getRecurringSeriesOrFail(client, req.session.userId, req.params.key, month);
      await client.query('UPDATE personal_expenses SET end_month = $1 WHERE user_id = $2 AND entry_key = $3', [month, req.session.userId, req.params.key]);
    });
    return res.json({ ok: true, end_month: month });
  } catch (error) {
    return sendError(res, error, 'Falha ao encerrar recorrência.');
  }
});

// Excluir ocorrências futuras: encerra após o mês informado e remove somente ocorrências futuras NÃO pagas.
router.post('/series/:key/delete-future', async (req, res) => {
  const month = String(req.body?.month || '');
  try {
    const removed = await db.withTransaction(async (client) => {
      await getRecurringSeriesOrFail(client, req.session.userId, req.params.key, month);
      await client.query('UPDATE personal_expenses SET end_month = $1 WHERE user_id = $2 AND entry_key = $3', [month, req.session.userId, req.params.key]);
      const result = await client.query(
        `DELETE FROM expense_occurrences
         WHERE user_id = $1 AND series_key = $2 AND origin_month > $3 AND status <> 'pago'`,
        [req.session.userId, req.params.key, month]
      );
      return result.rowCount || 0;
    });
    return res.json({ ok: true, end_month: month, removed });
  } catch (error) {
    return sendError(res, error, 'Falha ao excluir ocorrências futuras.');
  }
});

module.exports = router;
