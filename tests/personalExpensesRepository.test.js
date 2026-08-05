import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `nt-driver-test-personal-expenses-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = dbFile;

const db = require('../models/db');
const personalExpensesRepository = require('../repositories/personalExpensesRepository');

let userId;

const baseItem = (overrides = {}) => ({
  entry_key: 'entry-1',
  description: 'Aluguel',
  amount: 1200,
  type: 'saida',
  category: 'moradia',
  account: 'outros',
  status: 'pendente',
  status_months: null,
  date: '2026-08-01',
  due_day: 5,
  installments: '',
  is_fixed: true,
  installments_start_month: '2026-08',
  ...overrides
});

beforeAll(async () => {
  await db.initDb();
  const result = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    ['Test User', 'personal-expenses-repo-test@example.com', 'hash']
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

describe('personalExpensesRepository.replaceAll', () => {
  it('replaces the full list for a user and returns the new rows', async () => {
    const rows = await personalExpensesRepository.replaceAll(userId, [baseItem()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entry_key: 'entry-1', description: 'Aluguel' });

    const listed = await personalExpensesRepository.listByUser(userId);
    expect(listed).toHaveLength(1);
  });

  it('replacing again fully clears the previous list', async () => {
    const rows = await personalExpensesRepository.replaceAll(userId, [baseItem({ entry_key: 'entry-2', description: 'Internet' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_key).toBe('entry-2');
  });

  it('rolls back the whole batch when one item fails to insert', async () => {
    const beforeRows = await personalExpensesRepository.listByUser(userId);

    await expect(
      personalExpensesRepository.replaceAll(userId, [
        baseItem({ entry_key: 'ok-item' }),
        baseItem({ entry_key: 'bad-item', date: null })
      ])
    ).rejects.toThrow();

    const afterRows = await personalExpensesRepository.listByUser(userId);
    expect(afterRows).toHaveLength(beforeRows.length);
    expect(afterRows.map((row) => row.entry_key)).not.toContain('ok-item');
  });
});
