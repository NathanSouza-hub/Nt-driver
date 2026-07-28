const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('../models/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isSubscriptionActive } = require('../utils/subscription');
const { buildPixPayload, buildPixQrDataUrl } = require('../utils/pix');

const router = express.Router();

const RESET_TOKEN_MINUTES = 30;
const EMAIL_VERIFICATION_TOKEN_MINUTES = Number(process.env.EMAIL_VERIFICATION_TOKEN_MINUTES || 60 * 24);
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const PUBLIC_REGISTER_ENABLED = String(process.env.PUBLIC_REGISTER_ENABLED || 'true') === 'true';
const SUBSCRIPTION_TRIAL_DAYS = Number(process.env.SUBSCRIPTION_TRIAL_DAYS || 7);
const SUBSCRIPTION_PRICE = Number(process.env.SUBSCRIPTION_PRICE || 14.99);
const SUBSCRIPTION_LABEL = process.env.SUBSCRIPTION_LABEL || 'Acesso vitalicio NT Driver';
const PIX_KEY = process.env.PIX_KEY || '';
const PIX_KEY_OWNER = process.env.PIX_KEY_OWNER || '';
const PIX_KEY_CITY = process.env.PIX_KEY_CITY || '';

const getTrialEndsAt = () => new Date(Date.now() + (SUBSCRIPTION_TRIAL_DAYS * 24 * 60 * 60 * 1000));
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false') === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@ntdriver.local';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PASSWORD_MIN_LENGTH = 8;

const hasSmtpConfig = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const mailTransport = hasSmtpConfig
  ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  })
  : null;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => EMAIL_REGEX.test(String(email || ''));
const normalizeProfileType = (value) => {
  const profile = String(value || '').trim().toLowerCase();
  if (profile === 'driver' || profile === 'motorista') return 'driver';
  if (profile === 'personal' || profile === 'pessoal') return 'personal';
  return '';
};
const serializeProfileType = (value) => (normalizeProfileType(value) === 'personal' ? 'pessoal' : 'driver');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const getPasswordValidationErrors = (password) => {
  const rawPassword = String(password || '');
  const errors = [];

  if (rawPassword.length < PASSWORD_MIN_LENGTH) {
    errors.push(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (!/[a-z]/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos uma letra minúscula.');
  }
  if (!/[A-Z]/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos uma letra maiúscula.');
  }
  if (!/\d/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos um número.');
  }
  if (!/[^A-Za-z0-9]/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos um caractere especial.');
  }

  return errors;
};

const getPasswordValidationMessage = (password) => {
  const errors = getPasswordValidationErrors(password);
  return errors.length ? errors[0] : '';
};

const getUsersCount = async () => {
  const row = await db.get('SELECT COUNT(*)::int AS count FROM users');
  return Number(row?.count || 0);
};

const getUserById = async (id) => db.get(
  `SELECT id, name, email, is_admin, profile_type, last_login_at, email_verified_at, email_verification_required,
    subscription_status, subscription_trial_ends_at
   FROM users WHERE id = $1`,
  [id]
);

const updateLastLoginAt = async (userId) => {
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
};

const assignSessionUser = (req, user) => {
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.isAdmin = Boolean(user.is_admin);
  req.session.profileType = serializeProfileType(user.profile_type);
};

const serializeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  isAdmin: Boolean(user.is_admin),
  profileType: serializeProfileType(user.profile_type),
  emailVerified: Boolean(user.email_verified_at) || !Boolean(user.email_verification_required),
  subscriptionStatus: user.subscription_status || 'trial',
  subscriptionActive: isSubscriptionActive(user),
  subscriptionTrialEndsAt: user.subscription_trial_ends_at || null
});

const sendResetEmail = async (email, link) => {
  if (!mailTransport) {
    console.log(`[auth] Link de reset para ${email}: ${link}`);
    return;
  }

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Recuperação de senha - NT Driver',
    text: `Você solicitou recuperação de senha. Use este link: ${link}`,
    html: `<p>Você solicitou recuperação de senha.</p><p><a href=\"${link}\">Clique para redefinir sua senha</a></p><p>Se não foi você, ignore este email.</p>`
  });
};

