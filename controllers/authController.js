const authService = require('../services/authService');
const { serializeUser } = require('../utils/user-dto');
const { normalizeProfileType } = require('../utils/profile-type');
const { sendError } = require('./helpers/handleError');

const assignSessionUser = (req, user) => {
  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.isAdmin = Boolean(user.is_admin);
  req.session.profileType = normalizeProfileType(user.profile_type);
};

const registerStatus = async (req, res) => {
  try {
    const payload = await authService.getRegisterStatus();
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao verificar cadastro.');
  }
};

const register = async (req, res) => {
  try {
    const payload = await authService.register(req.body || {});
    res.status(201).json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao criar usuário.');
  }
};

const login = async (req, res) => {
  try {
    const user = await authService.login(req.body || {});
    assignSessionUser(req, user);
    res.json({ user: serializeUser(user) });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao autenticar.');
  }
};

const resendVerification = async (req, res) => {
  const payload = await authService.resendVerification(req.body?.email);
  res.json(payload);
};

const verifyEmail = async (req, res) => {
  const redirectUrl = await authService.verifyEmail(req.query?.email, req.query?.token);
  res.redirect(redirectUrl);
};

const logout = (req, res) => {
  if (!req.session) return res.json({ ok: true });

  req.session.destroy(() => {
    res.clearCookie('ntdriver.sid');
    res.json({ ok: true });
  });
};

const changePassword = async (req, res) => {
  try {
    await authService.changePassword(req.session.userId, req.body?.currentPassword, req.body?.newPassword);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao alterar senha.');
  }
};

const changeName = async (req, res) => {
  try {
    const user = await authService.changeName(req.session.userId, req.body?.name);
    assignSessionUser(req, user);
    res.json({ user: serializeUser(user) });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao atualizar nome.');
  }
};

const forgotPassword = async (req, res) => {
  const payload = await authService.forgotPassword(req.body?.email);
  res.json(payload);
};

const resetPassword = async (req, res) => {
  try {
    await authService.resetPassword(req.body?.email, req.body?.token, req.body?.newPassword);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao redefinir senha.');
  }
};

const me = async (req, res) => {
  try {
    const user = await authService.getCurrentUser(req.session.userId);
    assignSessionUser(req, user);
    res.json({ user: { ...serializeUser(user) } });
  } catch (error) {
    sendError(res, error, 401, 'Não autenticado.');
  }
};

module.exports = {
  registerStatus,
  register,
  login,
  resendVerification,
  verifyEmail,
  logout,
  changePassword,
  changeName,
  forgotPassword,
  resetPassword,
  me
};
