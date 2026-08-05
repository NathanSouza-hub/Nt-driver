import { describe, it, expect, vi, afterEach } from 'vitest';

const summaryGoalsRepository = require('../repositories/summaryGoalsRepository');
const summaryGoalsService = require('../services/summaryGoalsService');
const { AppError } = require('../errors/AppError');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('summaryGoalsService.getMonthGoals', () => {
  it('throws a 400 AppError for an invalid month key', async () => {
    try {
      await summaryGoalsService.getMonthGoals(1, '2026-8');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.message).toBe('Mês inválido.');
    }
  });

  it('reshapes rows into a day-keyed map', async () => {
    vi.spyOn(summaryGoalsRepository, 'listByMonth').mockResolvedValue([
      { day_of_month: 1, goal: 100, day_off: 0 },
      { day_of_month: 2, goal: null, day_off: 1 }
    ]);

    const result = await summaryGoalsService.getMonthGoals(1, '2026-08');

    expect(result).toEqual({
      month: '2026-08',
      days: {
        1: { goal: 100, dayOff: false },
        2: { goal: undefined, dayOff: true }
      }
    });
  });
});

describe('summaryGoalsService.setDayGoal', () => {
  it('throws a 400 AppError for an invalid day', async () => {
    try {
      await summaryGoalsService.setDayGoal(1, '2026-08', '40', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.status).toBe(400);
      expect(error.message).toBe('Data inválida.');
    }
  });

  it('deletes the goal when no goal is provided and the day is not off', async () => {
    const spy = vi.spyOn(summaryGoalsRepository, 'deleteGoal').mockResolvedValue();

    const result = await summaryGoalsService.setDayGoal(1, '2026-08', '5', {});

    expect(spy).toHaveBeenCalledWith(1, '2026-08', 5);
    expect(result).toEqual({ ok: true, deleted: true });
  });

  it('upserts when a goal value is provided', async () => {
    const spy = vi.spyOn(summaryGoalsRepository, 'upsertGoal').mockResolvedValue();

    const result = await summaryGoalsService.setDayGoal(1, '2026-08', '5', { goal: 250 });

    expect(spy).toHaveBeenCalledWith(1, '2026-08', 5, 250, false);
    expect(result).toEqual({ ok: true });
  });

  it('upserts a day-off with a null goal even without a goal value', async () => {
    const spy = vi.spyOn(summaryGoalsRepository, 'upsertGoal').mockResolvedValue();

    const result = await summaryGoalsService.setDayGoal(1, '2026-08', '5', { dayOff: true });

    expect(spy).toHaveBeenCalledWith(1, '2026-08', 5, null, true);
    expect(result).toEqual({ ok: true });
  });
});

describe('summaryGoalsService parsers', () => {
  it('parseMonthKey rejects malformed keys', () => {
    expect(summaryGoalsService.parseMonthKey('2026-08')).toBe('2026-08');
    expect(summaryGoalsService.parseMonthKey('2026-8')).toBe('');
    expect(summaryGoalsService.parseMonthKey('')).toBe('');
  });

  it('parseDay rejects out-of-range values', () => {
    expect(summaryGoalsService.parseDay('15')).toBe(15);
    expect(summaryGoalsService.parseDay('0')).toBeNull();
    expect(summaryGoalsService.parseDay('32')).toBeNull();
    expect(summaryGoalsService.parseDay('abc')).toBeNull();
  });

  it('parseGoal rejects negative or non-numeric values', () => {
    expect(summaryGoalsService.parseGoal('100')).toBe(100);
    expect(summaryGoalsService.parseGoal('-5')).toBeNull();
    expect(summaryGoalsService.parseGoal('')).toBeNull();
    expect(summaryGoalsService.parseGoal(undefined)).toBeNull();
  });
});
