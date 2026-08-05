const { AppError } = require('../errors/AppError');
const userRepository = require('../repositories/userRepository');
const { buildPixPayload, buildPixQrDataUrl } = require('../utils/pix');
const { formatBrl } = require('../utils/money');
const { serializeUser } = require('../utils/user-dto');
const whatsappNotificationService = require('./whatsappNotificationService');

const SUBSCRIPTION_PRICE = Number(process.env.SUBSCRIPTION_PRICE || 14.99);
const SUBSCRIPTION_LABEL = process.env.SUBSCRIPTION_LABEL || 'Acesso vitalicio NT Driver';
const PIX_KEY = process.env.PIX_KEY || '';
const PIX_KEY_OWNER = process.env.PIX_KEY_OWNER || '';
const PIX_KEY_CITY = process.env.PIX_KEY_CITY || '';

const getPixCharge = async (userId) => {
  if (!PIX_KEY || !PIX_KEY_OWNER || !PIX_KEY_CITY) {
    throw new AppError(500, 'Cobrança via PIX não configurada.');
  }

  const payload = buildPixPayload({
    key: PIX_KEY,
    amount: SUBSCRIPTION_PRICE,
    merchantName: PIX_KEY_OWNER,
    merchantCity: PIX_KEY_CITY,
    txid: `NTDRIVER${userId}`
  });
  const qrDataUrl = await buildPixQrDataUrl(payload);

  return {
    pixKey: PIX_KEY,
    recipientName: PIX_KEY_OWNER,
    recipientCity: PIX_KEY_CITY,
    amount: SUBSCRIPTION_PRICE,
    label: SUBSCRIPTION_LABEL,
    copyPasteCode: payload,
    qrDataUrl
  };
};

const notifyPayment = async (userId) => {
  await userRepository.markPendingReview(userId);
  const user = await userRepository.getUserById(userId);

  whatsappNotificationService.sendWhatsAppAlert(
    `NT Driver: ${user.name} (${user.email}) avisou que pagou o Pix de ${formatBrl(SUBSCRIPTION_PRICE)}. Confira o extrato e libere o acesso no painel admin.`
  );

  return { user: serializeUser(user) };
};

module.exports = { getPixCharge, notifyPayment };
