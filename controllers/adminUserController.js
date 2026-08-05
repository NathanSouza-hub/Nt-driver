const adminUserService = require('../services/adminUserService');
const { sendError } = require('./helpers/handleError');

const list = async (req, res) => {
  try {
    const rows = await adminUserService.listUsers();
    res.json(rows);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao carregar usuários.');
  }
};

const create = async (req, res) => {
  try {
    const payload = await adminUserService.createUser({
      name: req.body?.name,
      email: req.body?.email,
      password: req.body?.password,
      isAdmin: req.body?.isAdmin,
      profileType: req.body?.profileType
    });
    res.status(201).json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao criar usuário.');
  }
};

const resetPassword = async (req, res) => {
  try {
    await adminUserService.adminResetPassword(req.params.id, req.body?.newPassword);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao resetar senha.');
  }
};

const remove = async (req, res) => {
  try {
    await adminUserService.deleteUser(req.session.userId, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao excluir usuário.');
  }
};

const activateSubscription = async (req, res) => {
  try {
    await adminUserService.activateSubscription(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao liberar acesso.');
  }
};

module.exports = { list, create, resetPassword, remove, activateSubscription };
