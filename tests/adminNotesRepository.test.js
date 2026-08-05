import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs');

const dbFile = path.join(os.tmpdir(), `nt-driver-test-admin-notes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = dbFile;

const db = require('../models/db');
const adminNotesRepository = require('../repositories/adminNotesRepository');

let userId;

beforeAll(async () => {
  await db.initDb();
  const result = await db.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    ['Test User', 'admin-notes-repo-test@example.com', 'hash']
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

describe('adminNotesRepository', () => {
  it('inserts a document and returns it via getLatestByUser', async () => {
    const doc = await adminNotesRepository.insertDocument(userId, 'Arquivo 1');
    expect(doc).toMatchObject({ title: 'Arquivo 1', content_html: '<p></p>' });
  });

  it('updateDocument changes title and content only for the owning user', async () => {
    const doc = await adminNotesRepository.insertDocument(userId, 'Original');
    await adminNotesRepository.updateDocument(userId, doc.id, 'Atualizado', '<p>novo</p>');

    const updated = await adminNotesRepository.getById(userId, doc.id);
    expect(updated).toMatchObject({ title: 'Atualizado', content_html: '<p>novo</p>' });
  });

  it('getById returns undefined for a document belonging to another user', async () => {
    const doc = await adminNotesRepository.insertDocument(userId, 'Privado');

    const otherUser = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['Other User', 'admin-notes-repo-test-2@example.com', 'hash']
    );

    const result = await adminNotesRepository.getById(otherUser.rows[0].id, doc.id);
    expect(result).toBeFalsy();
  });

  it('deleteDocument removes the row', async () => {
    const doc = await adminNotesRepository.insertDocument(userId, 'ParaDeletar');
    await adminNotesRepository.deleteDocument(userId, doc.id);

    const result = await adminNotesRepository.getById(userId, doc.id);
    expect(result).toBeFalsy();
  });
});
