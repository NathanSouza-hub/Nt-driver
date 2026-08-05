const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || '';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'NT Driver';

const hasBrevoConfig = Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL);

const sendTransactionalEmail = async ({ to, subject, text, html }) => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Brevo respondeu ${response.status}: ${body}`);
  }
};

const sendResetEmail = async (email, link) => {
  if (!hasBrevoConfig) {
    console.log(`[auth] Link de reset para ${email}: ${link}`);
    return;
  }

  await sendTransactionalEmail({
    to: email,
    subject: 'Recuperação de senha - NT Driver',
    text: `Você solicitou recuperação de senha. Use este link: ${link}`,
    html: `<p>Você solicitou recuperação de senha.</p><p><a href=\"${link}\">Clique para redefinir sua senha</a></p><p>Se não foi você, ignore este email.</p>`
  });
};

const sendVerificationEmail = async (email, link) => {
  if (!hasBrevoConfig) {
    console.log(`[auth] Link de verificação para ${email}: ${link}`);
    return;
  }

  await sendTransactionalEmail({
    to: email,
    subject: 'Confirme seu email - NT Driver',
    text: `Confirme seu email para liberar o acesso ao NT Driver: ${link}`,
    html: `<p>Confirme seu email para liberar o acesso ao NT Driver.</p><p><a href="${link}">Clique para confirmar seu email</a></p><p>Se não foi você, ignore este email.</p>`
  });
};

module.exports = { hasBrevoConfig, sendResetEmail, sendVerificationEmail };
