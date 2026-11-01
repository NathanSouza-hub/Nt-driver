const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription, requireAdmin } = require('../middleware/auth');

// Controle do Mês: lançamentos do grupo (Nathan, Mauricio, Lene e Isaque). Módulo independente —
// não lê nem grava dados de Despesas, Dashboard, Uber, Salário ou TikTok. O fechamento é calculado
// no navegador a partir destes lançamentos e não é salvo.
// Lançamentos divididos (is_split): o valor é repartido entre os participantes escolhidos
// (month_control_shares) e cada um registra os próprios pagamentos (month_control_share_payments).
// Pago, restante e situação são sempre calculados a partir dos pagamentos.
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);
router.use(requireAdmin);

const PAYERS = new Set(['nathan', 'mauricio', 'lene', 'isaque']);
// Ordem fixa da divisão; o último selecionado nessa ordem recebe os centavos que sobram.
const SPLIT_ORDER = ['nathan', 'mauricio', 'lene', 'isaque'];
const PARTICIPANT_NAMES = { nathan: 'Nathan', mauricio: 'Mauricio', lene: 'Lene', isaque: 'Isaque' };
const ENTRY_TYPES = new Set(['individual', 'geral', 'cartao']);
const MAX_CENTS = 100000000000;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const sendError = (res, error, fallback) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, ...error.extra });
  console.error('[month-control]', error);
  return res.status(500).json({ error: fallback });
};

const isMonthKey = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
const normalizeText = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const isTrue = (value) => value === true || value === 1 || value === '1' || value === 't' || value === 'true';
const formatBRL = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const normalizeParticipants = (list) => {
  const chosen = new Set((Array.isArray(list) ? list : []).map(String));
  return SPLIT_ORDER.filter((key) => chosen.has(key));
};

// Mesma regra de nt/month-control-logic.js (splitShares): arredonda para baixo e o último
// participante recebe a diferença — a soma das partes é sempre o valor original.
const splitShares = (totalCents, participants) => {
  const keys = normalizeParticipants(participants);
  if (!keys.length) return [];
  const base = Math.floor(totalCents / keys.length);
  return keys.map((participant, index) => ({
    participant,
    share_cents: index === keys.length - 1 ? totalCents - base * (keys.length - 1) : base
  }));
};

const toShare = (row) => ({ participant: row.participant, share_cents: Number(row.share_cents) });
const toPayment = (row) => ({
  id: Number(row.id),
  entry_id: Number(row.entry_id),
  participant: row.participant,
  amount_cents: Number(row.amount_cents),
  paid_on: String(row.paid_on).slice(0, 10),
  notes: row.notes || '',
  created_at: row.created_at
});

const toEntry = (row, shares = [], payments = []) => {
  const isSplit = isTrue(row.is_split);
  return {
    id: Number(row.id),
    year_month: row.year_month,
    entry_date: String(row.entry_date).slice(0, 10),
    description: row.description,
    amount_cents: Number(row.amount_cents),
    payer: row.payer,
    entry_type: row.entry_type,
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
    payment_status: row.payment_status === 'pendente' ? 'pendente' : 'pago',
    notes: row.notes || '',
    created_at: row.created_at,
    is_split: isSplit,
    shares: isSplit ? shares : [],
    payments: isSplit ? payments : []
  };
};

const paidByParticipant = (payments) => payments.reduce((acc, payment) => {
  acc[payment.participant] = (acc[payment.participant] || 0) + payment.amount_cents;
  return acc;
}, {});

// Situação gravada do lançamento dividido: "pago" só quando todas as partes foram quitadas.
const splitStoredStatus = (shares, payments) => {
  const paid = paidByParticipant(payments);
  return shares.every((share) => (paid[share.participant] || 0) >= share.share_cents) ? 'pago' : 'pendente';
};

