import { describe, it, expect } from 'vitest';

const { formatBrl } = require('../utils/money');
const { hashToken, generateRawToken } = require('../utils/tokens');

describe('utils/money.formatBrl', () => {
  it('formats a number as BRL currency', () => {
    expect(formatBrl(14.99)).toBe(Number(14.99).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  });

  it('treats null/undefined as zero', () => {
    expect(formatBrl(undefined)).toBe(Number(0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  });
});

describe('utils/tokens', () => {
  it('hashToken is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('generateRawToken produces a 64-char hex string that differs each call', () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
