const bcrypt = require('bcryptjs');
const { AppError } = require('../errors/AppError');
const userRepository = require('../repositories/userRepository');
const { normalizeEmail, isValidEmail } = require('../utils/email-format');
const { normalizeProfileType, serializeProfileType } = require('../utils/profile-type');
const { getPasswordValidationMessage } = require('../utils/password');
const { isSubscriptionActive } = require('../utils/subscription');

const SUBSCRIPTION_TRIAL_DAYS = Number(process.env.SUBSCRIPTION_TRIAL_DAYS || 7);
const getTrialEndsAt = () => new Date(Date.now() + (SUBSCRIPTION_TRIAL_DAYS * 24 * 60 * 60 * 1000));

const listUsers = async () => {
  const rows = await userRepository.listAllForAdmin();
  return (rows || []).map((row) => ({
    ...row,
    profile_type: serializeProfileType(row.profile_type),
    subscription_active: isSubscriptionActive(row)
  }));
};

const createUser = async ({ name, email, password, isAdmin, profileType }) => {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || '');
  const normalizedIsAdmin = Boolean(isAdmin);
  const normalizedProfileType = normalizeProfileType(profileType) || 'driver';
  const passwordError = getPasswordValidationMessage(rawPassword);

  if (!normalizedName || !normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new AppError(400, 'Informe nome e email válidos.');
  }
  if (passwordError) {
    throw new AppError(400, passwordError);
  }

  try {
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const trialEndsAt = normalizedIsAdmin ? null : getTrialEndsAt();
    const subscriptionStatus = normalizedIsAdmin ? 'active' : 'trial';

    const id = await userRepository.insertUserByAdmin({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      isAdmin: normalizedIsAdmin,
      profileType: normalizedProfileType,
      subscriptionStatus,
      trialEndsAt
    });

    return { id };
  } catch (error) {
    if (error?.code === '23505') {
      throw new AppError(409, 'Este email ja esta cadastrado.');
    }
    throw error;
  }
};

const adminResetPassword = async (rawUserId, rawNewPassword) => {
  const userId = Number(rawUserId);
  const newPassword = String(rawNewPassword || '');
  const passwordError = getPasswordValidationMessage(newPassword);

  if (!Number.isFinite(userId) || userId <= 0) {
    throw new AppError(400, 'Dados inválidos para resetar senha.');
  }
  if (passwordError) {
    throw new AppError(400, passwordError);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await userRepository.updatePasswordHash(userId, passwordHash);

  if (updated <= 0) {
    throw new AppError(404, 'Usuário não encontrado.');
  }
};

const deleteUser = async (requestingUserId, rawUserId) => {
  const userId = Number(rawUserId);

  if (!Number.isFinite(userId) || userId <= 0) {
    throw new AppError(400, 'Usuário inválido.');
  }
  if (Number(requestingUserId) === userId) {
    throw new AppError(400, 'Você não pode excluir sua própria conta.');
  }

  const result = await userRepository.deleteUserChecked(userId);

  if (!result.deleted) {
    if (result.reason === 'not_found') {
      throw new AppError(404, 'Usuário não encontrado.');
    }
    if (result.reason === 'last_admin') {
      throw new AppError(400, 'Não é permitido excluir o último administrador.');
    }
  }
};

const activateSubscription = async (rawUserId) => {
  const userId = Number(rawUserId);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new AppError(400, 'Usuário inválido.');
  }

  const updated = await userRepository.activateSubscription(userId);
  if (updated <= 0) {
    throw new AppError(404, 'Usuário não encontrado.');
  }
};

module.exports = { listUsers, createUser, adminResetPassword, deleteUser, activateSubscription };
