import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `nt-driver-test-users-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = dbFile;

const db = require('../models/db');
const userRepository = require('../repositories/userRepository');

beforeAll(async () => {
  await db.initDb();
});

afterAll(async () => {
  await db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-journal`, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

describe('userRepository.insertUserOnRegister', () => {
  it('creates a user and returns its id', async () => {
    const user = await userRepository.insertUserOnRegister({
      name: 'Admin User',
      email: 'repo-admin@example.com',
      passwordHash: 'hash',
      isAdmin: true,
      profileType: 'driver',
      now: new Date(),
      subscriptionStatus: 'active',
      trialEndsAt: null
    });

    expect(user.id).toBeTruthy();
    expect(user.email).toBe('repo-admin@example.com');
  });

  it('rejects a duplicate email with a raw DB error carrying a unique-violation code', async () => {
    await expect(userRepository.insertUserOnRegister({
      name: 'Duplicate',
      email: 'repo-admin@example.com',
      passwordHash: 'hash',
      isAdmin: false,
      profileType: 'driver',
      now: new Date(),
      subscriptionStatus: 'trial',
      trialEndsAt: null
    })).rejects.toMatchObject({ code: '23505' });
  });
});

describe('userRepository.deleteUserChecked (last-admin protection)', () => {
  it('refuses to delete the only admin', async () => {
    const admin = await userRepository.getUserById(1);
    expect(admin.is_admin).toBeTruthy();

    const result = await userRepository.deleteUserChecked(1);
    expect(result).toEqual({ deleted: false, reason: 'last_admin' });

    const stillThere = await userRepository.getUserById(1);
    expect(stillThere).toBeTruthy();
  });

  it('allows deleting an admin when another admin still exists', async () => {
    const secondAdmin = await userRepository.insertUserOnRegister({
      name: 'Second Admin',
      email: 'repo-admin-2@example.com',
      passwordHash: 'hash',
      isAdmin: true,
      profileType: 'driver',
      now: new Date(),
      subscriptionStatus: 'active',
      trialEndsAt: null
    });

    const result = await userRepository.deleteUserChecked(secondAdmin.id);
    expect(result).toEqual({ deleted: true });

    const gone = await userRepository.getUserById(secondAdmin.id);
    expect(gone).toBeFalsy();
  });

  it('reports not_found for a non-existent user', async () => {
    const result = await userRepository.deleteUserChecked(999999);
    expect(result).toEqual({ deleted: false, reason: 'not_found' });
  });
});

describe('userRepository.findByEmailForLogin', () => {
  it('returns the password hash needed for login', async () => {
    const user = await userRepository.findByEmailForLogin('repo-admin@example.com');
    expect(user.password_hash).toBe('hash');
  });

  it('returns undefined for an unknown email', async () => {
    const user = await userRepository.findByEmailForLogin('nobody@example.com');
    expect(user).toBeFalsy();
  });
});
