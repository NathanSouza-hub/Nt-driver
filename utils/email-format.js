const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => EMAIL_REGEX.test(String(email || ''));

module.exports = { EMAIL_REGEX, normalizeEmail, isValidEmail };