const parseEntry = (body = {}) => {
  const entryDate = String(body.entry_date || '').slice(0, 10);
  const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const amountCents = Number(body.amount_cents);
  const isSplit = body.is_split === true;
  const participants = isSplit ? normalizeParticipants(body.participants) : [];
  const payer = isSplit ? participants[0] : String(body.payer || '');
  const entryType = String(body.entry_type || 'individual');
  const isBill = entryType === 'geral' || entryType === 'cartao';
  const dueDate = isBill && body.due_date ? String(body.due_date).slice(0, 10) : null;
  const paymentStatus = isSplit ? 'pendente' : (isBill && body.payment_status === 'pendente' ? 'pendente' : 'pago');
  const notes = String(body.notes || '').trim().slice(0, 500);

  if (!isDateKey(entryDate)) return { error: 'Informe a data do lançamento.' };
  if (!description) return { error: 'Informe a descrição.' };
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CENTS) return { error: 'Informe um valor maior que zero.' };
  if (isSplit && !participants.length) return { error: 'Selecione pelo menos uma pessoa para dividir.' };
  if (!PAYERS.has(payer)) return { error: 'Selecione quem pagou.' };
  if (!ENTRY_TYPES.has(entryType)) return { error: 'Tipo de lançamento inválido.' };
  if (dueDate && !isDateKey(dueDate)) return { error: 'Data de vencimento inválida.' };

  return {
    value: {
      year_month: entryDate.slice(0, 7),
      entry_date: entryDate,
      description,
      amount_cents: amountCents,
      // Lançamento dividido: o banco exige um "payer" válido; gravamos o primeiro participante só para
      // cumprir a regra — com is_split ligado esse campo é ignorado em todos os cálculos.
      payer,
      entry_type: entryType,
      due_date: dueDate,
      payment_status: paymentStatus,
      notes: notes || null,
      is_split: isSplit,
      shares: isSplit ? splitShares(amountCents, participants) : []
    }
  };
};

const parsePayment = (body = {}) => {
  const participant = String(body.participant || '');
  const amountCents = Number(body.amount_cents);
  const paidOn = String(body.paid_on || '').slice(0, 10);
  const notes = String(body.notes || '').trim().slice(0, 500);
  if (!PAYERS.has(participant)) throw new HttpError(400, 'Selecione a pessoa que pagou.');
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CENTS) throw new HttpError(400, 'Informe um valor pago maior que zero.');
  if (!isDateKey(paidOn)) throw new HttpError(400, 'Informe a data do pagamento.');
  return { participant, amount_cents: amountCents, paid_on: paidOn, notes: notes || null };
};

const rowsOf = (result) => (result && result.rows) || [];

const loadEntry = async (client, userId, entryId) => {
  const row = rowsOf(await client.query('SELECT * FROM month_control_entries WHERE id = $1 AND user_id = $2', [entryId, userId]))[0];
  if (!row) throw new HttpError(404, 'Lançamento não encontrado.');
  if (!isTrue(row.is_split)) return toEntry(row);
  const shares = rowsOf(await client.query('SELECT * FROM month_control_shares WHERE entry_id = $1 AND user_id = $2', [entryId, userId])).map(toShare);
  const payments = rowsOf(await client.query(
    'SELECT * FROM month_control_share_payments WHERE entry_id = $1 AND user_id = $2 ORDER BY paid_on DESC, id DESC',
    [entryId, userId]
  )).map(toPayment);
  return toEntry(row, shares, payments);
};

const insertShares = async (client, userId, entryId, shares) => {
  for (const share of shares) {
    await client.query(
      'INSERT INTO month_control_shares (entry_id, user_id, participant, share_cents) VALUES ($1, $2, $3, $4)',
      [entryId, userId, share.participant, share.share_cents]
    );
  }
};

