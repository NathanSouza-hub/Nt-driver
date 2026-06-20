const express = require('express');
const db = require('../models/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const parseMonthKey = (value) => {
  const monthKey = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : '';
};

const parseDay = (value) => {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

const parseGoal = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const goal = Number(value);
  return Number.isFinite(goal) && goal >= 0 ? goal : null;
};

router.get('/:month', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  if (!month) return res.status(400).json({ error: 'Mês inválido.' });

  try {
    const rows = await db.all(
      `SELECT day_of_month, goal, day_off
       FROM summary_daily_goals
       WHERE user_id = $1 AND year_month = $2
       ORDER BY day_of_month ASC`,
      [req.session.userId, month]
    );

    const days = {};
    (rows || []).forEach((row) => {
      days[String(row.day_of_month)] = {
        goal: row.goal === null || row.goal === undefined ? undefined : Number(row.goal),
        dayOff: Boolean(row.day_off)
      };
    });

    return res.json({ month, days });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar metas diárias.' });
  }
});

router.put('/:month/:day', async (req, res) => {
  const month = parseMonthKey(req.params.month);
  const day = parseDay(req.params.day);
  if (!month || !day) return res.status(400).json({ error: 'Data inválida.' });

  const goal = parseGoal(req.body?.goal);
  const hasGoal = req.body && Object.prototype.hasOwnProperty.call(req.body, 'goal');
  const dayOff = Boolean(req.body?.dayOff);

  try {
    if (!dayOff && (!hasGoal || goal === null)) {
      await db.query(
        `DELETE FROM summary_daily_goals
         WHERE user_id = $1 AND year_month = $2 AND day_of_month = $3`,
        [req.session.userId, month, day]
      );
      return res.json({ ok: true, deleted: true });
    }

    await db.query(
      `INSERT INTO summary_daily_goals (user_id, year_month, day_of_month, goal, day_off)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, year_month, day_of_month)
       DO UPDATE SET
         goal = EXCLUDED.goal,
         day_off = EXCLUDED.day_off,
         updated_at = NOW()`,
      [req.session.userId, month, day, hasGoal ? goal : null, dayOff]
    );

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar meta diária.' });
  }
});

module.exports = router;
