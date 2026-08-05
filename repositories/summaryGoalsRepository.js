const db = require('../models/db');

const listByMonth = (userId, month) => db.all(
  `SELECT day_of_month, goal, day_off
   FROM summary_daily_goals
   WHERE user_id = $1 AND year_month = $2
   ORDER BY day_of_month ASC`,
  [userId, month]
);

const deleteGoal = (userId, month, day) => db.query(
  `DELETE FROM summary_daily_goals
   WHERE user_id = $1 AND year_month = $2 AND day_of_month = $3`,
  [userId, month, day]
);

const upsertGoal = (userId, month, day, goal, dayOff) => db.query(
  `INSERT INTO summary_daily_goals (user_id, year_month, day_of_month, goal, day_off)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (user_id, year_month, day_of_month)
   DO UPDATE SET
     goal = EXCLUDED.goal,
     day_off = EXCLUDED.day_off,
     updated_at = NOW()`,
  [userId, month, day, goal, dayOff]
);

module.exports = { listByMonth, deleteGoal, upsertGoal };
