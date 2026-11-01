const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription, requireAdmin } = require('../middleware/auth');

// Controle do Mês: lançamentos do grupo (Nathan, Mauricio, Lene e Isaque). Módulo independente —
// não lê nem grava dados de Despesas, Dashboard, Uber, Salário ou TikTok. O fechamento é calculado
// no navegador a partir destes lançamentos e não é salvo.
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);
router.use(requireAdmin);

const PAYERS = new Set(['nathan', 'mauricio', 'lene', 'isaque']);
const ENTRY_TYPES = new Set(['individual', 'geral', 'cartao']);
const MAX_CENTS = 100000000000;

const isMonthKey = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
const normalizeText = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const toEntry = (row) => ({
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
  created_at: row.created_at
});

const parseEntry = (body = {}) => {
  const entryDate = String(body.entry_date || '').slice(0, 10);
  const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const amountCents = Number(body.amount_cents);
  const payer = String(body.payer || '');
  const entryType = String(body.entry_type || 'individual');
  const isBill = entryType === 'geral' || entryType === 'cartao';
  const dueDate = isBill && body.due_date ? String(body.due_date).slice(0, 10) : null;
  const paymentStatus = isBill && body.payment_status === 'pendente' ? 'pendente' : 'pago';
  const notes = String(body.notes || '').trim().slice(0, 500);

  if (!isDateKey(entryDate)) return { error: 'Informe a data do lançamento.' };
  if (!description) return { error: 'Informe a descrição.' };
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CENTS) return { error: 'Informe um valor maior que zero.' };
  if (!PAYERS.has(payer)) return { error: 'Selecione quem pagou.' };
  if (!ENTRY_TYPES.has(entryType)) return { error: 'Tipo de lançamento inválido.' };
  if (dueDate && !isDateKey(dueDate)) return { error: 'Data de vencimento inválida.' };

  return {
    value: {
      year_month: entryDate.slice(0, 7),
      entry_date: entryDate,
      description,
      amount_cents: amountCents,
      payer,
      entry_type: entryType,
      due_date: dueDate,
      payment_status: paymentStatus,
      notes: notes || null
    }
  };
};

// Aviso de possível duplicidade: mesmo mês, mesma descrição, mesmo valor e mesma pessoa.
const findDuplicate = async (userId, entry, ignoreId = null) => {
  const rows = await db.all(
    'SELECT * FROM month_control_entries WHERE user_id = $1 AND year_month = $2 AND amount_cents = $3 AND payer = $4',
    [userId, entry.year_month, entry.amount_cents, entry.payer]
  );
  const found = (rows || []).find((row) => Number(row.id) !== ignoreId && normalizeText(row.description) === normalizeText(entry.description));
  return found ? toEntry(found) : null;
};

const sendDuplicate = (res, duplicate) => res.status(409).json({
  error: 'Já existe um lançamento parecido neste mês (mesma descrição, valor e pessoa).',
  code: 'possible_duplicate',
  duplicate
});

// Meses com lançamentos (para o Histórico).
router.get('/months', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT year_month, payer, payment_status, COUNT(*) AS count, SUM(amount_cents) AS total
       FROM month_control_entries WHERE user_id = $1
       GROUP BY year_month, payer, payment_status
       ORDER BY year_month DESC`,
      [req.session.userId]
    );
    const byMonth = new Map();
    (rows || []).forEach((row) => {
      const item = byMonth.get(row.year_month) || { month: row.year_month, count: 0, paidTotals: { nathan: 0, mauricio: 0, lene: 0, isaque: 0 }, pendingCents: 0 };
      item.count += Number(row.count) || 0;
      if (row.payment_status === 'pendente') item.pendingCents += Number(row.total) || 0;
      else item.paidTotals[row.payer] += Number(row.total) || 0;
      byMonth.set(row.year_month, item);
    });
    return res.json(Array.from(byMonth.values()));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar o histórico.' });
  }
});

router.get('/:month', async (req, res) => {
  const month = String(req.params.month || '');
  if (!isMonthKey(month)) return res.status(400).json({ error: 'Mês inválido.' });
  try {
    const rows = await db.all(
      'SELECT * FROM month_control_entries WHERE user_id = $1 AND year_month = $2 ORDER BY entry_date DESC, id DESC',
      [req.session.userId, month]
    );
    return res.json((rows || []).map(toEntry));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar os lançamentos.' });
  }
});

router.post('/', async (req, res) => {
  const parsed = parseEntry(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entry = parsed.value;
  try {
    if (req.body?.force !== true) {
      const duplicate = await findDuplicate(req.session.userId, entry);
      if (duplicate) return sendDuplicate(res, duplicate);
    }
    const row = await db.get(
      `INSERT INTO month_control_entries (user_id, year_month, entry_date, description, amount_cents, payer, entry_type, due_date, payment_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.session.userId, entry.year_month, entry.entry_date, entry.description, entry.amount_cents, entry.payer, entry.entry_type, entry.due_date, entry.payment_status, entry.notes]
    );
    return res.status(201).json(toEntry(row));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar o lançamento.' });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Lançamento inválido.' });
  const parsed = parseEntry(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entry = parsed.value;
  try {
    if (req.body?.force !== true) {
      const duplicate = await findDuplicate(req.session.userId, entry, id);
      if (duplicate) return sendDuplicate(res, duplicate);
    }
    const row = await db.get(
      `UPDATE month_control_entries
       SET year_month = $1, entry_date = $2, description = $3, amount_cents = $4, payer = $5, entry_type = $6,
           due_date = $7, payment_status = $8, notes = $9, updated_at = NOW()
       WHERE id = $10 AND user_id = $11
       RETURNING *`,
      [entry.year_month, entry.entry_date, entry.description, entry.amount_cents, entry.payer, entry.entry_type, entry.due_date, entry.payment_status, entry.notes, id, req.session.userId]
    );
    if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });
    return res.json(toEntry(row));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao atualizar o lançamento.' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Lançamento inválido.' });
  try {
    const result = await db.query('DELETE FROM month_control_entries WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
    return res.json({ deleted: result.rowCount || 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao excluir o lançamento.' });
  }
});

module.exports = router;
