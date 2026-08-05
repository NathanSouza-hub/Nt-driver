const db = require('../models/db');

const DEFAULT_CONTENT_HTML = '<p></p>';

const listByUser = (userId) => db.all(
  `
    SELECT id, title, created_at, updated_at
    FROM admin_note_documents
    WHERE user_id = $1
    ORDER BY updated_at DESC, id DESC
  `,
  [userId]
);

const getById = (userId, documentId) => db.get(
  `
    SELECT id, title, content_html, created_at, updated_at
    FROM admin_note_documents
    WHERE user_id = $1 AND id = $2
    LIMIT 1
  `,
  [userId, documentId]
);

const getLatestByUser = (userId) => db.get(
  `
    SELECT id, title, content_html, created_at, updated_at
    FROM admin_note_documents
    WHERE user_id = $1
    ORDER BY id DESC
    LIMIT 1
  `,
  [userId]
);

const insertDocument = async (userId, title) => {
  await db.query(
    `
      INSERT INTO admin_note_documents (user_id, title, content_html)
      VALUES ($1, $2, $3)
    `,
    [userId, title, DEFAULT_CONTENT_HTML]
  );

  return getLatestByUser(userId);
};

const updateDocument = (userId, documentId, title, contentHtml) => db.query(
  `
    UPDATE admin_note_documents
    SET title = $3,
        content_html = $4,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND id = $2
  `,
  [userId, documentId, title, contentHtml]
);

const deleteDocument = (userId, documentId) => db.query(
  `
    DELETE FROM admin_note_documents
    WHERE user_id = $1 AND id = $2
  `,
  [userId, documentId]
);

module.exports = { listByUser, getById, insertDocument, updateDocument, deleteDocument, DEFAULT_CONTENT_HTML };
