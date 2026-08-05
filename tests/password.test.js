import { describe, it, expect } from 'vitest';

const { getPasswordValidationErrors, getPasswordValidationMessage, PASSWORD_MIN_LENGTH } = require('../utils/password');

describe('password validation', () => {
  it('accepts a password meeting every rule', () => {
    expect(getPasswordValidationErrors('Abcdef1!')).toEqual([]);
  });

  it('flags a password shorter than the minimum length', () => {
    const errors = getPasswordValidationErrors('Ab1!');
    expect(errors[0]).toBe(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  });

  it('flags missing lowercase, uppercase, digit and special character independently', () => {
    expect(getPasswordValidationErrors('ABCDEFG1!')).toContain('A senha deve ter ao menos uma letra minúscula.');
    expect(getPasswordValidationErrors('abcdefg1!')).toContain('A senha deve ter ao menos uma letra maiúscula.');
    expect(getPasswordValidationErrors('Abcdefgh!')).toContain('A senha deve ter ao menos um número.');
    expect(getPasswordValidationErrors('Abcdefg1')).toContain('A senha deve ter ao menos um caractere especial.');
  });

  it('getPasswordValidationMessage returns only the first error', () => {
    expect(getPasswordValidationMessage('')).toBe(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    expect(getPasswordValidationMessage('Abcdef1!')).toBe('');
  });
});
