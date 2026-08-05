const db = require('../models/db');

const listByUser = (userId) => db.all(
  'SELECT * FROM records WHERE user_id = $1 ORDER BY date DESC, id DESC',
  [userId]
);

const create = async (userId, fields) => {
  const { date, income_value, income_source, expense_value, expense_type, operation_notes, km, hours_worked } = fields;
  const result = await db.query(
    `INSERT INTO records (user_id, date, income_value, income_source, expense_value, expense_type, km, hours_worked, operation_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, date, income_value, income_source, expense_value, expense_type, km, hours_worked, operation_notes]
  );
  return result.rows[0]?.id || null;
};

const deleteByDate = async (userId, date) => {
  const result = await db.query(
    `DELETE FROM records
     WHERE user_id = $1
       AND (
         date = $2
         OR date LIKE $3
         OR SUBSTRING(date FROM 1 FOR 10) = $4
       )`,
    [userId, date, `${date}%`, date]
  );
  return result.rowCount || 0;
};

const updateById = async (id, userId, fields) => {
  const { date, income_value, income_source, expense_value, expense_type, km, hours_worked } = fields;
  const result = await db.query(
    `UPDATE records
     SET date = $1, income_value = $2, income_source = $3, expense_value = $4, expense_type = $5, km = $6, hours_worked = $7
     WHERE id = $8 AND user_id = $9`,
    [date, income_value, income_source, expense_value, expense_type, km, hours_worked, id, userId]
  );
  return result.rowCount || 0;
};

const deleteById = async (id, userId) => {
  const result = await db.query('DELETE FROM records WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rowCount || 0;
};

module.exports = { listByUser, create, deleteByDate, updateById, deleteById };
