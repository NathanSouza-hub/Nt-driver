import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `nt-driver-test-personal-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = dbFile;

const db = require('../models/db');
const personalSheetRepository = require('../repositories/personalSheetRepository');

let userId;
let otherUserId;

beforeAll(async () => {
  await db.initDb();
  const user = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    ['Test User', 'personal-sheet-repo-test@example.com', 'hash']
  );
  userId = user.rows[0].id;

  const other = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    ['Other User', 'personal-sheet-repo-test-2@example.com', 'hash']
  );
  otherUserId = other.rows[0].id;
});

afterAll(async () => {
  await db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-journal`, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

describe('personalSheetRepository', () => {
  it('assigns increasing sort orders per kind', async () => {
    const first = await personalSheetRepository.getNextSortOrder(userId, 'income');
    expect(first).toBe(1);

    await personalSheetRepository.insertRow(userId, 'income', 'Salario', first);

    const second = await personalSheetRepository.getNextSortOrder(userId, 'income');
    expect(second).toBe(2);
  });

  it('listOwnedRowIds only returns rows that belong to the given user', async () => {
    const rowId = await personalSheetRepository.insertRow(userId, 'expense', 'Aluguel', 1);
    const otherRowId = await personalSheetRepository.insertRow(otherUserId, 'expense', 'Aluguel Outro', 1);

    const owned = await personalSheetRepository.listOwnedRowIds(userId, [rowId, otherRowId]);
    expect(owned.map((row) => Number(row.id))).toEqual([Number(rowId)]);
  });

  it('applyValueUpdates upserts then deletes a value', async () => {
    const rowId = await personalSheetRepository.insertRow(userId, 'income', 'Freela', 5);

    await personalSheetRepository.applyValueUpdates(userId, 2026, [
      { rowId, month: 3, shouldDelete: false, amount: 500, day: 10 }
    ]);

    let values = await personalSheetRepository.listValues(userId, 2026);
    expect(values.find((v) => Number(v.row_id) === Number(rowId))).toMatchObject({ amount: 500 });

    await personalSheetRepository.applyValueUpdates(userId, 2026, [
      { rowId, month: 3, shouldDelete: true, amount: 0, day: null }
    ]);

    values = await personalSheetRepository.listValues(userId, 2026);
    expect(values.find((v) => Number(v.row_id) === Number(rowId) && Number(v.month) === 3)).toBeUndefined();
  });

  it('updateRowName returns null when the row does not belong to the user', async () => {
    const rowId = await personalSheetRepository.insertRow(userId, 'income', 'Original', 9);
    const result = await personalSheetRepository.updateRowName(rowId, otherUserId, 'Hacked');
    expect(result).toBeFalsy();
  });

  it('deleteRow only removes rows owned by the requesting user', async () => {
    const rowId = await personalSheetRepository.insertRow(userId, 'income', 'ParaDeletar', 10);

    const deletedByStranger = await personalSheetRepository.deleteRow(rowId, otherUserId);
    expect(deletedByStranger).toBe(0);

    const deletedByOwner = await personalSheetRepository.deleteRow(rowId, userId);
    expect(deletedByOwner).toBe(1);
  });
});