const syncSplitStatus = async (client, userId, entry) => {
  const status = splitStoredStatus(entry.shares, entry.payments);
  if (status === entry.payment_status) return entry;
  await client.query('UPDATE month_control_entries SET payment_status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [status, entry.id, userId]);
  return { ...entry, payment_status: status };
};

// Aviso de possível duplicidade: mesmo mês, mesma descrição e mesmo valor; nos lançamentos comuns
// também a mesma pessoa; nos divididos, outro lançamento dividido.
const findDuplicate = async (userId, entry, ignoreId = null) => {
  const rows = entry.is_split
    ? await db.all(
      'SELECT * FROM month_control_entries WHERE user_id = $1 AND year_month = $2 AND amount_cents = $3 AND is_split = $4',
      [userId, entry.year_month, entry.amount_cents, true]
    )
    : await db.all(
      'SELECT * FROM month_control_entries WHERE user_id = $1 AND year_month = $2 AND amount_cents = $3 AND payer = $4 AND is_split = $5',
      [userId, entry.year_month, entry.amount_cents, entry.payer, false]
    );
  const found = (rows || []).find((row) => Number(row.id) !== ignoreId && normalizeText(row.description) === normalizeText(entry.description));
  return found ? toEntry(found) : null;
};

const duplicateError = (duplicate) => new HttpError(409, 'Já existe um lançamento parecido neste mês (mesma descrição, valor e pessoa).', {
  code: 'possible_duplicate',
  duplicate
});

// Meses com lançamentos (para o Histórico). Nos divididos, conta o que cada pessoa já pagou da
// própria parte e o que ainda falta.
router.get('/months', async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rows, splitRows, shareRows, paymentRows] = await Promise.all([
      db.all(
        `SELECT year_month, payer, payment_status, COUNT(*) AS count, SUM(amount_cents) AS total
         FROM month_control_entries WHERE user_id = $1 AND is_split = $2
         GROUP BY year_month, payer, payment_status`,
        [userId, false]
      ),
      db.all('SELECT id, year_month FROM month_control_entries WHERE user_id = $1 AND is_split = $2', [userId, true]),
      db.all('SELECT entry_id, share_cents FROM month_control_shares WHERE user_id = $1', [userId]),
      db.all('SELECT entry_id, participant, amount_cents FROM month_control_share_payments WHERE user_id = $1', [userId])
    ]);
    const byMonth = new Map();
    const monthItem = (month) => {
      const item = byMonth.get(month) || { month, count: 0, paidTotals: { nathan: 0, mauricio: 0, lene: 0, isaque: 0 }, pendingCents: 0 };
      byMonth.set(month, item);
      return item;
    };
    (rows || []).forEach((row) => {
      const item = monthItem(row.year_month);
      item.count += Number(row.count) || 0;
      if (row.payment_status === 'pendente') item.pendingCents += Number(row.total) || 0;
      else item.paidTotals[row.payer] += Number(row.total) || 0;
    });
    const splitMonth = new Map((splitRows || []).map((row) => [Number(row.id), row.year_month]));
    splitMonth.forEach((month) => { monthItem(month).count += 1; });
    (shareRows || []).forEach((row) => {
      const month = splitMonth.get(Number(row.entry_id));
      if (month) monthItem(month).pendingCents += Number(row.share_cents) || 0;
    });
    (paymentRows || []).forEach((row) => {
      const month = splitMonth.get(Number(row.entry_id));
      if (!month || !PAYERS.has(row.participant)) return;
      const item = monthItem(month);
      const amount = Number(row.amount_cents) || 0;
      item.paidTotals[row.participant] += amount;
      item.pendingCents -= amount;
    });
    const list = Array.from(byMonth.values()).sort((left, right) => right.month.localeCompare(left.month));
    return res.json(list);
  } catch (error) {
    return sendError(res, error, 'Falha ao carregar o histórico.');
  }
});

router.get('/:month', async (req, res) => {
  const month = String(req.params.month || '');
  if (!isMonthKey(month)) return res.status(400).json({ error: 'Mês inválido.' });
  try {
    const userId = req.session.userId;
    const [rows, shareRows, paymentRows] = await Promise.all([
      db.all('SELECT * FROM month_control_entries WHERE user_id = $1 AND year_month = $2 ORDER BY entry_date DESC, id DESC', [userId, month]),
      db.all(
        `SELECT s.* FROM month_control_shares s
         JOIN month_control_entries e ON e.id = s.entry_id
         WHERE s.user_id = $1 AND e.year_month = $2`,
        [userId, month]
      ),
      db.all(
        `SELECT p.* FROM month_control_share_payments p
         JOIN month_control_entries e ON e.id = p.entry_id
         WHERE p.user_id = $1 AND e.year_month = $2
         ORDER BY p.paid_on DESC, p.id DESC`,
        [userId, month]
      )
    ]);
    const group = (list, mapper) => {
      const map = new Map();
      (list || []).forEach((row) => {
        const key = Number(row.entry_id);
        map.set(key, [...(map.get(key) || []), mapper(row)]);
      });
      return map;
    };
    const sharesByEntry = group(shareRows, toShare);
    const paymentsByEntry = group(paymentRows, toPayment);
    return res.json((rows || []).map((row) => toEntry(row, sharesByEntry.get(Number(row.id)) || [], paymentsByEntry.get(Number(row.id)) || [])));
  } catch (error) {
    return sendError(res, error, 'Falha ao carregar os lançamentos.');
  }
});

