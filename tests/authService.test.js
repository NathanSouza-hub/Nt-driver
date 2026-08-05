import { describe, it, expect, vi, afterEach } from 'vitest';

const userRepository = require('../repositories/userRepository');
const emailVerificationRepository = require('../repositories/emailVerificationRepository');
const passwordResetRepository = require('../repositories/passwordResetRepository');
const emailNotificationService = require('../services/emailNotificationService');
const authService = require('../services/authService');
const { AppError } = require('../errors/AppError');

afterEach(() => {
  vi.restoreAllMocks();
});

const expectAppError = async (promise, status, message) => {
  try {
    await promise;
    expect.unreachable('should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    if (message !== undefined) expect(error.message).toBe(message);
  }
};

describe('authService.register', () => {
  it('makes the very first registered user an admin with an active subscription', async () => {
    vi.spyOn(userRepository, 'getUsersCount').mockResolvedValue(0);
    const insertSpy = vi.spyOn(userRepository, 'insertUserOnRegister').mockResolvedValue({ email: 'a@b.com' });

    await authService.register({ name: 'Ana', email: 'a@b.com', password: 'Abcdef1!', profileType: 'driver' });

    const fields = insertSpy.mock.calls[0][0];
    expect(fields.isAdmin).toBe(true);
    expect(fields.subscriptionStatus).toBe('active');
    expect(fields.trialEndsAt).toBeNull();
  });

  it('does not make the second user an admin, and starts them on trial', async () => {
    vi.spyOn(userRepository, 'getUsersCount').mockResolvedValue(1);
    const insertSpy = vi.spyOn(userRepository, 'insertUserOnRegister').mockResolvedValue({ email: 'b@b.com' });

    await authService.register({ name: 'Bruno', email: 'b@b.com', password: 'Abcdef1!', profileType: 'driver' });

    const fields = insertSpy.mock.calls[0][0];
    expect(fields.isAdmin).toBe(false);
    expect(fields.subscriptionStatus).toBe('trial');
    expect(fields.trialEndsAt).toBeInstanceOf(Date);
  });

  it('rejects invalid name/email/profileType before touching the repository', async () => {
    const spy = vi.spyOn(userRepository, 'getUsersCount');
    await expectAppError(
      authService.register({ name: '', email: 'a@b.com', password: 'Abcdef1!', profileType: 'driver' }),
      400,
      'Informe nome, email e perfil válidos.'
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a weak password', async () => {
    await expectAppError(
      authService.register({ name: 'Ana', email: 'a@b.com', password: '123', profileType: 'driver' }),
      400
    );
  });

  it('translates a unique-constraint violation into a 409', async () => {
    vi.spyOn(userRepository, 'getUsersCount').mockResolvedValue(1);
    vi.spyOn(userRepository, 'insertUserOnRegister').mockRejectedValue({ code: '23505' });

    await expectAppError(
      authService.register({ name: 'Ana', email: 'a@b.com', password: 'Abcdef1!', profileType: 'driver' }),
      409,
      'Este email já está cadastrado.'
    );
  });
});

describe('authService.login', () => {
  it('uses the same generic message whether the email is unknown or the password is wrong', async () => {
    vi.spyOn(userRepository, 'findByEmailForLogin').mockResolvedValue(null);
    await expectAppError(
      authService.login({ email: 'nobody@example.com', password: 'x' }),
      401,
      'Email ou senha inválidos.'
    );

    vi.spyOn(userRepository, 'findByEmailForLogin').mockResolvedValue({ password_hash: '$2a$10$invalidhash..............................' });
    await expectAppError(
      authService.login({ email: 'a@b.com', password: 'wrong-password' }),
      401,
      'Email ou senha inválidos.'
    );
  });
});

describe('authService.resendVerification / forgotPassword (anti-enumeration)', () => {
  it('resendVerification always returns the same generic message for an unknown email', async () => {
    const result = await authService.resendVerification('unknown@example.com');
    expect(result).toEqual({ ok: true, message: 'Se o email existir, enviaremos um novo link de verificação.' });
  });

  it('resendVerification returns the same message even when the email exists but verification was already done', async () => {
    vi.spyOn(userRepository, 'findByEmailForVerification').mockResolvedValue({
      id: 1,
      email: 'a@b.com',
      email_verification_required: false,
      email_verified_at: new Date()
    });
    const result = await authService.resendVerification('a@b.com');
    expect(result).toEqual({ ok: true, message: 'Se o email existir, enviaremos um novo link de verificação.' });
  });

  it('forgotPassword always returns the same generic message for an unknown email', async () => {
    vi.spyOn(userRepository, 'findByEmailBasic').mockResolvedValue(null);
    const result = await authService.forgotPassword('unknown@example.com');
    expect(result).toEqual({ ok: true, message: 'Se o email existir, enviaremos instruções de recuperação.' });
  });

  it('forgotPassword still sends the email when the user exists, but the response is identical', async () => {
    vi.spyOn(userRepository, 'findByEmailBasic').mockResolvedValue({ id: 1, email: 'a@b.com' });
    vi.spyOn(passwordResetRepository, 'createForUser').mockResolvedValue('raw-token');
    const sendSpy = vi.spyOn(emailNotificationService, 'sendResetEmail').mockResolvedValue();

    const result = await authService.forgotPassword('a@b.com');

    expect(sendSpy).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, message: 'Se o email existir, enviaremos instruções de recuperação.' });
  });
});

describe('authService.resetPassword (token expiry)', () => {
  it('rejects a missing token', async () => {
    vi.spyOn(passwordResetRepository, 'findValidByEmailAndToken').mockResolvedValue(null);
    await expectAppError(
      authService.resetPassword('a@b.com', 'sometoken', 'Abcdef1!'),
      400,
      'Token inválido ou expirado.'
    );
  });

  it('rejects an expired token', async () => {
    vi.spyOn(passwordResetRepository, 'findValidByEmailAndToken').mockResolvedValue({
      id: 1,
      user_id: 1,
      expires_at: new Date(Date.now() - 1000)
    });
    await expectAppError(
      authService.resetPassword('a@b.com', 'sometoken', 'Abcdef1!'),
      400,
      'Token inválido ou expirado.'
    );
  });

  it('accepts a valid, unexpired token', async () => {
    vi.spyOn(passwordResetRepository, 'findValidByEmailAndToken').mockResolvedValue({
      id: 1,
      user_id: 1,
      expires_at: new Date(Date.now() + 1000 * 60)
    });
    const consumeSpy = vi.spyOn(passwordResetRepository, 'consume').mockResolvedValue();

    await authService.resetPassword('a@b.com', 'sometoken', 'Abcdef1!');

    expect(consumeSpy).toHaveBeenCalled();
  });
});

describe('authService.verifyEmail (token expiry)', () => {
  it('redirects with verification_expired when the token has expired', async () => {
    vi.spyOn(emailVerificationRepository, 'findValidByEmailAndToken').mockResolvedValue({
      id: 1,
      user_id: 1,
      expires_at: new Date(Date.now() - 1000),
      email: 'a@b.com'
    });

    const redirectUrl = await authService.verifyEmail('a@b.com', 'sometoken');
    expect(redirectUrl).toContain('authMessage=verification_expired');
  });

  it('redirects with verification_invalid when no token is found', async () => {
    vi.spyOn(emailVerificationRepository, 'findValidByEmailAndToken').mockResolvedValue(null);
    const redirectUrl = await authService.verifyEmail('a@b.com', 'sometoken');
    expect(redirectUrl).toContain('authMessage=verification_invalid');
  });
});
