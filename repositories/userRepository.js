const db = require('../models/db');

const getUsersCount = async () => {
  const row = await db.get('SELECT COUNT(*)::int AS count FROM users');
  return Number(row?.count || 0);
};

const getUserById = (id) => db.get(
  `SELECT id, name, email, is_admin, profile_type, last_login_at, email_verified_at, email_verification_required,
    subscription_status, subscription_trial_ends_at
   FROM users WHERE id = $1`,
  [id]
);

const findByEmailForLogin = (email) => db.get(
  `SELECT id, name, email, password_hash, is_admin, profile_type, email_verified_at, email_verification_required,
    subscription_status, subscription_trial_ends_at
   FROM users WHERE email = $1`,
  [email]
);

const findByEmailForVerification = (email) => db.get(
  'SELECT id, email, email_verified_at, email_verification_required FROM users WHERE email = $1',
  [email]
);

const findByEmailBasic = (email) => db.get(
  'SELECT id, email FROM users WHERE email = $1',
  [email]
);

const findPasswordHashById = (id) => db.get('SELECT id, password_hash FROM users WHERE id = $1', [id]);

const updateLastLoginAt = async (userId) => {
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
};

const updateName = async (userId, name) => {
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
};

const updatePasswordHash = async (userId, passwordHash) => {
  const result = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
  return result.rowCount || 0;
};

const insertUserOnRegister = (fields) => db.withTransaction(async (client) => {
  const { name, email, passwordHash, isAdmin, profileType, now, subscriptionStatus, trialEndsAt } = fields;

  const result = await client.query(
    `INSERT INTO users (
      name, email, password_hash, is_admin, profile_type, email_verified_at, email_verification_required,
      subscription_status, subscription_trial_ends_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [name, email, passwordHash, isAdmin, profileType, now, false, subscriptionStatus, trialEndsAt]
  );

  return {
    id: result.rows[0]?.id || null,
    name,
    email,
    is_admin: isAdmin,
    profile_type: profileType,
    email_verified_at: now,
    email_verification_required: false
  };
});

const listAllForAdmin = () => db.all(
  `SELECT id, name, email, is_admin, profile_type, created_at, last_login_at,
    subscription_status, subscription_trial_ends_at, subscription_activated_at
   FROM users ORDER BY id ASC`
);

const insertUserByAdmin = async (fields) => {
  const { name, email, passwordHash, isAdmin, profileType, subscriptionStatus, trialEndsAt } = fields;
  const result = await db.query(
    `INSERT INTO users (
      name, email, password_hash, is_admin, profile_type, email_verified_at, email_verification_required,
      subscription_status, subscription_trial_ends_at
    ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8) RETURNING id`,
    [name, email, passwordHash, isAdmin, profileType, false, subscriptionStatus, trialEndsAt]
  );
  return result.rows[0]?.id || null;
};

const activateSubscription = async (userId) => {
  const result = await db.query(
    "UPDATE users SET subscription_status = 'active', subscription_activated_at = NOW() WHERE id = $1",
    [userId]
  );
  return result.rowCount || 0;
};

const markPendingReview = async (userId) => {
  await db.query(
    "UPDATE users SET subscription_status = 'pending_review' WHERE id = $1 AND subscription_status != 'active'",
    [userId]
  );
};

// Encapsula a checagem "nao e o ultimo admin" na mesma transacao do delete,
// para evitar corrida entre a checagem e a exclusao. Nao lanca erro de
// dominio (isso e responsabilidade do service) - so retorna o motivo.
const deleteUserChecked = (userId) => db.withTransaction(async (client) => {
  const targetUser = await client.get('SELECT id, is_admin FROM users WHERE id = $1', [userId]);
  if (!targetUser) {
    return { deleted: false, reason: 'not_found' };
  }

  if (targetUser.is_admin) {
    const adminCount = await client.get('SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE');
    if (Number(adminCount?.count || 0) <= 1) {
      return { deleted: false, reason: 'last_admin' };
    }
  }

  await client.query('DELETE FROM users WHERE id = $1', [userId]);
  return { deleted: true };
});

module.exports = {
  getUsersCount,
  getUserById,
  findByEmailForLogin,
  findByEmailForVerification,
  findByEmailBasic,
  findPasswordHashById,
  updateLastLoginAt,
  updateName,
  updatePasswordHash,
  insertUserOnRegister,
  listAllForAdmin,
  insertUserByAdmin,
  activateSubscription,
  markPendingReview,
  deleteUserChecked
};
