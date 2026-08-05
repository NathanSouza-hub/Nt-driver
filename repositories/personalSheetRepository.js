const db = require('../models/db');

const listRows = (userId) => db.all(
  `SELECT id, kind, name, sort_order
   FROM personal_sheet_rows
   WHERE user_id = $1
   ORDER BY kind ASC, sort_order ASC, id ASC`,
  [userId]
);

const listValues = (userId, year) => db.all(
  `SELECT row_id, month, amount, day_of_month
   FROM personal_sheet_values
   WHERE user_id = $1 AND year = $2`,
  [userId, year]
);

const getNextSortOrder = async (userId, kind) => {
  const orderRow = await db.get(
    'SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM personal_sheet_rows WHERE user_id = $1 AND kind = $2',
    [userId, kind]
  );
  return Number(orderRow?.max_order || 0) + 1;
};

const insertRow = async (userId, kind, name, sortOrder) => {
  const result = await db.query(
    `INSERT INTO personal_sheet_rows (user_id, kind, name, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, kind, name, sortOrder]
  );
  return result.rows[0]?.id || null;
};

const updateRowName = (rowId, userId, name) => db.get(
  `UPDATE personal_sheet_rows
   SET name = $1
   WHERE id = $2 AND user_id = $3
   RETURNING id, kind, name, sort_order`,
  [name, rowId, userId]
);

const deleteRow = async (rowId, userId) => {
  const result = await db.query(
    'DELETE FROM personal_sheet_rows WHERE id = $1 AND user_id = $2',
    [rowId, userId]
  );
  return result.rowCount || 0;
};

const listOwnedRowIds = (userId, rowIds) => db.all(
  'SELECT id FROM personal_sheet_rows WHERE user_id = $1 AND id = ANY($2::bigint[])',
  [userId, rowIds]
);

const applyValueUpdates = (userId, year, normalizedUpdates) => db.withTransaction(async (client) => {
  for (const item of normalizedUpdates) {
    if (item.shouldDelete) {
      await client.query(
        `DELETE FROM personal_sheet_values
         WHERE user_id = $1 AND row_id = $2 AND year = $3 AND month = $4`,
        [userId, item.rowId, year, item.month]
      );
      continue;
    }

    await client.query(
      `INSERT INTO personal_sheet_values (user_id, row_id, year, month, amount, day_of_month)
       VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, row_id, year, month)
       DO UPDATE SET
         amount = EXCLUDED.amount,
         day_of_month = EXCLUDED.day_of_month,
         updated_at = NOW()`,
      [userId, item.rowId, year, item.month, item.amount, item.day]
    );
  }
});

module.exports = {
  listRows,
  listValues,
  getNextSortOrder,
  insertRow,
  updateRowName,
  deleteRow,
  listOwnedRowIds,
  applyValueUpdates
};
