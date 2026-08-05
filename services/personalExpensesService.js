const crypto = require('crypto');
const personalExpensesRepository = require('../repositories/personalExpensesRepository');

const normalizeStatusMonths = (value, date, status) => {
  let parsed = value;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      parsed = {};
    }
  }

  const normalized = Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).reduce((accumulator, [monthKey, monthStatus]) => {
    const normalizedMonth = String(monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) return accumulator;
    if (monthStatus === 'pago') accumulator[normalizedMonth] = 'pago';
    return accumulator;
  }, {});

  const baseMonth = String(date || '').slice(0, 7);
  if (status === 'pago' && /^\d{4}-\d{2}$/.test(baseMonth) && !normalized[baseMonth]) {
    normalized[baseMonth] = 'pago';
  }

  return normalized;
};

const normalizeItem = (item = {}) => {
  const date = String(item.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dueRaw = Number(item.due_day);
  const fallbackDay = Number(date.slice(8, 10)) || 1;
  const dueDay = Number.isFinite(dueRaw) && dueRaw >= 1 && dueRaw <= 31 ? dueRaw : fallbackDay;
  const entryKey = String(item.entry_key || item.entryKey || item.id || '').trim() || crypto.randomUUID();
  const statusMonths = normalizeStatusMonths(item.status_months ?? item.statusMonths, date, item.status);
  const baseMonth = date.slice(0, 7);

  let isFixed = item.is_fixed;
  if (isFixed === null || isFixed === undefined || isFixed === '') isFixed = null;
  else isFixed = Boolean(isFixed);

  return {
    entry_key: entryKey,
    description: String(item.description || '').trim(),
    amount: Number(item.amount) || 0,
    type: item.type === 'entrada' ? 'entrada' : 'saida',
    category: String(item.category || 'outros'),
    account: String(item.account || 'outros'),
    status: statusMonths[baseMonth] === 'pago' ? 'pago' : 'pendente',
    status_months: Object.keys(statusMonths).length ? JSON.stringify(statusMonths) : null,
    date,
    due_day: dueDay,
    installments: String(item.installments || '').trim(),
    is_fixed: isFixed,
    installments_start_month: String(item.installments_start_month || date.slice(0, 7))
  };
};

const listExpenses = (userId) => personalExpensesRepository.listByUser(userId);

const replaceExpenses = async (userId, rawItems) => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const itemsMap = new Map();

  items
    .map(normalizeItem)
    .filter((item) => item.amount > 0)
    .forEach((item) => {
      itemsMap.set(item.entry_key, item);
    });

  const normalizedItems = Array.from(itemsMap.values());
  const rows = await personalExpensesRepository.replaceAll(userId, normalizedItems);
  return { ok: true, items: rows };
};

module.exports = { listExpenses, replaceExpenses, normalizeItem, normalizeStatusMonths };
