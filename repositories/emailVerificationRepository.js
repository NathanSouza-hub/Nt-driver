const db = require('../models/db');
const { hashToken, generateRawToken } = require('../utils/tokens');

const EMAIL_VERIFICATION_TOKEN_MINUTES = Number(process.env.EMAIL_VERIFICATION_TOKEN_MINUTES || 60 * 24);

const createForUser = (userId) => db.withTransaction(async (client) => {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + (EMAIL_VERIFICATION_TOKEN_MINUTES * 60 * 1000));

  await client.query(
    'DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  await client.query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );
  await client.query(
    'UPDATE users SET email_verification_required = $1, email_verified_at = NULL WHERE id = $2',
    [true, userId]
  );

  return rawToken;
});

const findValidByEmailAndToken = (email, token) => {
  const tokenHash = hashToken(token);
  return db.get(
    `
      SELECT evt.id, evt.user_id, evt.expires_at, u.email
      FROM email_verification_tokens evt
      INNER JOIN users u ON u.id = evt.user_id
      WHERE u.email = $1
        AND evt.token_hash = $2
        AND evt.used_at IS NULL
      ORDER BY evt.id DESC
      LIMIT 1
    `,
    [email, tokenHash]
  );
};

const consume = (tokenId, userId) => db.withTransaction(async (client) => {
  await client.query(
    'UPDATE users SET email_verified_at = NOW(), email_verification_required = $1 WHERE id = $2',
    [false, userId]
  );
  await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [tokenId]);
});

module.exports = { createForUser, findValidByEmailAndToken, consume };
