const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

// Dívidas Antigas: dívidas e pagamentos parciais, por usuário. Módulo independente — não alimenta o
// Dashboard nem Despesas e não lê dados de outros módulos. Total pago, saldo e situação são sempre
// calculados a partir dos pagamentos (centavos inteiros).
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const CATEGORIES = new Set(['faculdade', 'veiculo', 'negativada', 'emprestimo', 'pessoal', 'outras']);
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
  console.error('[old-debts]', error);
  return res.status(500).json({ error: fallback });
};

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
const isValidCents = (value) => Number.isInteger(value) && value > 0 && value <= MAX_CENTS;
const formatBRL = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const toPayment = (row) => ({
  id: Number(row.id),
  debt_id: Number(row.debt_id),
  amount_cents: Number(row.amount_cents),
  paid_on: String(row.paid_on).slice(0, 10),
  notes: row.notes || '',
  created_at: row.created_at
});

const toDebt = (row, payments = []) => ({
  id: Number(row.id),
  description: row.description,
  category: row.category,
  creditor: row.creditor || null,
  original_cents: Number(row.original_cents),
  notes: row.notes || '',
  created_at: row.created_at,
  updated_at: row.updated_at,
  payments
});

const loadDebt = async (client, userId, debtId) => {
  const debtResult = await client.query('SELECT * FROM old_debts WHERE id = $1 AND user_id = $2', [debtId, userId]);
  const row = debtResult.rows && debtResult.rows[0];
  if (!row) throw new HttpError(404, 'Dívida não encontrada.');
  const paymentResult = await client.query(
    'SELECT * FROM old_debt_payments WHERE debt_id = $1 AND user_id = $2 ORDER BY paid_on DESC, id DESC',
    [debtId, userId]
  );
  return toDebt(row, (paymentResult.rows || []).map(toPayment));
};

const paidOf = (debt) => debt.payments.reduce((sum, payment) => sum + payment.amount_cents, 0);

