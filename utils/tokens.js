const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const generateRawToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { hashToken, generateRawToken };
