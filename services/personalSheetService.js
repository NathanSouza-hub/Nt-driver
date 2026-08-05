const { AppError } = require('../errors/AppError');
const personalSheetRepository = require('../repositories/personalSheetRepository');

const normalizeKind = (value) => {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === 'income' || kind === 'expense') return kind;
  return '';
};

const normalizeName = (value) => String(value || '').trim().slice(0, 80);

const parseYear = (value) => {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
};

const parseMonth = (value) => {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
};

const parseDay = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

const getSheet = async (userId, rawYear) => {
  const year = parseYear(rawYear) || new Date().getFullYear();

  const rows = await personalSheetRepository.listRows(userId);
  const values = await personalSheetRepository.listValues(userId, year);

  const rowKindById = new Map((rows || []).map((row) => [Number(row.id), row.kind]));
  const incomeByMonth = {};
  const expenseByMonth = {};
  const balanceByMonth = {};

  for (let month = 1; month <= 12; month += 1) {
    incomeByMonth[String(month)] = 0;
    expenseByMonth[String(month)] = 0;
    balanceByMonth[String(month)] = 0;
  }

  (values || []).forEach((value) => {
    const rowId = Number(value.row_id);
    const month = String(Number(value.month));
    const amount = Number(value.amount) || 0;
    const kind = rowKindById.get(rowId);

    if (kind === 'income') incomeByMonth[month] += amount;
    if (kind === 'expense') expenseByMonth[month] += amount;
  });

  for (let month = 1; month <= 12; month += 1) {
    const key = String(month);
    balanceByMonth[key] = (incomeByMonth[key] || 0) - (expenseByMonth[key] || 0);
  }

  return {
    year,
    rows: (rows || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      sortOrder: row.sort_order
    })),
    values: (values || []).map((value) => ({
      rowId: value.row_id,
      month: Number(value.month),
      amount: Number(value.amount) || 0,
      day: value.day_of_month === null || value.day_of_month === undefined ? null : Number(value.day_of_month)
    })),
    totals: {
      incomeByMonth,
      expenseByMonth,
      balanceByMonth
    }
  };
};

const createRow = async (userId, rawKind, rawName) => {
  const kind = normalizeKind(rawKind);
  const name = normalizeName(rawName);

  if (!kind || !name) {
    throw new AppError(400, 'Informe tipo válido (income/expense) e nome da linha.');
  }

  const sortOrder = await personalSheetRepository.getNextSortOrder(userId, kind);
  const id = await personalSheetRepository.insertRow(userId, kind, name, sortOrder);

  return { row: { id, kind, name, sortOrder } };
};

const renameRow = async (userId, rawRowId, rawName) => {
  const rowId = Number(rawRowId);
  const name = normalizeName(rawName);

  if (!Number.isInteger(rowId) || rowId <= 0 || !name) {
    throw new AppError(400, 'Dados inválidos para atualizar linha.');
  }

  const row = await personalSheetRepository.updateRowName(rowId, userId, name);
  if (!row) {
    throw new AppError(404, 'Linha não encontrada.');
  }

  return { row: { id: row.id, kind: row.kind, name: row.name, sortOrder: row.sort_order } };
};

const deleteRow = async (userId, rawRowId) => {
  const rowId = Number(rawRowId);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new AppError(400, 'Linha inválida.');
  }

  const deleted = await personalSheetRepository.deleteRow(rowId, userId);
  if (deleted <= 0) {
    throw new AppError(404, 'Linha não encontrada.');
  }

  return { ok: true };
};

const applyValueUpdates = async (userId, rawYear, rawUpdates) => {
  const year = parseYear(rawYear);
  const updates = Array.isArray(rawUpdates) ? rawUpdates : [];

  if (!year) {
    throw new AppError(400, 'Ano inválido.');
  }
  if (!updates.length) {
    throw new AppError(400, 'Nenhuma atualização informada.');
  }
  if (updates.length > 1000) {
    throw new AppError(400, 'Limite de atualizações excedido.');
  }

  const normalizedUpdates = [];
  for (const item of updates) {
    const rowId = Number(item?.rowId);
    const month = parseMonth(item?.month);

    if (!Number.isInteger(rowId) || rowId <= 0 || !month) {
      throw new AppError(400, 'Atualização inválida: rowId ou month.');
    }

    const rawAmount = item?.amount;
    const day = parseDay(item?.day);
    const shouldDelete = rawAmount === null || rawAmount === '' || rawAmount === undefined;
    const amount = shouldDelete ? 0 : Number(rawAmount);

    if (!shouldDelete && !Number.isFinite(amount)) {
      throw new AppError(400, 'Atualização inválida: amount deve ser numérico.');
    }

    if (item?.day !== null && item?.day !== undefined && item?.day !== '' && day === null) {
      throw new AppError(400, 'Atualização inválida: dia deve estar entre 1 e 31.');
    }

    normalizedUpdates.push({ rowId, month, shouldDelete, amount, day });
  }

  const rowIds = [...new Set(normalizedUpdates.map((item) => item.rowId))];
  const ownerRows = await personalSheetRepository.listOwnedRowIds(userId, rowIds);

  if ((ownerRows || []).length !== rowIds.length) {
    throw new AppError(400, 'Uma ou mais linhas não pertencem ao usuário.');
  }

  await personalSheetRepository.applyValueUpdates(userId, year, normalizedUpdates);

  return { ok: true, updated: normalizedUpdates.length };
};

module.exports = {
  normalizeKind,
  normalizeName,
  parseYear,
  parseMonth,
  parseDay,
  getSheet,
  createRow,
  renameRow,
  deleteRow,
  applyValueUpdates
};
