const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

router.get('/', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT * FROM records WHERE user_id = $1 ORDER BY date DESC, id DESC',
      [req.session.userId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Falha ao carregar registros.' });
  }
});

router.post('/', async (req, res) => {
  const { date, income_value, income_source, expense_value, expense_type, operation_notes, km, hours_worked } = req.body || {};
  try {
    const result = await db.query(
      `INSERT INTO records (user_id, date, income_value, income_source, expense_value, expense_type, km, hours_worked, operation_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [req.session.userId, date, income_value, income_source, expense_value, expense_type, km, hours_worked, operation_notes]
    );
    res.status(201).json({ id: result.rows[0]?.id || null });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao salvar registro.' });
  }
});

router.delete('/by-date/:date', async (req, res) => {
  const rawDate = req.params.date || '';
  const date = decodeURIComponent(rawDate).trim();
  if (!date) {
    return res.status(400).json({ error: 'Data inválida.' });
  }

  try {
    const result = await db.query(
      `DELETE FROM records
       WHERE user_id = $1
         AND (
           date = $2
           OR date LIKE $3
           OR SUBSTRING(date FROM 1 FOR 10) = $4
         )`,
      [req.session.userId, date, `${date}%`, date]
    );
    res.json({ deleted: result.rowCount || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao remover registros.' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { date, income_value, income_source, expense_value, expense_type, km, hours_worked } = req.body || {};

  try {
    const result = await db.query(
      `UPDATE records
       SET date = $1, income_value = $2, income_source = $3, expense_value = $4, expense_type = $5, km = $6, hours_worked = $7
       WHERE id = $8 AND user_id = $9`,
      [date, income_value, income_source, expense_value, expense_type, km, hours_worked, id, req.session.userId]
    );
    res.json({ updated: result.rowCount || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao atualizar registro.' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM records WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
    res.json({ deleted: result.rowCount || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao excluir registro.' });
  }
});

module.exports = router;
