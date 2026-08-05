const personalExpensesService = require('../services/personalExpensesService');
const { sendError } = require('./helpers/handleError');

const list = async (req, res) => {
  try {
    const rows = await personalExpensesService.listExpenses(req.session.userId);
    res.json(rows);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao carregar despesas pessoais.');
  }
};

const replace = async (req, res) => {
  try {
    const payload = await personalExpensesService.replaceExpenses(req.session.userId, req.body?.items);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao salvar despesas pessoais.');
  }
};

module.exports = { list, replace };
