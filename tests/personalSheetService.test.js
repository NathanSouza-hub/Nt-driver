import { describe, it, expect, vi, afterEach } from 'vitest';

const personalSheetRepository = require('../repositories/personalSheetRepository');
const personalSheetService = require('../services/personalSheetService');
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
    expect(error.message).toBe(message);
  }
};

describe('personalSheetService.getSheet', () => {
  it('aggregates income/expense/balance totals per month', async () => {
    vi.spyOn(personalSheetRepository, 'listRows').mockResolvedValue([
      { id: 1, kind: 'income', name: 'Salario', sort_order: 1 },
      { id: 2, kind: 'expense', name: 'Aluguel', sort_order: 1 }
    ]);
    vi.spyOn(personalSheetRepository, 'listValues').mockResolvedValue([
      { row_id: 1, month: 1, amount: 5000, day_of_month: null },
      { row_id: 2, month: 1, amount: 1200, day_of_month: 5 }
    ]);

    const result = await personalSheetService.getSheet(1, '2026');

    expect(result.totals.incomeByMonth['1']).toBe(5000);
    expect(result.totals.expenseByMonth['1']).toBe(1200);
    expect(result.totals.balanceByMonth['1']).toBe(3800);
    expect(result.totals.balanceByMonth['2']).toBe(0);
  });

  it('falls back to the current year when the year param is invalid', async () => {
    vi.spyOn(personalSheetRepository, 'listRows').mockResolvedValue([]);
    const listValuesSpy = vi.spyOn(personalSheetRepository, 'listValues').mockResolvedValue([]);

    const result = await personalSheetService.getSheet(1, 'not-a-year');

    expect(result.year).toBe(new Date().getFullYear());
    expect(listValuesSpy).toHaveBeenCalledWith(1, new Date().getFullYear());
  });
});

describe('personalSheetService.createRow', () => {
  it('rejects an invalid kind or empty name', async () => {
    await expectAppError(
      personalSheetService.createRow(1, 'invalid-kind', 'Nome'),
      400,
      'Informe tipo válido (income/expense) e nome da linha.'
    );
    await expectAppError(
      personalSheetService.createRow(1, 'income', ''),
      400,
      'Informe tipo válido (income/expense) e nome da linha.'
    );
  });
});

describe('personalSheetService.deleteRow', () => {
  it('rejects a non-positive row id before touching the repository', async () => {
    const spy = vi.spyOn(personalSheetRepository, 'deleteRow');
    await expectAppError(personalSheetService.deleteRow(1, '0'), 400, 'Linha inválida.');
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws 404 when the repository reports nothing was deleted', async () => {
    vi.spyOn(personalSheetRepository, 'deleteRow').mockResolvedValue(0);
    await expectAppError(personalSheetService.deleteRow(1, '5'), 404, 'Linha não encontrada.');
  });
});

describe('personalSheetService.applyValueUpdates', () => {
  it('rejects an invalid year', async () => {
    await expectAppError(personalSheetService.applyValueUpdates(1, 1999, [{ rowId: 1, month: 1 }]), 400, 'Ano inválido.');
  });

  it('rejects an empty updates list', async () => {
    await expectAppError(personalSheetService.applyValueUpdates(1, 2026, []), 400, 'Nenhuma atualização informada.');
  });

  it('rejects more than 1000 updates', async () => {
    const updates = Array.from({ length: 1001 }, (_, i) => ({ rowId: 1, month: 1, amount: i }));
    await expectAppError(personalSheetService.applyValueUpdates(1, 2026, updates), 400, 'Limite de atualizações excedido.');
  });

  it('rejects when a row does not belong to the user', async () => {
    vi.spyOn(personalSheetRepository, 'listOwnedRowIds').mockResolvedValue([]);
    await expectAppError(
      personalSheetService.applyValueUpdates(1, 2026, [{ rowId: 99, month: 1, amount: 10 }]),
      400,
      'Uma ou mais linhas não pertencem ao usuário.'
    );
  });

  it('applies updates and reports how many were processed when ownership checks out', async () => {
    vi.spyOn(personalSheetRepository, 'listOwnedRowIds').mockResolvedValue([{ id: 1 }]);
    const applySpy = vi.spyOn(personalSheetRepository, 'applyValueUpdates').mockResolvedValue();

    const result = await personalSheetService.applyValueUpdates(1, 2026, [{ rowId: 1, month: 1, amount: 250 }]);

    expect(applySpy).toHaveBeenCalledWith(1, 2026, [{ rowId: 1, month: 1, shouldDelete: false, amount: 250, day: null }]);
    expect(result).toEqual({ ok: true, updated: 1 });
  });
});
