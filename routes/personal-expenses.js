const crypto = require('crypto');
const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const sqlSelectByUser = `
  SELECT *
  FROM personal_expenses
  WHERE user_id = $1
  ORDER BY due_day ASC, date ASC, id DESC
`;

const normalizeStatusMonths = (value, date, status) => {
  let parsed = value;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      parsed = {};
    }
  }

  const normalized = Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).reduce((accumulator, [monthKey, monthStatus]) => {
    const normalizedMonth = String(monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) return accumulator;
    if (monthStatus === 'pago') accumulator[normalizedMonth] = 'pago';
    return accumulator;
  }, {});

  const baseMonth = String(date || '').slice(0, 7);
  if (status === 'pago' && /^\d{4}-\d{2}$/.test(baseMonth) && !normalized[baseMonth]) {
    normalized[baseMonth] = 'pago';
  }

  return normalized;
};

const normalizeItem = (item = {}) => {
  const date = String(item.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dueRaw = Number(item.due_day);
  const fallbackDay = Number(date.slice(8, 10)) || 1;
  const dueDay = Number.isFinite(dueRaw) && dueRaw >= 1 && dueRaw <= 31 ? dueRaw : fallbackDay;
  const entryKey = String(item.entry_key || item.entryKey || item.id || '').trim() || crypto.randomUUID();
  const statusMonths = normalizeStatusMonths(item.status_months ?? item.statusMonths, date, item.status);
  const baseMonth = date.slice(0, 7);

  let isFixed = item.is_fixed;
  if (isFixed === null || isFixed === undefined || isFixed === '') isFixed = null;
  else isFixed = Boolean(isFixed);

  return {
    entry_key: entryKey,
    description: String(item.description || '').trim(),
    amount: Number(item.amount) || 0,
    type: item.type === 'entrada' ? 'entrada' : 'saida',
    category: String(item.category || 'outros'),
    account: String(item.account || 'outros'),
    status: statusMonths[baseMonth] === 'pago' ? 'pago' : 'pendente',
    status_months: Object.keys(statusMonths).length ? JSON.stringify(statusMonths) : null,
    date,
    due_day: dueDay,
    installments: String(item.installments || '').trim(),
    is_fixed: isFixed,
    installments_start_month: String(item.installments_start_month || date.slice(0, 7))
  };
};

router.get('/', async (req, res) => {
  try {
    const rows = await db.all(sqlSelectByUser, [req.session.userId]);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar despesas pessoais.' });
  }
});

router.post('/replace', async (req, res) => {
  const userId = req.session.userId;
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const itemsMap = new Map();

  rawItems
    .map(normalizeItem)
    .filter((item) => item.amount > 0)
    .forEach((item) => {
      itemsMap.set(item.entry_key, item);
    });

  const items = Array.from(itemsMap.values());

  try {
    const rows = await db.withTransaction(async (client) => {
      await client.query('DELETE FROM personal_expenses WHERE user_id = $1', [userId]);

      for (const item of items) {
        await client.query(
          `INSERT INTO personal_expenses (
            user_id, entry_key, description, amount, type, category, account, status, status_months,
            date, due_day, installments, is_fixed, installments_start_month
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            userId,
            item.entry_key,
            item.description,
            item.amount,
            item.type,
            item.category,
            item.account,
            item.status,
            item.status_months,
            item.date,
            item.due_day,
            item.installments,
            item.is_fixed,
            item.installments_start_month
          ]
        );
      }

      const result = await client.query(sqlSelectByUser, [userId]);
      return result.rows || [];
    });

    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar despesas pessoais.' });
  }
});

module.exports = router;