const sendVerificationEmail = async (email, link) => {
  if (!mailTransport) {
    console.log(`[auth] Link de verificação para ${email}: ${link}`);
    return;
  }

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Confirme seu email - NT Driver',
    text: `Confirme seu email para liberar o acesso ao NT Driver: ${link}`,
    html: `<p>Confirme seu email para liberar o acesso ao NT Driver.</p><p><a href="${link}">Clique para confirmar seu email</a></p><p>Se não foi você, ignore este email.</p>`
  });
};

const buildVerificationLink = (email, token) => `${APP_BASE_URL}/api/auth/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

const buildFrontendAuthRedirectUrl = (messageCode, email = '') => {
  const params = new URLSearchParams();
  params.set('authMode', 'login');
  params.set('authMessage', messageCode);
  if (email) params.set('authEmail', email);
  return `${APP_BASE_URL}/driver?${params.toString()}`;
};

const createEmailVerification = async (client, userId, email) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
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

  return buildVerificationLink(email, rawToken);
};

router.get('/register-status', async (req, res) => {
  try {
    const count = await getUsersCount();
    return res.json({
      publicRegisterEnabled: PUBLIC_REGISTER_ENABLED || count === 0
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao verificar cadastro.' });
  }
});

router.post('/register', async (req, res) => {
  const { name, email, password, profileType } = req.body || {};
  const normalizedName = String(name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || '');
  const normalizedProfileType = normalizeProfileType(profileType);
  const passwordError = getPasswordValidationMessage(rawPassword);

  if (!normalizedName || !normalizedEmail || !normalizedProfileType || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Informe nome, email e perfil válidos.' });
  }

  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const count = await getUsersCount();
    if (!PUBLIC_REGISTER_ENABLED && count > 0) {
      return res.status(403).json({ error: 'Cadastro público desativado. Solicite acesso ao administrador.' });
    }

    // Apenas o primeiro usuario do sistema vira admin automaticamente.
    const shouldBeAdmin = count === 0;

    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const user = await db.withTransaction(async (client) => {
      const now = new Date();
      const trialEndsAt = shouldBeAdmin ? null : getTrialEndsAt();
      const subscriptionStatus = shouldBeAdmin ? 'active' : 'trial';
      const result = await client.query(
        `INSERT INTO users (
          name, email, password_hash, is_admin, profile_type, email_verified_at, email_verification_required,
          subscription_status, subscription_trial_ends_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [normalizedName, normalizedEmail, passwordHash, shouldBeAdmin, normalizedProfileType, now, false, subscriptionStatus, trialEndsAt]
      );

      return {
        id: result.rows[0]?.id || null,
        name: normalizedName,
        email: normalizedEmail,
        is_admin: shouldBeAdmin,
        profile_type: normalizedProfileType,
        email_verified_at: now,
        email_verification_required: false
      };
    });

    return res.status(201).json({
      requiresEmailVerification: false,
      email: user.email,
      message: 'Conta criada. Você já pode fazer login.'
    });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Este email já está cadastrado.' });
    }
    return res.status(500).json({ error: 'Falha ao criar usuário.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || '');

  if (!normalizedEmail || !rawPassword || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Informe email e senha.' });
  }

  try {
    const user = await db.get(
      `SELECT id, name, email, password_hash, is_admin, profile_type, email_verified_at, email_verification_required,
        subscription_status, subscription_trial_ends_at
       FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (!user) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const isValid = await bcrypt.compare(rawPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    // Verificação de email desativada

    await updateLastLoginAt(user.id);
    assignSessionUser(req, user);

    return res.json({
      user: serializeUser(user)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao autenticar.' });
  }
});

router.post('/resend-verification', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return res.json({ ok: true, message: 'Se o email existir, enviaremos um novo link de verificação.' });
  }

  try {
    const user = await db.get(
      'SELECT id, email, email_verified_at, email_verification_required FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (!user || !user.email_verification_required || user.email_verified_at) {
      return res.json({ ok: true, message: 'Se o email existir, enviaremos um novo link de verificação.' });
    }

    const verificationLink = await db.withTransaction(async (client) => createEmailVerification(client, user.id, user.email));

    try {
      await sendVerificationEmail(user.email, verificationLink);
    } catch (mailError) {
      console.error('Falha ao reenviar email de verificação:', mailError.message);
    }

    return res.json({ ok: true, message: 'Se o email existir, enviaremos um novo link de verificação.' });
  } catch (error) {
    return res.json({ ok: true, message: 'Se o email existir, enviaremos um novo link de verificação.' });
  }
});

router.get('/verify-email', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.query?.email);
  const token = String(req.query?.token || '').trim();

  if (!normalizedEmail || !token || !isValidEmail(normalizedEmail)) {
    return res.redirect(buildFrontendAuthRedirectUrl('verification_invalid', normalizedEmail));
  }

  try {
    const tokenHash = hashToken(token);
    const row = await db.get(
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
      [normalizedEmail, tokenHash]
    );

    if (!row) {
      return res.redirect(buildFrontendAuthRedirectUrl('verification_invalid', normalizedEmail));
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return res.redirect(buildFrontendAuthRedirectUrl('verification_expired', normalizedEmail));
    }

    await db.withTransaction(async (client) => {
      await client.query(
        'UPDATE users SET email_verified_at = NOW(), email_verification_required = $1 WHERE id = $2',
        [false, row.user_id]
      );
      await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    });

    return res.redirect(buildFrontendAuthRedirectUrl('email_verified', normalizedEmail));
  } catch (error) {
    return res.redirect(buildFrontendAuthRedirectUrl('verification_invalid', normalizedEmail));
  }
});

router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });

  req.session.destroy(() => {
    res.clearCookie('ntdriver.sid');
    res.json({ ok: true });
  });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const passwordError = getPasswordValidationMessage(newPassword);

  if (!currentPassword) {
    return res.status(400).json({ error: 'Informe a senha atual.' });
  }

  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const user = await db.get('SELECT id, password_hash FROM users WHERE id = $1', [req.session.userId]);
    if (!user) {
      return res.status(500).json({ error: 'Falha ao alterar senha.' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'A senha atual está incorreta.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.session.userId]);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao alterar senha.' });
  }
});

router.post('/change-name', requireAuth, async (req, res) => {
  const nextName = String(req.body?.name || '').trim();

  if (nextName.length < 2) {
    return res.status(400).json({ error: 'Informe um nome válido.' });
  }

  try {
    await db.query('UPDATE users SET name = $1 WHERE id = $2', [nextName, req.session.userId]);
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(500).json({ error: 'Falha ao atualizar nome.' });
    }

    assignSessionUser(req, user);
    return res.json({
      user: serializeUser(user)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao atualizar nome.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return res.json({ ok: true, message: 'Se o email existir, enviaremos instruções de recuperação.' });
  }

  try {
    const user = await db.get('SELECT id, email FROM users WHERE email = $1', [normalizedEmail]);
    if (!user) {
      return res.json({ ok: true, message: 'Se o email existir, enviaremos instruções de recuperação.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + (RESET_TOKEN_MINUTES * 60 * 1000));

    await db.withTransaction(async (client) => {
      await client.query(
        'DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
        [user.id]
      );

      await client.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, expiresAt]
      );
    });

    const link = `${APP_BASE_URL}/driver?email=${encodeURIComponent(user.email)}&resetToken=${encodeURIComponent(rawToken)}`;
    try {
      await sendResetEmail(user.email, link);
    } catch (mailError) {
      console.error('Falha ao enviar email de recuperação:', mailError.message);
    }

    return res.json({ ok: true, message: 'Se o email existir, enviaremos instruções de recuperação.' });
  } catch (error) {
    return res.json({ ok: true, message: 'Se o email existir, enviaremos instruções de recuperação.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);
  const token = String(req.body?.token || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  const passwordError = getPasswordValidationMessage(newPassword);

  if (!normalizedEmail || !token || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Dados inválidos para redefinir senha.' });
  }

  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const tokenHash = hashToken(token);
    const row = await db.get(
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
      [normalizedEmail, tokenHash]
    );

    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Token inválido ou expirado.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.withTransaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
      await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao redefinir senha.' });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, name, email, is_admin, profile_type, created_at, last_login_at,
        subscription_status, subscription_trial_ends_at, subscription_activated_at
       FROM users ORDER BY id ASC`
    );
    return res.json((rows || []).map((row) => ({
      ...row,
      profile_type: serializeProfileType(row.profile_type),
      subscription_active: isSubscriptionActive(row)
    })));
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar usuários.' });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const isAdmin = Boolean(req.body?.isAdmin);
  const normalizedProfileType = normalizeProfileType(req.body?.profileType) || 'driver';
  const passwordError = getPasswordValidationMessage(password);

  if (!name || !email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Informe nome e email válidos.' });
  }

  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const trialEndsAt = isAdmin ? null : getTrialEndsAt();
    const subscriptionStatus = isAdmin ? 'active' : 'trial';
    const result = await db.query(
      `INSERT INTO users (
        name, email, password_hash, is_admin, profile_type, email_verified_at, email_verification_required,
        subscription_status, subscription_trial_ends_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8) RETURNING id`,
      [name, email, passwordHash, isAdmin, normalizedProfileType, false, subscriptionStatus, trialEndsAt]
    );
    return res.status(201).json({ id: result.rows[0]?.id || null });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Este email ja esta cadastrado.' });
    }
    return res.status(500).json({ error: 'Falha ao criar usuário.' });
  }
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const newPassword = String(req.body?.newPassword || '');
  const passwordError = getPasswordValidationMessage(newPassword);

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Dados inválidos para resetar senha.' });
  }

  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    if ((result.rowCount || 0) <= 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao resetar senha.' });
  }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Usuário inválido.' });
  }

  if (Number(req.session.userId) === userId) {
    return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
  }

  try {
    await db.withTransaction(async (client) => {
      const targetUser = await client.get('SELECT id, is_admin FROM users WHERE id = $1', [userId]);
      if (!targetUser) {
        const error = new Error('Usuário não encontrado.');
        error.statusCode = 404;
        throw error;
      }

      if (targetUser.is_admin) {
        const adminCount = await client.get('SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE');
        if (Number(adminCount?.count || 0) <= 1) {
          const error = new Error('Não é permitido excluir o último administrador.');
          error.statusCode = 400;
          throw error;
        }
      }

      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    });

    return res.json({ ok: true });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Falha ao excluir usuário.' });
  }
});

