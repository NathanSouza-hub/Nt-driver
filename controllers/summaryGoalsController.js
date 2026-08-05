const summaryGoalsService = require('../services/summaryGoalsService');
const { sendError } = require('./helpers/handleError');

const getMonth = async (req, res) => {
  try {
    const payload = await summaryGoalsService.getMonthGoals(req.session.userId, req.params.month);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao carregar metas diárias.');
  }
};

const setDay = async (req, res) => {
  try {
    const payload = await summaryGoalsService.setDayGoal(req.session.userId, req.params.month, req.params.day, req.body);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao salvar meta diária.');
  }
};

module.exports = { getMonth, setDay };
