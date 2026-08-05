import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const recordsRepository = require('../repositories/recordsRepository');
const recordsService = require('../services/recordsService');
const { AppError } = require('../errors/AppError');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordsService.deleteRecordsByDate', () => {
  it('throws a 400 AppError when the date is empty', async () => {
    const spy = vi.spyOn(recordsRepository, 'deleteByDate');

    try {
      await recordsService.deleteRecordsByDate(1, '');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.message).toBe('Data inválida.');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws a 400 AppError when the date is only whitespace', async () => {
    try {
      await recordsService.deleteRecordsByDate(1, '   ');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.message).toBe('Data inválida.');
    }
  });

  it('decodes the date and delegates to the repository when valid', async () => {
    const spy = vi.spyOn(recordsRepository, 'deleteByDate').mockResolvedValue(3);

    const deleted = await recordsService.deleteRecordsByDate(1, '2026-08-01');

    expect(spy).toHaveBeenCalledWith(1, '2026-08-01');
    expect(deleted).toBe(3);
  });
});

describe('recordsService passthrough methods', () => {
  it('listRecords delegates to the repository', async () => {
    const spy = vi.spyOn(recordsRepository, 'listByUser').mockResolvedValue([{ id: 1 }]);
    const rows = await recordsService.listRecords(7);
    expect(spy).toHaveBeenCalledWith(7);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('createRecord delegates to the repository', async () => {
    const spy = vi.spyOn(recordsRepository, 'create').mockResolvedValue(42);
    const id = await recordsService.createRecord(7, { date: '2026-08-01' });
    expect(spy).toHaveBeenCalledWith(7, { date: '2026-08-01' });
    expect(id).toBe(42);
  });
});
