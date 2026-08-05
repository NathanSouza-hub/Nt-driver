const db = require('../models/db');

const SELECT_BY_USER_SQL = `
  SELECT *
  FROM personal_expenses
  WHERE user_id = $1
  ORDER BY due_day ASC, date ASC, id DESC
`;

const listByUser = (userId) => db.all(SELECT_BY_USER_SQL, [userId]);

const replaceAll = (userId, items) => db.withTransaction(async (client) => {
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

  const result = await client.query(SELECT_BY_USER_SQL, [userId]);
  return result.rows || [];
});

module.exports = { listByUser, replaceAll };
