const db = require('../models/db');
const { isSubscriptionActive } = require('../utils/subscription');

const BLOCKED_MESSAGE = 'Sua conta está bloqueada. Entre em contato com o administrador.';

// SQLite guarda booleanos como 0/1; Postgres como true/false.
const isUserBlocked = (user) => user?.is_blocked === true || Number(user?.is_blocked) === 1;

const clearSessionAndReject = (req, res, body = { error: 'Nao autenticado.' }) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('ntdriver.sid');
      res.status(401).json(body);
    });
    return;
  }

  res.status(401).json(body);
};

// Conta bloqueada: encerra a sessão existente (sessões anteriores ao bloqueio deixam de valer).
const rejectBlocked = (req, res) => clearSessionAndReject(req, res, { error: BLOCKED_MESSAGE, code: 'account_blocked' });

const requireAuth = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Nao autenticado.' });
  }

  try {
    const user = await db.get(
      'SELECT id, is_admin, is_blocked, subscription_status, subscription_trial_ends_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (!user) {
      return clearSessionAndReject(req, res);
    }
    if (isUserBlocked(user)) {
      return rejectBlocked(req, res);
    }

    req.session.isAdmin = Boolean(user.is_admin);
    req.session.subscriptionActive = isSubscriptionActive(user);
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao validar sessao.' });
  }
};

const requireActiveSubscription = (req, res, next) => {
  if (req.session && req.session.subscriptionActive) {
    return next();
  }

  return res.status(403).json({
    error: 'Assinatura necessaria para acessar este recurso.',
    code: 'subscription_required'
  });
};

const requireAdmin = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Nao autenticado.' });
  }

  try {
    const user = await db.get('SELECT id, is_admin, is_blocked FROM users WHERE id = $1', [req.session.userId]);
    if (!user) {
      return clearSessionAndReject(req, res);
    }
    if (isUserBlocked(user)) {
      return rejectBlocked(req, res);
    }
    if (!user.is_admin) {
      return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    }

    req.session.isAdmin = true;
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao validar sessao.' });
  }
};

module.exports = {
  requireAuth,
  requireAdmin,
  requireActiveSubscription,
  isUserBlocked,
  BLOCKED_MESSAGE
};
