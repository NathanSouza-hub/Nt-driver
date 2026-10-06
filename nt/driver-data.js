export const currency = (value) =>
  `R$ ${Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const formatDate = (value) => {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

export const normalizeMonthlyStatusMap = (statusMonths, fallbackStatus = "", fallbackMonth = "") => {
  let parsed = statusMonths;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      parsed = {};
    }
  }

  const normalized = Object.entries(parsed && typeof parsed === "object" ? parsed : {}).reduce((accumulator, [monthKey, status]) => {
    const normalizedMonth = String(monthKey || "").trim();
    if (!/^\d{4}-\d{2}$/.test(normalizedMonth)) return accumulator;
    if (status === "pago") accumulator[normalizedMonth] = "pago";
    return accumulator;
  }, {});

  if (fallbackStatus === "pago" && /^\d{4}-\d{2}$/.test(String(fallbackMonth || "")) && !normalized[fallbackMonth]) {
    normalized[fallbackMonth] = "pago";
  }

  return normalized;
};

export const getMonthlyStatus = (statusMonths, monthKey, fallbackStatus = "", fallbackMonth = "") => {
  const normalizedStatuses = normalizeMonthlyStatusMap(statusMonths, fallbackStatus, fallbackMonth);
  return normalizedStatuses[String(monthKey || "").trim()] === "pago" ? "pago" : "pendente";
};

const normalizeTextToken = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const normalizeExpenseTypeKey = (value) => {
  const normalized = normalizeTextToken(value);
  if (!normalized) return "";
  if (normalized === "combustivel") return "combustivel";
  if (normalized === "alimentacao na rua") return "alimentacao na rua";
  if (normalized === "troca de oleo") return "troca de oleo";
  if (normalized === "lavagem") return "lavagem";
  if (normalized === "outros") return "outros";
  return normalized;
};

const getCanonicalExpenseTypeLabel = (value) => {
  const normalized = normalizeExpenseTypeKey(value);
  if (normalized === "combustivel") return "Combustível";
  if (normalized === "alimentacao na rua") return "Alimentação na rua";
  if (normalized === "troca de oleo") return "Troca de óleo";
  if (normalized === "lavagem") return "Lavagem";
  if (normalized === "outros") return "Outros";
  return String(value || "").trim() || "Outros";
};

export const getCurrentMonthKey = () => new Date().toISOString().slice(0, 7);

const MONTHLY_GOAL_KEY = "nt-driver-monthly-goal";
const DEFAULT_MONTHLY_GOAL = 10000;

const parseMonthlyGoalsStore = () => {
  if (typeof localStorage === "undefined") return {};

  const raw = localStorage.getItem(MONTHLY_GOAL_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce((accumulator, [monthKey, value]) => {
      const normalizedMonth = String(monthKey || "").trim();
      const normalizedValue = Number(value);
      if (/^\d{4}-\d{2}$/.test(normalizedMonth) && Number.isFinite(normalizedValue) && normalizedValue > 0) {
        accumulator[normalizedMonth] = normalizedValue;
      }
      return accumulator;
    }, {});
  } catch (error) {
    return {};
  }
};

export const getMonthlyGoalForMonth = (monthKey, fallback = DEFAULT_MONTHLY_GOAL) => {
  const normalizedMonth = String(monthKey || "").trim() || getCurrentMonthKey();
  const store = parseMonthlyGoalsStore();
  if (Number.isFinite(store[normalizedMonth]) && store[normalizedMonth] > 0) return store[normalizedMonth];

  if (typeof localStorage !== "undefined") {
    const legacyValue = Number(localStorage.getItem(MONTHLY_GOAL_KEY));
    if (Number.isFinite(legacyValue) && legacyValue > 0 && normalizedMonth === getCurrentMonthKey()) {
      return legacyValue;
    }
  }

  return fallback;
};

export const setMonthlyGoalForMonth = (monthKey, value) => {
  if (typeof localStorage === "undefined") return;

  const normalizedMonth = String(monthKey || "").trim() || getCurrentMonthKey();
  const normalizedValue = Number(value);
  const nextValue = Number.isFinite(normalizedValue) && normalizedValue > 0 ? normalizedValue : DEFAULT_MONTHLY_GOAL;
  const store = parseMonthlyGoalsStore();

  store[normalizedMonth] = nextValue;
  localStorage.setItem(MONTHLY_GOAL_KEY, JSON.stringify(store));
};

export const normalizeRecord = (record = {}) => ({
  id: Number(record.id),
  date: String(record.date || "").slice(0, 10),
  incomeValue: Number(record.income_value ?? record.incomeValue) || 0,
  incomeSource: String((record.income_source ?? record.incomeSource) || "").trim(),
  expenseValue: Number(record.expense_value ?? record.expenseValue) || 0,
  expenseType: String((record.expense_type ?? record.expenseType) || "").trim(),
  km: Number(record.km) || 0,
  hoursWorked: Number(record.hours_worked ?? record.hoursWorked) || 0,
  operationNotes: String((record.operation_notes ?? record.operationNotes) || "").trim(),
});

export const getMonthLabel = (monthKey) => {
  if (!monthKey) return "Sem período";
  const [year, month] = String(monthKey).split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

const MONTH_OPTIONS_YEARS_AHEAD = 2;

export const getMonthOptions = (records = []) => {
  const currentYear = new Date().getFullYear();
  const recordYears = records
    .map((record) => Number(String(record?.date || "").slice(0, 4)))
    .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100);
  const firstYear = Math.min(currentYear, ...recordYears);
  const lastYear = Math.max(currentYear + MONTH_OPTIONS_YEARS_AHEAD, ...recordYears);
  const options = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      options.push(`${year}-${String(month).padStart(2, "0")}`);
    }
  }
  return options;
};

export const filterRecordsByMonth = (records = [], monthKey) =>
  records
    .map(normalizeRecord)
    .filter((record) => !monthKey || record.date.slice(0, 7) === monthKey)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);

export const summarizeRecords = (records = []) => {
  const normalized = records.map(normalizeRecord);
  const income = normalized.reduce((sum, record) => sum + record.incomeValue, 0);
  const expense = normalized.reduce((sum, record) => sum + record.expenseValue, 0);
  const profit = income - expense;
  const km = normalized.reduce((sum, record) => sum + record.km, 0);
  const hours = normalized.reduce((sum, record) => sum + record.hoursWorked, 0);
  const daysWorked = new Set(normalized.map((record) => record.date).filter(Boolean)).size;
  const weeksWorked = new Set(
    normalized
      .map((record) => {
        const date = new Date(`${record.date}T00:00:00`);
        if (Number.isNaN(date.getTime())) return "";
        const january = new Date(date.getFullYear(), 0, 1);
        const dayDiff = Math.floor((date - january) / 86400000);
        return `${date.getFullYear()}-${Math.ceil((dayDiff + january.getDay() + 1) / 7)}`;
      })
      .filter(Boolean)
  ).size;

  const expenseByType = normalized.reduce((accumulator, record) => {
    const key = getCanonicalExpenseTypeLabel(record.expenseType);
    accumulator[key] = (accumulator[key] || 0) + record.expenseValue;
    return accumulator;
  }, {});

  const incomeBySource = normalized.reduce((accumulator, record) => {
    const key = record.incomeSource || "Outros";
    accumulator[key] = (accumulator[key] || 0) + record.incomeValue;
    return accumulator;
  }, {});

  return {
    income,
    expense,
    profit,
    km,
    hours,
    daysWorked,
    weeksWorked,
    expenseByType,
    incomeBySource,
    incomePerDay: daysWorked ? income / daysWorked : 0,
    expensePerDay: daysWorked ? expense / daysWorked : 0,
    profitPerDay: daysWorked ? profit / daysWorked : 0,
    incomePerWeek: weeksWorked ? income / weeksWorked : 0,
    expensePerWeek: weeksWorked ? expense / weeksWorked : 0,
    profitPerWeek: weeksWorked ? profit / weeksWorked : 0,
    incomePerKm: km ? income / km : 0,
    expensePerKm: km ? expense / km : 0,
    profitPerKm: km ? profit / km : 0,
    incomePerHour: hours ? income / hours : 0,
    expensePerHour: hours ? expense / hours : 0,
    profitPerHour: hours ? profit / hours : 0,
  };
};

export const aggregateRecordsByDate = (records = []) => {
  const grouped = new Map();

  records.map(normalizeRecord).forEach((record) => {
    const current = grouped.get(record.date) || {
      date: record.date,
      uberIncome: 0,
      ninetyNineIncome: 0,
      indriverIncome: 0,
      fuelExpense: 0,
      streetFoodExpense: 0,
      oilExpense: 0,
      washExpense: 0,
      otherExpense: 0,
      income: 0,
      expense: 0,
      profit: 0,
      km: 0,
      hoursWorked: 0,
      operationNotes: "",
      recordIds: [],
    };

    const incomeSource = String(record.incomeSource || "").toLowerCase();
    const expenseType = normalizeExpenseTypeKey(record.expenseType);

    current.income += record.incomeValue;
    current.expense += record.expenseValue;
    current.km += record.km;
    current.hoursWorked += record.hoursWorked;
    current.recordIds.push(record.id);

    if (!current.operationNotes && record.operationNotes) {
      current.operationNotes = record.operationNotes;
    }

    if (incomeSource === "uber") current.uberIncome += record.incomeValue;
    else if (incomeSource === "99") current.ninetyNineIncome += record.incomeValue;
    else if (incomeSource === "indriver") current.indriverIncome += record.incomeValue;

    if (expenseType === "combustivel") current.fuelExpense += record.expenseValue;
    else if (expenseType === "alimentacao na rua") current.streetFoodExpense += record.expenseValue;
    else if (expenseType === "troca de oleo") current.oilExpense += record.expenseValue;
    else if (expenseType === "lavagem") current.washExpense += record.expenseValue;
    else if (record.expenseValue > 0) current.otherExpense += record.expenseValue;

    current.profit = current.income - current.expense;
    grouped.set(record.date, current);
  });

  return Array.from(grouped.values()).sort((left, right) => right.date.localeCompare(left.date));
};

