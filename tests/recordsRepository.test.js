import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `nt-driver-test-records-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = dbFile;

const db = require('../models/db');
const recordsRepository = require('../repositories/recordsRepository');

let userId;

beforeAll(async () => {
  await db.initDb();
  const result = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    ['Test User', 'records-repo-test@example.com', 'hash']
  );
  userId = result.rows[0].id;
});

afterAll(async () => {
  await db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-journal`, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

describe('recordsRepository', () => {
  it('creates a record and lists it back for the owning user', async () => {
    const id = await recordsRepository.create(userId, {
      date: '2026-08-01',
      income_value: 150.5,
      income_source: 'uber',
      expense_value: 20,
      expense_type: 'gas',
      operation_notes: 'turno da manha',
      km: 80,
      hours_worked: 6
    });

    expect(id).toBeTruthy();

    const rows = await recordsRepository.listByUser(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-08-01', income_source: 'uber' });
  });

  it('does not list records belonging to another user', async () => {
    const otherUser = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['Other User', 'records-repo-test-2@example.com', 'hash']
    );
    const otherUserId = otherUser.rows[0].id;

    const rows = await recordsRepository.listByUser(otherUserId);
    expect(rows).toHaveLength(0);
  });

  it('updates a record only when it belongs to the requesting user', async () => {
    const id = await recordsRepository.create(userId, {
      date: '2026-08-02',
      income_value: 100,
      income_source: 'uber',
      expense_value: 10,
      expense_type: 'gas',
      operation_notes: '',
      km: 40,
      hours_worked: 3
    });

    const updatedByOwner = await recordsRepository.updateById(id, userId, {
      date: '2026-08-02',
      income_value: 200,
      income_source: 'uber',
      expense_value: 10,
      expense_type: 'gas',
      km: 40,
      hours_worked: 3
    });
    expect(updatedByOwner).toBe(1);

    const updatedByStranger = await recordsRepository.updateById(id, 999999, {
      date: '2026-08-02',
      income_value: 999,
      income_source: 'uber',
      expense_value: 10,
      expense_type: 'gas',
      km: 40,
      hours_worked: 3
    });
    expect(updatedByStranger).toBe(0);
  });

  it('deletes records matching a date prefix', async () => {
    await recordsRepository.create(userId, {
      date: '2026-08-03T10:00:00.000Z',
      income_value: 50,
      income_source: 'uber',
      expense_value: 0,
      expense_type: '',
      operation_notes: '',
      km: 10,
      hours_worked: 1
    });

    const deleted = await recordsRepository.deleteByDate(userId, '2026-08-03');
    expect(deleted).toBe(1);
  });

  it('deletes a record by id only when it belongs to the requesting user', async () => {
    const id = await recordsRepository.create(userId, {
      date: '2026-08-04',
      income_value: 10,
      income_source: 'uber',
      expense_value: 0,
      expense_type: '',
      operation_notes: '',
      km: 5,
      hours_worked: 1
    });

    const deletedByStranger = await recordsRepository.deleteById(id, 999999);
    expect(deletedByStranger).toBe(0);

    const deletedByOwner = await recordsRepository.deleteById(id, userId);
    expect(deletedByOwner).toBe(1);
  });
});
