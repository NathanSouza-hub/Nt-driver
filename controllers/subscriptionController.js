const subscriptionPaymentService = require('../services/subscriptionPaymentService');
const { sendError } = require('./helpers/handleError');

const pixInfo = async (req, res) => {
  try {
    const payload = await subscriptionPaymentService.getPixCharge(req.session.userId);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao gerar cobrança PIX.');
  }
};

const notifyPayment = async (req, res) => {
  try {
    const payload = await subscriptionPaymentService.notifyPayment(req.session.userId);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao registrar aviso de pagamento.');
  }
};

module.exports = { pixInfo, notifyPayment };
