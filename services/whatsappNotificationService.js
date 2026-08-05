const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE || '';
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY || '';

const hasCallMeBotConfig = Boolean(CALLMEBOT_PHONE && CALLMEBOT_APIKEY);

const sendWhatsAppAlert = async (text) => {
  if (!hasCallMeBotConfig) return;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(CALLMEBOT_PHONE)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(CALLMEBOT_APIKEY)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[callmebot] resposta ${response.status}: ${body}`);
    }
  } catch (error) {
    console.error('[callmebot] falha ao enviar alerta de WhatsApp:', error.message);
  }
};

module.exports = { hasCallMeBotConfig, sendWhatsAppAlert };
