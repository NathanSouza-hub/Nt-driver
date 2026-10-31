const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

// Aba TikTok: planilha de vendas (dias x vendedores) e despesas próprias.
// Nada daqui entra nas despesas gerais; somente as vendas compõem as receitas do Dashboard.
const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const parseMonthKey = (value) => {
  const monthKey = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) ? monthKey : '';
};

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

const getMonthRange = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
};

const toSeller = (row) => ({
  id: Number(row.id),
  name: row.name,
  sort_order: Number(row.sort_order || 0),
  archived: Boolean(row.archived_at)
});

const findSeller = (userId, sellerId) => db.get(
  'SELECT id, name, sort_order, archived_at FROM tiktok_sellers WHERE id = $1 AND user_id = $2',
  [sellerId, userId]
);

// Dados de um mês: vendedores visíveis, células preenchidas e despesas do TikTok.
router.get('/month/:month', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  if (!month) return res.status(400).json({ error: 'Mês inválido.' });
  const { start, end } = getMonthRange(month);
  const userId = req.session.userId;

  try {
    const [sellerRows, saleRows, expenseRows] = await Promise.all([
      db.all('SELECT id, name, sort_order, archived_at FROM tiktok_sellers WHERE user_id = $1 ORDER BY sort_order ASC, id ASC', [userId]),
      db.all(
        `SELECT seller_id, date, amount FROM tiktok_sales
         WHERE user_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date ASC`,
        [userId, start, end]
      ),
      db.all(
        `SELECT id, description, category, amount, date FROM tiktok_expenses
         WHERE user_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date DESC, id DESC`,
        [userId, start, end]
      )
    ]);

    const allSellers = (sellerRows || []).map(toSeller);
    const sellersWithSales = new Set((saleRows || []).map((row) => Number(row.seller_id)));
    // Vendedores removidos continuam aparecendo nos meses em que têm lançamentos, preservando o histórico.
    const sellers = allSellers.filter((seller) => !seller.archived || sellersWithSales.has(seller.id));

    return res.json({
      month,
      sellers,
      archivedSellers: allSellers.filter((seller) => seller.archived),
      sales: (saleRows || []).map((row) => ({
        seller_id: Number(row.seller_id),
        date: String(row.date).slice(0, 10),
        amount: Number(row.amount) || 0
      })),
      expenses: (expenseRows || []).map((row) => ({
        id: Number(row.id),
        description: row.description,
        category: row.category || '',
        amount: Number(row.amount) || 0,
        date: String(row.date).slice(0, 10)
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar a planilha do TikTok.' });
  }
});

router.post('/sellers', async (req, res) => {
  const name = normalizeName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Informe o nome do vendedor.' });

  try {
    const maxRow = await db.get('SELECT MAX(sort_order) AS max_order FROM tiktok_sellers WHERE user_id = $1', [req.session.userId]);
    const nextOrder = Number(maxRow?.max_order || 0) + 1;
    const row = await db.get(
      `INSERT INTO tiktok_sellers (user_id, name, sort_order) VALUES ($1, $2, $3)
       RETURNING id, name, sort_order, archived_at`,
      [req.session.userId, name, nextOrder]
    );
    return res.status(201).json(toSeller(row));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao adicionar vendedor.' });
  }
});

router.patch('/sellers/:id', async (req, res) => {
  const sellerId = parseId(req.params.id);
  const name = normalizeName(req.body?.name);
  if (!sellerId) return res.status(400).json({ error: 'Vendedor inválido.' });
  if (!name) return res.status(400).json({ error: 'Informe o nome do vendedor.' });

  try {
    const row = await db.get(
      `UPDATE tiktok_sellers SET name = $1 WHERE id = $2 AND user_id = $3
       RETURNING id, name, sort_order, archived_at`,
      [name, sellerId, req.session.userId]
    );
    if (!row) return res.status(404).json({ error: 'Vendedor não encontrado.' });
    return res.json(toSeller(row));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao renomear vendedor.' });
  }
});

// Remoção lógica: o vendedor sai da planilha, mas as vendas já lançadas são preservadas.
router.delete('/sellers/:id', async (req, res) => {
  const sellerId = parseId(req.params.id);
  if (!sellerId) return res.status(400).json({ error: 'Vendedor inválido.' });

  try {
    const result = await db.query(
      'UPDATE tiktok_sellers SET archived_at = NOW() WHERE id = $1 AND user_id = $2 AND archived_at IS NULL',
      [sellerId, req.session.userId]
    );
    return res.json({ archived: result.rowCount || 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao remover vendedor.' });
  }
});

router.post('/sellers/:id/restore', async (req, res) => {
  const sellerId = parseId(req.params.id);
  if (!sellerId) return res.status(400).json({ error: 'Vendedor inválido.' });

  try {
    const row = await db.get(
      `UPDATE tiktok_sellers SET archived_at = NULL WHERE id = $1 AND user_id = $2
       RETURNING id, name, sort_order, archived_at`,
      [sellerId, req.session.userId]
    );
    if (!row) return res.status(404).json({ error: 'Vendedor não encontrado.' });
    return res.json(toSeller(row));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao restaurar vendedor.' });
  }
});

// Salva uma célula da planilha. Valor vazio remove o lançamento do dia (célula vazia).
router.put('/sales', async (req, res) => {
  const sellerId = parseId(req.body?.seller_id);
  const date = String(req.body?.date || '').slice(0, 10);
  const rawAmount = req.body?.amount;
  const isEmpty = rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === '';
  const amount = isEmpty ? null : Number(rawAmount);

  if (!sellerId) return res.status(400).json({ error: 'Vendedor inválido.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  if (!isEmpty && (!Number.isFinite(amount) || amount < 0)) {
    return res.status(400).json({ error: 'Informe um valor válido (zero ou positivo).' });
  }

  try {
    const seller = await findSeller(req.session.userId, sellerId);
    if (!seller) return res.status(404).json({ error: 'Vendedor não encontrado.' });

    if (isEmpty) {
      await db.query(
        'DELETE FROM tiktok_sales WHERE user_id = $1 AND seller_id = $2 AND date = $3',
        [req.session.userId, sellerId, date]
      );
      return res.json({ ok: true, seller_id: sellerId, date, amount: null });
    }

    const value = roundMoney(amount);
    await db.query(
      `INSERT INTO tiktok_sales (user_id, seller_id, date, amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, seller_id, date)
       DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`,
      [req.session.userId, sellerId, date, value]
    );
    return res.json({ ok: true, seller_id: sellerId, date, amount: value });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar a venda.' });
  }
});

const parseExpense = (body = {}) => {
  const description = String(body.description || '').trim().slice(0, 120);
  const category = String(body.category || '').trim().slice(0, 60);
  const amount = Number(body.amount);
  const date = String(body.date || '').slice(0, 10);

  if (!description) return { error: 'Informe a descrição da despesa.' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Informe um valor maior que zero.' };
  if (!isValidDate(date)) return { error: 'Data inválida.' };
  return { value: { description, category: category || null, amount: roundMoney(amount), date } };
};

router.post('/expenses', async (req, res) => {
  const parsed = parseExpense(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const item = parsed.value;

  try {
    const row = await db.get(
      `INSERT INTO tiktok_expenses (user_id, description, category, amount, date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, description, category, amount, date`,
      [req.session.userId, item.description, item.category, item.amount, item.date]
    );
    return res.status(201).json(row);
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar despesa do TikTok.' });
  }
});

router.put('/expenses/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Despesa inválida.' });
  const parsed = parseExpense(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const item = parsed.value;

  try {
    const row = await db.get(
      `UPDATE tiktok_expenses SET description = $1, category = $2, amount = $3, date = $4
       WHERE id = $5 AND user_id = $6
       RETURNING id, description, category, amount, date`,
      [item.description, item.category, item.amount, item.date, id, req.session.userId]
    );
    if (!row) return res.status(404).json({ error: 'Despesa não encontrada.' });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao atualizar despesa do TikTok.' });
  }
});

router.delete('/expenses/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Despesa inválida.' });

  try {
    const result = await db.query('DELETE FROM tiktok_expenses WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
    return res.json({ deleted: result.rowCount || 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao excluir despesa do TikTok.' });
  }
});

module.exports = router;
