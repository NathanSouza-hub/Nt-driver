const { AppError } = require('../errors/AppError');
const summaryGoalsRepository = require('../repositories/summaryGoalsRepository');

const parseMonthKey = (value) => {
  const monthKey = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : '';
};

const parseDay = (value) => {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

const parseGoal = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const goal = Number(value);
  return Number.isFinite(goal) && goal >= 0 ? goal : null;
};

const getMonthGoals = async (userId, rawMonth) => {
  const month = parseMonthKey(rawMonth);
  if (!month) {
    throw new AppError(400, 'Mês inválido.');
  }

  const rows = await summaryGoalsRepository.listByMonth(userId, month);

  const days = {};
  (rows || []).forEach((row) => {
    days[String(row.day_of_month)] = {
      goal: row.goal === null || row.goal === undefined ? undefined : Number(row.goal),
      dayOff: Boolean(row.day_off)
    };
  });

  return { month, days };
};

const setDayGoal = async (userId, rawMonth, rawDay, body) => {
  const month = parseMonthKey(rawMonth);
  const day = parseDay(rawDay);
  if (!month || !day) {
    throw new AppError(400, 'Data inválida.');
  }

  const goal = parseGoal(body?.goal);
  const hasGoal = Boolean(body) && Object.prototype.hasOwnProperty.call(body, 'goal');
  const dayOff = Boolean(body?.dayOff);

  if (!dayOff && (!hasGoal || goal === null)) {
    await summaryGoalsRepository.deleteGoal(userId, month, day);
    return { ok: true, deleted: true };
  }

  await summaryGoalsRepository.upsertGoal(userId, month, day, hasGoal ? goal : null, dayOff);
  return { ok: true };
};

module.exports = { getMonthGoals, setDayGoal, parseMonthKey, parseDay, parseGoal };
