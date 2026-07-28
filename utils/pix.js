const QRCode = require('qrcode');

const GUI_PIX = 'BR.GOV.BCB.PIX';

const tlv = (id, value) => {
  const text = String(value);
  const length = String(text.length).padStart(2, '0');
  return `${id}${length}${text}`;
};

const DIACRITICS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

const sanitizeAscii = (value, maxLength) => String(value || '')
  .normalize('NFD')
  .replace(DIACRITICS_REGEX, '')
  .replace(/[^A-Za-z0-9 ]/g, '')
  .trim()
  .toUpperCase()
  .slice(0, maxLength);

// CRC-16/CCITT-FALSE, poly 0x1021, init 0xFFFF — exigido pelo padrao BR Code (Pix).
const crc16 = (payload) => {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

const buildPixPayload = ({ key, amount, merchantName, merchantCity, txid }) => {
  const merchantAccountInfo = tlv('00', GUI_PIX) + tlv('01', String(key || '').trim());
  const amountValue = Number(amount);

  const fields = [
    tlv('00', '01'),
    tlv('01', '11'),
    tlv('26', merchantAccountInfo),
    tlv('52', '0000'),
    tlv('53', '986'),
    Number.isFinite(amountValue) && amountValue > 0 ? tlv('54', amountValue.toFixed(2)) : '',
    tlv('58', 'BR'),
    tlv('59', sanitizeAscii(merchantName, 25) || 'NT DRIVER'),
    tlv('60', sanitizeAscii(merchantCity, 15) || 'BRASIL'),
    tlv('62', tlv('05', sanitizeAscii(txid, 25) || '***'))
  ].join('');

  const payloadWithCrcTag = `${fields}6304`;
  return `${payloadWithCrcTag}${crc16(payloadWithCrcTag)}`;
};

const buildPixQrDataUrl = async (payload) => QRCode.toDataURL(payload, {
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 320
});

module.exports = { buildPixPayload, buildPixQrDataUrl };