router.post('/', async (req, res) => {
  const parsed = parseEntry(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entry = parsed.value;
  const userId = req.session.userId;
  try {
    if (req.body?.force !== true) {
      const duplicate = await findDuplicate(userId, entry);
      if (duplicate) throw duplicateError(duplicate);
    }
    const saved = await db.withTransaction(async (client) => {
      const row = rowsOf(await client.query(
        `INSERT INTO month_control_entries (user_id, year_month, entry_date, description, amount_cents, payer, entry_type, due_date, payment_status, notes, is_split)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [userId, entry.year_month, entry.entry_date, entry.description, entry.amount_cents, entry.payer, entry.entry_type, entry.due_date, entry.payment_status, entry.notes, entry.is_split]
      ))[0];
      await insertShares(client, userId, Number(row.id), entry.shares);
      return loadEntry(client, userId, Number(row.id));
    });
    return res.status(201).json(saved);
  } catch (error) {
    return sendError(res, error, 'Falha ao salvar o lançamento.');
  }
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Lançamento inválido.' });
  const parsed = parseEntry(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entry = parsed.value;
  const userId = req.session.userId;
  try {
    if (req.body?.force !== true) {
      const duplicate = await findDuplicate(userId, entry, id);
      if (duplicate) throw duplicateError(duplicate);
    }
    const saved = await db.withTransaction(async (client) => {
      const current = await loadEntry(client, userId, id);
      const paid = paidByParticipant(current.payments);
      const hasPayments = current.payments.length > 0;

      if (current.is_split && !entry.is_split && hasPayments) {
        throw new HttpError(400, 'Este lançamento já tem pagamentos registrados. Exclua os pagamentos antes de desligar a divisão.');
      }
      if (entry.is_split) {
        const newShares = Object.fromEntries(entry.shares.map((share) => [share.participant, share.share_cents]));
        const below = Object.entries(paid).filter(([participant, value]) => (newShares[participant] || 0) < value);
        if (below.length) {
          const names = below.map(([participant, value]) => `${PARTICIPANT_NAMES[participant]} (já pagou ${formatBRL(value)})`).join(', ');
          throw new HttpError(400, `A parte de cada pessoa não pode ficar menor do que ela já pagou: ${names}.`, { code: 'share_below_paid' });
        }
        const oldShares = Object.fromEntries(current.shares.map((share) => [share.participant, share.share_cents]));
        const changed = entry.shares.length !== current.shares.length
          || entry.shares.some((share) => oldShares[share.participant] !== share.share_cents);
        if (hasPayments && changed && req.body?.confirm_shares !== true) {
          throw new HttpError(409, 'As partes vão mudar e este lançamento já tem pagamentos. Confirme para recalcular.', {
            code: 'shares_change_confirm',
            old_shares: current.shares,
            new_shares: entry.shares
          });
        }
      }

      const status = entry.is_split ? splitStoredStatus(entry.shares, current.payments) : entry.payment_status;
      await client.query(
        `UPDATE month_control_entries
         SET year_month = $1, entry_date = $2, description = $3, amount_cents = $4, payer = $5, entry_type = $6,
             due_date = $7, payment_status = $8, notes = $9, is_split = $10, updated_at = NOW()
         WHERE id = $11 AND user_id = $12`,
        [entry.year_month, entry.entry_date, entry.description, entry.amount_cents, entry.payer, entry.entry_type, entry.due_date, status, entry.notes, entry.is_split, id, userId]
      );
      // As partes são derivadas do valor e dos participantes: recria; os pagamentos ficam intactos.
      await client.query('DELETE FROM month_control_shares WHERE entry_id = $1 AND user_id = $2', [id, userId]);
      await insertShares(client, userId, id, entry.shares);
      return loadEntry(client, userId, id);
    });
    return res.json(saved);
  } catch (error) {
    return sendError(res, error, 'Falha ao atualizar o lançamento.');
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Lançamento inválido.' });
  const userId = req.session.userId;
  try {
    const result = await db.withTransaction(async (client) => {
      const exists = rowsOf(await client.query('SELECT id FROM month_control_entries WHERE id = $1 AND user_id = $2', [id, userId]))[0];
      if (!exists) return { deleted: 0, payments_deleted: 0 };
      const payments = await client.query('DELETE FROM month_control_share_payments WHERE entry_id = $1 AND user_id = $2', [id, userId]);
      await client.query('DELETE FROM month_control_shares WHERE entry_id = $1 AND user_id = $2', [id, userId]);
      const entries = await client.query('DELETE FROM month_control_entries WHERE id = $1 AND user_id = $2', [id, userId]);
      return { deleted: entries.rowCount || 0, payments_deleted: payments.rowCount || 0 };
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Falha ao excluir o lançamento.');
  }
});

// Pagamentos individuais de um lançamento dividido.
const requireSplitShare = (entry, participant) => {
  if (!entry.is_split) throw new HttpError(400, 'Este lançamento não é dividido entre pessoas.');
  const share = entry.shares.find((item) => item.participant === participant);
  if (!share) throw new HttpError(400, `${PARTICIPANT_NAMES[participant]} não participa deste lançamento.`);
  return share;
};

const ensureWithinShare = (share, paidSoFar, amountCents) => {
  const max = Math.max(share.share_cents - paidSoFar, 0);
  if (amountCents > max) {
    throw new HttpError(400, `O valor é maior que o restante da parte de ${PARTICIPANT_NAMES[share.participant]}. Máximo permitido: ${formatBRL(max)}.`, { max_cents: max });
  }
};

router.post('/:id/payments', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Lançamento inválido.' });
  const userId = req.session.userId;
  try {
    const payment = parsePayment(req.body);
    const entry = await db.withTransaction(async (client) => {
      const current = await loadEntry(client, userId, id);
      const share = requireSplitShare(current, payment.participant);
      ensureWithinShare(share, paidByParticipant(current.payments)[payment.participant] || 0, payment.amount_cents);
      await client.query(
        'INSERT INTO month_control_share_payments (entry_id, user_id, participant, amount_cents, paid_on, notes) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, userId, payment.participant, payment.amount_cents, payment.paid_on, payment.notes]
      );
      return syncSplitStatus(client, userId, await loadEntry(client, userId, id));
    });
    return res.status(201).json(entry);
  } catch (error) {
    return sendError(res, error, 'Falha ao registrar o pagamento.');
  }
});

router.put('/:id/payments/:paymentId', async (req, res) => {
  const id = parseId(req.params.id);
  const paymentId = parseId(req.params.paymentId);
  if (!id || !paymentId) return res.status(400).json({ error: 'Pagamento inválido.' });
  const userId = req.session.userId;
  try {
    const payment = parsePayment(req.body);
    const entry = await db.withTransaction(async (client) => {
      const current = await loadEntry(client, userId, id);
      const existing = current.payments.find((item) => item.id === paymentId);
      if (!existing) throw new HttpError(404, 'Pagamento não encontrado.');
      const share = requireSplitShare(current, payment.participant);
      const others = current.payments.filter((item) => item.id !== paymentId);
      ensureWithinShare(share, paidByParticipant(others)[payment.participant] || 0, payment.amount_cents);
      await client.query(
        'UPDATE month_control_share_payments SET participant = $1, amount_cents = $2, paid_on = $3, notes = $4 WHERE id = $5 AND entry_id = $6 AND user_id = $7',
        [payment.participant, payment.amount_cents, payment.paid_on, payment.notes, paymentId, id, userId]
      );
      return syncSplitStatus(client, userId, await loadEntry(client, userId, id));
    });
    return res.json(entry);
  } catch (error) {
    return sendError(res, error, 'Falha ao atualizar o pagamento.');
  }
});

router.delete('/:id/payments/:paymentId', async (req, res) => {
  const id = parseId(req.params.id);
  const paymentId = parseId(req.params.paymentId);
  if (!id || !paymentId) return res.status(400).json({ error: 'Pagamento inválido.' });
  const userId = req.session.userId;
  try {
    const entry = await db.withTransaction(async (client) => {
      const current = await loadEntry(client, userId, id);
      if (!current.payments.some((item) => item.id === paymentId)) throw new HttpError(404, 'Pagamento não encontrado.');
      await client.query('DELETE FROM month_control_share_payments WHERE id = $1 AND entry_id = $2 AND user_id = $3', [paymentId, id, userId]);
      return syncSplitStatus(client, userId, await loadEntry(client, userId, id));
    });
    return res.json(entry);
  } catch (error) {
    return sendError(res, error, 'Falha ao excluir o pagamento.');
  }
});

module.exports = router;
