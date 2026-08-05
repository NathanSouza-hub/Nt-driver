import { describe, it, expect } from 'vitest';

const { normalizeEmail, isValidEmail } = require('../utils/email-format');

describe('email-format', () => {
  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('isValidEmail accepts well-formed addresses and rejects malformed ones', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
