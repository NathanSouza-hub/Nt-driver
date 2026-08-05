import { describe, it, expect, vi, afterEach } from 'vitest';

const userRepository = require('../repositories/userRepository');
const adminUserService = require('../services/adminUserService');
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

describe('adminUserService.deleteUser', () => {
  it('rejects deleting your own account before touching the repository', async () => {
    const spy = vi.spyOn(userRepository, 'deleteUserChecked');
    await expectAppError(adminUserService.deleteUser(1, '1'), 400, 'Você não pode excluir sua própria conta.');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects deleting the last admin', async () => {
    vi.spyOn(userRepository, 'deleteUserChecked').mockResolvedValue({ deleted: false, reason: 'last_admin' });
    await expectAppError(adminUserService.deleteUser(1, '2'), 400, 'Não é permitido excluir o último administrador.');
  });

  it('returns 404 when the target user does not exist', async () => {
    vi.spyOn(userRepository, 'deleteUserChecked').mockResolvedValue({ deleted: false, reason: 'not_found' });
    await expectAppError(adminUserService.deleteUser(1, '999'), 404, 'Usuário não encontrado.');
  });

  it('succeeds when deleting a non-admin, non-self user', async () => {
    const spy = vi.spyOn(userRepository, 'deleteUserChecked').mockResolvedValue({ deleted: true });
    await adminUserService.deleteUser(1, '2');
    expect(spy).toHaveBeenCalledWith(2);
  });
});

describe('adminUserService.createUser', () => {
  it('translates a unique-constraint violation into a 409', async () => {
    vi.spyOn(userRepository, 'insertUserByAdmin').mockRejectedValue({ code: '23505' });
    await expectAppError(
      adminUserService.createUser({ name: 'Ana', email: 'a@b.com', password: 'Abcdef1!', isAdmin: false, profileType: 'driver' }),
      409,
      'Este email ja esta cadastrado.'
    );
  });

  it('an admin-created user gets an active subscription and no trial end date', async () => {
    const spy = vi.spyOn(userRepository, 'insertUserByAdmin').mockResolvedValue(10);
    await adminUserService.createUser({ name: 'Ana', email: 'a@b.com', password: 'Abcdef1!', isAdmin: true, profileType: 'driver' });
    const fields = spy.mock.calls[0][0];
    expect(fields.subscriptionStatus).toBe('active');
    expect(fields.trialEndsAt).toBeNull();
  });
});

describe('adminUserService.adminResetPassword', () => {
  it('returns 404 when no row was updated', async () => {
    vi.spyOn(userRepository, 'updatePasswordHash').mockResolvedValue(0);
    await expectAppError(adminUserService.adminResetPassword('5', 'Abcdef1!'), 404, 'Usuário não encontrado.');
  });
});
