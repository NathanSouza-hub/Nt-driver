const normalizeProfileType = (value) => {
  const profile = String(value || '').trim().toLowerCase();
  if (profile === 'driver' || profile === 'motorista') return 'driver';
  if (profile === 'personal' || profile === 'pessoal') return 'personal';
  return '';
};

const serializeProfileType = (value) => (normalizeProfileType(value) === 'personal' ? 'pessoal' : 'driver');

module.exports = { normalizeProfileType, serializeProfileType };
