import { describe, it, expect, vi, afterEach } from 'vitest';

const personalExpensesRepository = require('../repositories/personalExpensesRepository');
const personalExpensesService = require('../services/personalExpensesService');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('personalExpensesService.normalizeItem', () => {
  it('fills a default date and derives due_day from it when missing', () => {
    const result = personalExpensesService.normalizeItem({ description: 'Luz', amount: 200 });
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.due_day).toBe(Number(result.date.slice(8, 10)));
  });

  it('generates an entry_key when none is provided', () => {
    const result = personalExpensesService.normalizeItem({ description: 'Agua', amount: 90 });
    expect(result.entry_key).toBeTruthy();
  });

  it('marks status as pago when the base month is already flagged in status_months', () => {
    const result = personalExpensesService.normalizeItem({
      description: 'Cartao',
      amount: 500,
      date: '2026-08-10',
      status: 'pago'
    });
    expect(result.status).toBe('pago');
    expect(JSON.parse(result.status_months)).toEqual({ '2026-08': 'pago' });
  });

  it('defaults type to saida unless explicitly entrada', () => {
    expect(personalExpensesService.normalizeItem({ amount: 1 }).type).toBe('saida');
    expect(personalExpensesService.normalizeItem({ amount: 1, type: 'entrada' }).type).toBe('entrada');
  });
});

describe('personalExpensesService.replaceExpenses', () => {
  it('drops zero/negative-amount items and dedupes by entry_key before persisting', async () => {
    const spy = vi.spyOn(personalExpensesRepository, 'replaceAll').mockResolvedValue([{ id: 1 }]);

    await personalExpensesService.replaceExpenses(1, [
      { entry_key: 'a', description: 'Valido', amount: 100 },
      { entry_key: 'zero', description: 'Zero', amount: 0 },
      { entry_key: 'a', description: 'Duplicado', amount: 50 }
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    const persistedItems = spy.mock.calls[0][1];
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0].description).toBe('Duplicado');
  });

  it('treats a non-array items payload as empty', async () => {
    const spy = vi.spyOn(personalExpensesRepository, 'replaceAll').mockResolvedValue([]);
    const result = await personalExpensesService.replaceExpenses(1, undefined);
    expect(spy).toHaveBeenCalledWith(1, []);
    expect(result).toEqual({ ok: true, items: [] });
  });
});