router.post('/users/:id/activate-subscription', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Usuário inválido.' });
  }

  try {
    const result = await db.query(
      "UPDATE users SET subscription_status = 'active', subscription_activated_at = NOW() WHERE id = $1",
      [userId]
    );

    if ((result.rowCount || 0) <= 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao liberar acesso.' });
  }
});

router.get('/subscription/pix-info', requireAuth, async (req, res) => {
  if (!PIX_KEY || !PIX_KEY_OWNER || !PIX_KEY_CITY) {
    return res.status(500).json({ error: 'Cobrança via PIX não configurada.' });
  }

  try {
    const payload = buildPixPayload({
      key: PIX_KEY,
      amount: SUBSCRIPTION_PRICE,
      merchantName: PIX_KEY_OWNER,
      merchantCity: PIX_KEY_CITY,
      txid: `NTDRIVER${req.session.userId}`
    });
    const qrDataUrl = await buildPixQrDataUrl(payload);

    return res.json({
      pixKey: PIX_KEY,
      recipientName: PIX_KEY_OWNER,
      recipientCity: PIX_KEY_CITY,
      amount: SUBSCRIPTION_PRICE,
      label: SUBSCRIPTION_LABEL,
      copyPasteCode: payload,
      qrDataUrl
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao gerar cobrança PIX.' });
  }
});

router.post('/subscription/notify-payment', requireAuth, async (req, res) => {
  try {
    await db.query(
      "UPDATE users SET subscription_status = 'pending_review' WHERE id = $1 AND subscription_status != 'active'",
      [req.session.userId]
    );

    const user = await getUserById(req.session.userId);
    return res.json({ user: serializeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao registrar aviso de pagamento.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }

    assignSessionUser(req, user);
    return res.json({
      user: {
        ...serializeUser(user)
      }
    });
  } catch (error) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
});

module.exports = router;