const parseDebt = (body = {}) => {
  const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const category = String(body.category || '');
  const creditor = String(body.creditor || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const originalCents = Number(body.original_cents);
  const notes = String(body.notes || '').trim().slice(0, 1000);
  if (!description) throw new HttpError(400, 'Informe a descrição da dívida.');
  if (!CATEGORIES.has(category)) throw new HttpError(400, 'Selecione uma categoria.');
  if (!isValidCents(originalCents)) throw new HttpError(400, 'Informe um valor original maior que zero.');
  return { description, category, creditor: creditor || null, original_cents: originalCents, notes: notes || null };
};

const parsePayment = (body = {}) => {
  const amountCents = Number(body.amount_cents);
  const paidOn = String(body.paid_on || '').slice(0, 10);
  const notes = String(body.notes || '').trim().slice(0, 500);
  if (!isValidCents(amountCents)) throw new HttpError(400, 'Informe um valor pago maior que zero.');
  if (!isDateKey(paidOn)) throw new HttpError(400, 'Informe a data do pagamento.');
  return { amount_cents: amountCents, paid_on: paidOn, notes: notes || null };
};

router.get('/', async (req, res) => {
  try {
    const [debtRows, paymentRows] = await Promise.all([
      db.all('SELECT * FROM old_debts WHERE user_id = $1 ORDER BY created_at DESC, id DESC', [req.session.userId]),
      db.all('SELECT * FROM old_debt_payments WHERE user_id = $1 ORDER BY paid_on DESC, id DESC', [req.session.userId])
    ]);
    const paymentsByDebt = new Map();
    (paymentRows || []).forEach((row) => {
      const list = paymentsByDebt.get(Number(row.debt_id)) || [];
      list.push(toPayment(row));
      paymentsByDebt.set(Number(row.debt_id), list);
    });
    return res.json((debtRows || []).map((row) => toDebt(row, paymentsByDebt.get(Number(row.id)) || [])));
  } catch (error) {
    return sendError(res, error, 'Falha ao carregar as dívidas.');
  }
});

router.post('/', async (req, res) => {
  try {
    const debt = parseDebt(req.body);
    const row = await db.get(
      `INSERT INTO old_debts (user_id, description, category, creditor, original_cents, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.session.userId, debt.description, debt.category, debt.creditor, debt.original_cents, debt.notes]
    );
    return res.status(201).json(toDebt(row, []));
  } catch (error) {
    return sendError(res, error, 'Falha ao cadastrar a dívida.');
  }
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Dívida inválida.' });
  try {
    const data = parseDebt(req.body);
    const debt = await db.withTransaction(async (client) => {
      const current = await loadDebt(client, req.session.userId, id);
      const paidCents = paidOf(current);
      if (data.original_cents < paidCents) {
        throw new HttpError(400, `O valor original não pode ser menor que o total já pago (mínimo ${formatBRL(paidCents)}).`, { min_cents: paidCents });
      }
      await client.query(
        `UPDATE old_debts SET description = $1, category = $2, creditor = $3, original_cents = $4, notes = $5, updated_at = NOW()
         WHERE id = $6 AND user_id = $7`,
        [data.description, data.category, data.creditor, data.original_cents, data.notes, id, req.session.userId]
      );
      return loadDebt(client, req.session.userId, id);
    });
    return res.json(debt);
  } catch (error) {
    return sendError(res, error, 'Falha ao atualizar a dívida.');
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Dívida inválida.' });
  try {
    const removed = await db.withTransaction(async (client) => {
      await loadDebt(client, req.session.userId, id);
      const payments = await client.query('DELETE FROM old_debt_payments WHERE debt_id = $1 AND user_id = $2', [id, req.session.userId]);
      await client.query('DELETE FROM old_debts WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
      return payments.rowCount || 0;
    });
    return res.json({ deleted: 1, payments_deleted: removed });
  } catch (error) {
    return sendError(res, error, 'Falha ao excluir a dívida.');
  }
});

router.post('/:id/payments', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Dívida inválida.' });
  try {
    const payment = parsePayment(req.body);
    const debt = await db.withTransaction(async (client) => {
      const current = await loadDebt(client, req.session.userId, id);
      const remaining = current.original_cents - paidOf(current);
      if (payment.amount_cents > remaining) {
        throw new HttpError(400, `O valor é maior que o saldo restante. Máximo permitido: ${formatBRL(Math.max(remaining, 0))}.`, { max_cents: Math.max(remaining, 0) });
      }
      await client.query(
        'INSERT INTO old_debt_payments (debt_id, user_id, amount_cents, paid_on, notes) VALUES ($1, $2, $3, $4, $5)',
        [id, req.session.userId, payment.amount_cents, payment.paid_on, payment.notes]
      );
      return loadDebt(client, req.session.userId, id);
    });
    return res.status(201).json(debt);
  } catch (error) {
    return sendError(res, error, 'Falha ao registrar o pagamento.');
  }
});

router.put('/:id/payments/:paymentId', async (req, res) => {
  const id = parseId(req.params.id);
  const paymentId = parseId(req.params.paymentId);
  if (!id || !paymentId) return res.status(400).json({ error: 'Pagamento inválido.' });
  try {
    const payment = parsePayment(req.body);
    const debt = await db.withTransaction(async (client) => {
      const current = await loadDebt(client, req.session.userId, id);
      const existing = current.payments.find((item) => item.id === paymentId);
      if (!existing) throw new HttpError(404, 'Pagamento não encontrado.');
      const max = current.original_cents - paidOf(current) + existing.amount_cents;
      if (payment.amount_cents > max) {
        throw new HttpError(400, `O valor é maior que o saldo restante. Máximo permitido: ${formatBRL(max)}.`, { max_cents: max });
      }
      await client.query(
        'UPDATE old_debt_payments SET amount_cents = $1, paid_on = $2, notes = $3 WHERE id = $4 AND debt_id = $5 AND user_id = $6',
        [payment.amount_cents, payment.paid_on, payment.notes, paymentId, id, req.session.userId]
      );
      return loadDebt(client, req.session.userId, id);
    });
    return res.json(debt);
  } catch (error) {
    return sendError(res, error, 'Falha ao atualizar o pagamento.');
  }
});

router.delete('/:id/payments/:paymentId', async (req, res) => {
  const id = parseId(req.params.id);
  const paymentId = parseId(req.params.paymentId);
  if (!id || !paymentId) return res.status(400).json({ error: 'Pagamento inválido.' });
  try {
    const debt = await db.withTransaction(async (client) => {
      const current = await loadDebt(client, req.session.userId, id);
      if (!current.payments.some((item) => item.id === paymentId)) throw new HttpError(404, 'Pagamento não encontrado.');
      await client.query('DELETE FROM old_debt_payments WHERE id = $1 AND debt_id = $2 AND user_id = $3', [paymentId, id, req.session.userId]);
      return loadDebt(client, req.session.userId, id);
    });
    return res.json(debt);
  } catch (error) {
    return sendError(res, error, 'Falha ao excluir o pagamento.');
  }
});

module.exports = router;
