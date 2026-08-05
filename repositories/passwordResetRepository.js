const db = require('../models/db');
const { hashToken, generateRawToken } = require('../utils/tokens');

const RESET_TOKEN_MINUTES = 30;

const createForUser = (userId) => db.withTransaction(async (client) => {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + (RESET_TOKEN_MINUTES * 60 * 1000));

  await client.query(
    'DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  await client.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );

  return rawToken;
});

const findValidByEmailAndToken = (email, token) => {
  const tokenHash = hashToken(token);
  return db.get(
    `
      SELECT prt.id, prt.user_id, prt.expires_at
      FROM password_reset_tokens prt
      INNER JOIN users u ON u.id = prt.user_id
      WHERE u.email = $1
        AND prt.token_hash = $2
        AND prt.used_at IS NULL
      ORDER BY prt.id DESC
      LIMIT 1
    `,
    [email, tokenHash]
  );
};

const consume = (tokenId, userId, passwordHash) => db.withTransaction(async (client) => {
  await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
  await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [tokenId]);
});

module.exports = { RESET_TOKEN_MINUTES, createForUser, findValidByEmailAndToken, consume };
