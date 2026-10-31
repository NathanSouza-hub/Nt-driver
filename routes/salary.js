const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

// Recebimentos da aba Salário (salário e benefícios). Ficam isolados das despesas gerais.
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const RECEIPT_TYPES = new Set(['salario', 'vr', 'va', 'vt', 'bonus', 'comissao', 'horas_extras', 'outros']);
const RECURRENCES = new Set(['unica', 'mensal']);

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

const parsePayload = (body = {}) => {
  const receiptType = String(body.receipt_type || '').trim().toLowerCase();
  const amount = Number(body.amount);
  const date = String(body.date || '').slice(0, 10);
  const recurrence = String(body.recurrence || 'unica').trim().toLowerCase();
  const endMonthRaw = String(body.recurrence_end_month || '').trim();
  const notes = String(body.notes || '').trim().slice(0, 500);

  if (!RECEIPT_TYPES.has(receiptType)) return { error: 'Tipo de recebimento inválido.' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Informe um valor maior que zero.' };
  if (!isValidDate(date)) return { error: 'Data de recebimento inválida.' };
  if (!RECURRENCES.has(recurrence)) return { error: 'Recorrência inválida.' };

  let recurrenceEndMonth = null;
  if (recurrence === 'mensal' && endMonthRaw) {
    if (!/^\d{4}-\d{2}$/.test(endMonthRaw)) return { error: 'Mês final da recorrência inválido.' };
    if (endMonthRaw < date.slice(0, 7)) return { error: 'O mês final não pode ser anterior à data de recebimento.' };
    recurrenceEndMonth = endMonthRaw;
  }

  return {
    value: {
      receipt_type: receiptType,
      amount: Math.round(amount * 100) / 100,
      date,
      recurrence,
      recurrence_end_month: recurrenceEndMonth,
      notes: notes || null
    }
  };
};

const SELECT_COLUMNS = 'id, receipt_type, amount, date, recurrence, recurrence_end_month, notes, created_at';

router.get('/', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT ${SELECT_COLUMNS} FROM salary_receipts WHERE user_id = $1 ORDER BY date DESC, id DESC`,
      [req.session.userId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar recebimentos.' });
  }
});

router.post('/', async (req, res) => {
  const parsed = parsePayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const item = parsed.value;

  try {
    const row = await db.get(
      `INSERT INTO salary_receipts (user_id, receipt_type, amount, date, recurrence, recurrence_end_month, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [req.session.userId, item.receipt_type, item.amount, item.date, item.recurrence, item.recurrence_end_month, item.notes]
    );
    return res.status(201).json(row);
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar recebimento.' });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Lançamento inválido.' });
  const parsed = parsePayload(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const item = parsed.value;

  try {
    const row = await db.get(
      `UPDATE salary_receipts
       SET receipt_type = $1, amount = $2, date = $3, recurrence = $4, recurrence_end_month = $5, notes = $6, updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING ${SELECT_COLUMNS}`,
      [item.receipt_type, item.amount, item.date, item.recurrence, item.recurrence_end_month, item.notes, id, req.session.userId]
    );
    if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao atualizar recebimento.' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Lançamento inválido.' });

  try {
    const result = await db.query('DELETE FROM salary_receipts WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
    return res.json({ deleted: result.rowCount || 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao excluir recebimento.' });
  }
});

module.exports = router;
