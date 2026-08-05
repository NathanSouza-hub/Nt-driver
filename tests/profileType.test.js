import { describe, it, expect } from 'vitest';

const { normalizeProfileType, serializeProfileType } = require('../utils/profile-type');

describe('profile-type', () => {
  it('normalizeProfileType maps English/Portuguese synonyms to the raw DB convention', () => {
    expect(normalizeProfileType('driver')).toBe('driver');
    expect(normalizeProfileType('motorista')).toBe('driver');
    expect(normalizeProfileType('personal')).toBe('personal');
    expect(normalizeProfileType('pessoal')).toBe('personal');
    expect(normalizeProfileType('invalid')).toBe('');
  });

  it('serializeProfileType maps the raw value to the pt-BR display label', () => {
    expect(serializeProfileType('personal')).toBe('pessoal');
    expect(serializeProfileType('pessoal')).toBe('pessoal');
    expect(serializeProfileType('driver')).toBe('driver');
    expect(serializeProfileType('anything-else')).toBe('driver');
  });
});
