const bcrypt = require('bcryptjs');
const { AppError } = require('../errors/AppError');
const userRepository = require('../repositories/userRepository');
const emailVerificationRepository = require('../repositories/emailVerificationRepository');
const passwordResetRepository = require('../repositories/passwordResetRepository');
const emailNotificationService = require('./emailNotificationService');
const { normalizeEmail, isValidEmail } = require('../utils/email-format');
const { normalizeProfileType } = require('../utils/profile-type');
const { getPasswordValidationMessage } = require('../utils/password');
const { hashToken } = require('../utils/tokens');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const PUBLIC_REGISTER_ENABLED = String(process.env.PUBLIC_REGISTER_ENABLED || 'true') === 'true';
const SUBSCRIPTION_TRIAL_DAYS = Number(process.env.SUBSCRIPTION_TRIAL_DAYS || 7);

const getTrialEndsAt = () => new Date(Date.now() + (SUBSCRIPTION_TRIAL_DAYS * 24 * 60 * 60 * 1000));

const buildVerificationLink = (email, token) => `${APP_BASE_URL}/api/auth/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

const buildFrontendAuthRedirectUrl = (messageCode, email = '') => {
  const params = new URLSearchParams();
  params.set('authMode', 'login');
  params.set('authMessage', messageCode);
  if (email) params.set('authEmail', email);
  return `${APP_BASE_URL}/driver?${params.toString()}`;
};

const getRegisterStatus = async () => {
  const count = await userRepository.getUsersCount();
  return { publicRegisterEnabled: PUBLIC_REGISTER_ENABLED || count === 0 };
};

const register = async ({ name, email, password, profileType }) => {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || '');
  const normalizedProfileType = normalizeProfileType(profileType);
  const passwordError = getPasswordValidationMessage(rawPassword);

  if (!normalizedName || !normalizedEmail || !normalizedProfileType || !isValidEmail(normalizedEmail)) {
    throw new AppError(400, 'Informe nome, email e perfil válidos.');
  }
  if (passwordError) {
    throw new AppError(400, passwordError);
  }

  const count = await userRepository.getUsersCount();
  if (!PUBLIC_REGISTER_ENABLED && count > 0) {
    throw new AppError(403, 'Cadastro público desativado. Solicite acesso ao administrador.');
  }

  // Apenas o primeiro usuario do sistema vira admin automaticamente.
  const shouldBeAdmin = count === 0;
  const passwordHash = await bcrypt.hash(rawPassword, 10);
  const now = new Date();
  const trialEndsAt = shouldBeAdmin ? null : getTrialEndsAt();
  const subscriptionStatus = shouldBeAdmin ? 'active' : 'trial';

  let user;
  try {
    user = await userRepository.insertUserOnRegister({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      isAdmin: shouldBeAdmin,
      profileType: normalizedProfileType,
      now,
      subscriptionStatus,
      trialEndsAt
    });
  } catch (error) {
    if (error?.code === '23505') {
      throw new AppError(409, 'Este email já está cadastrado.');
    }
    throw error;
  }

  return {
    requiresEmailVerification: false,
    email: user.email,
    message: 'Conta criada. Você já pode fazer login.'
  };
};

const login = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || '');

  if (!normalizedEmail || !rawPassword || !isValidEmail(normalizedEmail)) {
    throw new AppError(400, 'Informe email e senha.');
  }

  const user = await userRepository.findByEmailForLogin(normalizedEmail);
  if (!user) {
    throw new AppError(401, 'Email ou senha inválidos.');
  }

  const isValid = await bcrypt.compare(rawPassword, user.password_hash);
  if (!isValid) {
    throw new AppError(401, 'Email ou senha inválidos.');
  }

  // Verificação de email desativada

  await userRepository.updateLastLoginAt(user.id);

  return user;
};

const resendVerification = async (rawEmail) => {
  const GENERIC_MESSAGE = 'Se o email existir, enviaremos um novo link de verificação.';
  const normalizedEmail = normalizeEmail(rawEmail);

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return { ok: true, message: GENERIC_MESSAGE };
  }

  try {
    const user = await userRepository.findByEmailForVerification(normalizedEmail);
    if (!user || !user.email_verification_required || user.email_verified_at) {
      return { ok: true, message: GENERIC_MESSAGE };
    }

    const rawToken = await emailVerificationRepository.createForUser(user.id);
    const verificationLink = buildVerificationLink(user.email, rawToken);

    try {
      await emailNotificationService.sendVerificationEmail(user.email, verificationLink);
    } catch (mailError) {
      console.error('Falha ao reenviar email de verificação:', mailError.message);
    }

    return { ok: true, message: GENERIC_MESSAGE };
  } catch (error) {
    return { ok: true, message: GENERIC_MESSAGE };
  }
};

const verifyEmail = async (rawEmail, rawToken) => {
  const normalizedEmail = normalizeEmail(rawEmail);
  const token = String(rawToken || '').trim();

  if (!normalizedEmail || !token || !isValidEmail(normalizedEmail)) {
    return buildFrontendAuthRedirectUrl('verification_invalid', normalizedEmail);
  }

  try {
    const row = await emailVerificationRepository.findValidByEmailAndToken(normalizedEmail, token);

    if (!row) {
      return buildFrontendAuthRedirectUrl('verification_invalid', normalizedEmail);
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return buildFrontendAuthRedirectUrl('verification_expired', normalizedEmail);
    }

    await emailVerificationRepository.consume(row.id, row.user_id);

    return buildFrontendAuthRedirectUrl('email_verified', normalizedEmail);
  } catch (error) {
    return buildFrontendAuthRedirectUrl('verification_invalid', normalizedEmail);
  }
};

const changePassword = async (userId, rawCurrentPassword, rawNewPassword) => {
  const currentPassword = String(rawCurrentPassword || '');
  const newPassword = String(rawNewPassword || '');
  const passwordError = getPasswordValidationMessage(newPassword);

  if (!currentPassword) {
    throw new AppError(400, 'Informe a senha atual.');
  }
  if (passwordError) {
    throw new AppError(400, passwordError);
  }

  const user = await userRepository.findPasswordHashById(userId);
  if (!user) {
    throw new AppError(500, 'Falha ao alterar senha.');
  }

  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValid) {
    throw new AppError(401, 'A senha atual está incorreta.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await userRepository.updatePasswordHash(userId, passwordHash);
};

const changeName = async (userId, rawName) => {
  const nextName = String(rawName || '').trim();
  if (nextName.length < 2) {
    throw new AppError(400, 'Informe um nome válido.');
  }

  await userRepository.updateName(userId, nextName);
  const user = await userRepository.getUserById(userId);
  if (!user) {
    throw new AppError(500, 'Falha ao atualizar nome.');
  }

  return user;
};

const forgotPassword = async (rawEmail) => {
  const GENERIC_MESSAGE = 'Se o email existir, enviaremos instruções de recuperação.';
  const normalizedEmail = normalizeEmail(rawEmail);

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return { ok: true, message: GENERIC_MESSAGE };
  }

  try {
    const user = await userRepository.findByEmailBasic(normalizedEmail);
    if (!user) {
      return { ok: true, message: GENERIC_MESSAGE };
    }

    const rawToken = await passwordResetRepository.createForUser(user.id);
    const link = `${APP_BASE_URL}/driver?email=${encodeURIComponent(user.email)}&resetToken=${encodeURIComponent(rawToken)}`;

    try {
      await emailNotificationService.sendResetEmail(user.email, link);
    } catch (mailError) {
      console.error('Falha ao enviar email de recuperação:', mailError.message);
    }

    return { ok: true, message: GENERIC_MESSAGE };
  } catch (error) {
    return { ok: true, message: GENERIC_MESSAGE };
  }
};

const resetPassword = async (rawEmail, rawToken, rawNewPassword) => {
  const normalizedEmail = normalizeEmail(rawEmail);
  const token = String(rawToken || '').trim();
  const newPassword = String(rawNewPassword || '');
  const passwordError = getPasswordValidationMessage(newPassword);

  if (!normalizedEmail || !token || !isValidEmail(normalizedEmail)) {
    throw new AppError(400, 'Dados inválidos para redefinir senha.');
  }
  if (passwordError) {
    throw new AppError(400, passwordError);
  }

  const row = await passwordResetRepository.findValidByEmailAndToken(normalizedEmail, token);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(400, 'Token inválido ou expirado.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await passwordResetRepository.consume(row.id, row.user_id, passwordHash);
};

const getCurrentUser = async (userId) => {
  const user = await userRepository.getUserById(userId);
  if (!user) {
    throw new AppError(401, 'Não autenticado.');
  }
  return user;
};

module.exports = {
  getRegisterStatus,
  register,
  login,
  resendVerification,
  verifyEmail,
  changePassword,
  changeName,
  forgotPassword,
  resetPassword,
  getCurrentUser
};
