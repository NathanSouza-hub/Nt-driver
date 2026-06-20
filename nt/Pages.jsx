import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { apiFetch } from "./http";
import { aggregateRecordsByDate, currency, filterRecordsByMonth, formatDate, getCurrentMonthKey, getMonthLabel, getMonthOptions, getMonthlyGoalForMonth, getMonthlyStatus, normalizeMonthlyStatusMap, setMonthlyGoalForMonth, summarizeRecords } from "./driver-data";
import { getProfileTypeLabel, isPessoalProfile } from "./profile-type";

const fieldStyle = {
  width: "100%",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 12,
  padding: "11px 12px",
  background: "#ffffff",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const dashboardSummaryCardStyles = {
  "card-green": {
    background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)",
    color: "#ffffff",
    border: "none",
  },
  "card-red": {
    background: "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
    color: "#ffffff",
    border: "none",
  },
  "card-blue": {
    background: "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
    color: "#ffffff",
    border: "none",
  },
  "card-orange": {
    background: "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)",
    color: "#ffffff",
    border: "none",
  },
};

const registerIncomeSources = [
  { key: "uber_income", label: "Uber" },
  { key: "ninety_nine_income", label: "99" },
  { key: "indriver_income", label: "InDriver" },
];
const registerExpenseTypes = [
  { key: "fuel_expense", label: "Combustível" },
  { key: "street_food_expense", label: "Alimentação na rua" },
  { key: "oil_expense", label: "Troca de óleo" },
  { key: "wash_expense", label: "Lavagem" },
  { key: "other_expense", label: "Outros" },
];
const personalExpenseCategories = [
  { value: "Alimentacao", label: "Alimentação" },
  { value: "Casa", label: "Casa" },
  { value: "Servicos", label: "Serviços" },
  { value: "Carro", label: "Carro" },
  { value: "Emprestimo", label: "Empréstimo" },
  { value: "Dividas", label: "Dívidas" },
  { value: "Renegociacao de dividas", label: "Renegociação de dívidas" },
  { value: "Educacao", label: "Educação" },
  { value: "Corte de cabelo", label: "Corte de cabelo" },
  { value: "Presentes", label: "Presentes" },
  { value: "Lazer", label: "Lazer" },
  { value: "Gastos extras", label: "Gastos extras" },
  { value: "Saude", label: "Saúde" },
  { value: "Internet", label: "Internet" },
  { value: "Outros", label: "Outros" },
];
const personalExpenseStatuses = [
  { value: "pendente", label: "Pendente" },
  { value: "pago", label: "Pago" },
];
const SUMMARY_DAILY_GOALS_KEY = "nt-driver-summary-daily-goals";
const notesMonthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function createPersonalExpenseKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `expense-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePersonalExpenseItem(item = {}) {
  const date = String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return {
    id: item.id || null,
    entry_key: String(item.entry_key || item.entryKey || createPersonalExpenseKey()),
    description: String(item.description || "").trim(),
    amount: Number(item.amount) || 0,
    type: "saida",
    category: String(item.category || "Outros").trim() || "Outros",
    account: String(item.account || "outros"),
    status: item.status === "pago" ? "pago" : "pendente",
    status_months: normalizeMonthlyStatusMap(item.status_months ?? item.statusMonths, item.status, date.slice(0, 7)),
    date,
    due_day: Number(item.due_day) || Number(date.slice(8, 10)) || 1,
    installments: String(item.installments || "").trim(),
    is_fixed: item.is_fixed === null || item.is_fixed === undefined || item.is_fixed === "" ? null : Boolean(item.is_fixed),
    installments_start_month: String(item.installments_start_month || date.slice(0, 7)),
  };
}

function getPersonalExpenseCategoryLabel(category) {
  return personalExpenseCategories.find((item) => item.value === category)?.label || category || "Outros";
}

function formatLastSeenLabel(value) {
  if (!value) return "Nunca entrou";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nunca entrou";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - targetStart.getTime()) / (1000 * 60 * 60 * 24));
  const timeLabel = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (diffDays === 0) return `Hoje às ${timeLabel}`;
  if (diffDays === 1) return `Ontem às ${timeLabel}`;
  return `${date.toLocaleDateString("pt-BR")} às ${timeLabel}`;
}

function getSummaryDailyGoalsStore() {
  try {
    const raw = localStorage.getItem(SUMMARY_DAILY_GOALS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureNotesEditorHasContent(editorEl) {
  if (!editorEl) return;
  const plainText = String(editorEl.textContent || "").trim();
  const hasStructuredBlocks = Boolean(editorEl.querySelector("table, ul, ol, h1, h2, h3, h4, h5, h6, img"));
  if (!plainText && !hasStructuredBlocks) {
    editorEl.innerHTML = "<p></p>";
  }
}

function createNotesTableMarkup(rows, cols) {
  const safeRows = Math.max(1, Math.min(30, Number(rows) || 0));
  const safeCols = Math.max(1, Math.min(12, Number(cols) || 0));
  const headerCells = Array.from({ length: safeCols }, (_, index) => `<th>Coluna ${index + 1}</th>`).join("");
  const bodyRows = Array.from({ length: Math.max(1, safeRows - 1) }, () => {
    const cells = Array.from({ length: safeCols }, () => "<td><br></td>").join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `
    <table class="admin-notes-table">
      <thead>
        <tr>${headerCells}</tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
    <p></p>
  `;
}

function createMonthlyNotesTemplateMarkup({ monthLabel, headers }) {
  const normalizedHeaders = Array.isArray(headers) && headers.length
    ? headers.map((header) => String(header || "").trim()).filter(Boolean)
    : ["Nathan", "Mauricio", "Lene", "Isaque", "Saldo"];
  const finalHeaders = normalizedHeaders.length ? normalizedHeaders : ["Nathan", "Mauricio", "Lene", "Isaque", "Saldo"];
  const safeMonthLabel = escapeHtml(String(monthLabel || "").trim() || "Mês");
  const tableHeaderCells = finalHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const tableRows = Array.from({ length: 12 }, () => {
    const cells = finalHeaders.map(() => "<td><br></td>").join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `
    <div class="admin-notes-month-template">
      <h2>${safeMonthLabel}</h2>
      <table class="admin-notes-table admin-notes-month-grid">
        <thead>
          <tr>${tableHeaderCells}</tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <div class="admin-notes-debts-block">
        <h3>Dívidas</h3>
        <p>Aluguel = </p>
        <p>Cartão = </p>
        <p>Seguro Casa = </p>
        <p>Internet = </p>
        <p class="admin-notes-highlight">Para pagar = </p>
        <p class="admin-notes-highlight">Cartão = </p>
        <p class="admin-notes-highlight">Total de gastos = </p>
      </div>
      <div class="admin-notes-summary-block">
        <p>T = <span class="admin-notes-inline-space"></span> : <span class="admin-notes-inline-space"></span></p>
        <p>( <span class="admin-notes-inline-space"></span> )</p>
        <p class="admin-notes-highlight">Valor por pessoa = </p>
      </div>
    </div>
    <p></p>
  `;
}

function saveSummaryDailyGoalsStore(store) {
  localStorage.setItem(SUMMARY_DAILY_GOALS_KEY, JSON.stringify(store || {}));
}

function getSummaryMonthDailyData(yearMonth) {
  const store = getSummaryDailyGoalsStore();
  return store[yearMonth] || {};
}

async function fetchSummaryMonthDailyData(yearMonth) {
  const payload = await apiFetch(`/api/summary-goals/${encodeURIComponent(yearMonth)}`);
  return payload?.days && typeof payload.days === "object" ? payload.days : {};
}

async function saveSummaryDayValues(yearMonth, day, values = {}) {
  await apiFetch(`/api/summary-goals/${encodeURIComponent(yearMonth)}/${encodeURIComponent(day)}`, {
    method: "PUT",
    body: JSON.stringify(values),
  });
}

function setSummaryDayValues(yearMonth, day, values = {}) {
  const store = getSummaryDailyGoalsStore();
  if (!store[yearMonth]) store[yearMonth] = {};
  const current = store[yearMonth][String(day)] || {};
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(values, "goal")) {
    if (values.goal === null || values.goal === undefined || values.goal === "") delete next.goal;
    else next.goal = Number(values.goal) || 0;
  }

  if (Object.prototype.hasOwnProperty.call(values, "dayOff")) {
    next.dayOff = Boolean(values.dayOff);
  }

  if (!Object.keys(next).length || (next.goal === undefined && !next.dayOff)) {
    delete store[yearMonth][String(day)];
    if (Object.keys(store[yearMonth]).length === 0) delete store[yearMonth];
    saveSummaryDailyGoalsStore(store);
    return store;
  }

  store[yearMonth][String(day)] = next;
  saveSummaryDailyGoalsStore(store);
  return store;
}

function getDaysInMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

function getWeekdayLabel(monthKey, day) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", { weekday: "short" });
}

function getWeekNumberInMonth(dateValue) {
  const day = Number(String(dateValue || "").slice(8, 10));
  if (!day) return 1;
  return Math.max(1, Math.ceil(day / 7));
}

function getMonthWeekRangeLabel(monthKey, weekNumber) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month || !weekNumber) return "";
  const startDay = ((Number(weekNumber) - 1) * 7) + 1;
  const endDay = Math.min(Number(weekNumber) * 7, getDaysInMonth(monthKey));
  const startDate = `${String(startDay).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  const endDate = `${String(endDay).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  return `${startDate} a ${endDate}`;
}

function compareMonthKeys(left, right) {
  const [leftYear, leftMonth] = String(left || "").split("-").map(Number);
  const [rightYear, rightMonth] = String(right || "").split("-").map(Number);
  if (!leftYear || !leftMonth || !rightYear || !rightMonth) return 0;
  return (leftYear - rightYear) * 12 + (leftMonth - rightMonth);
}

function getCompletedDayLimit(monthKey) {
  const currentMonth = getCurrentMonthKey();
  const comparison = compareMonthKeys(monthKey, currentMonth);
  if (comparison < 0) return getDaysInMonth(monthKey);
  if (comparison > 0) return 0;
  return new Date().getDate();
}

function getMonthDiff(fromMonth, toMonth) {
  if (!fromMonth || !toMonth) return 0;
  const [fromYear, fromMon] = String(fromMonth).split("-").map(Number);
  const [toYear, toMon] = String(toMonth).split("-").map(Number);
  if (!fromYear || !fromMon || !toYear || !toMon) return 0;
  return (toYear - fromYear) * 12 + (toMon - fromMon);
}

function parseInstallments(rawInstallments) {
  const raw = String(rawInstallments || "").trim();
  const match = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const paid = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return null;
  return { paid, total };
}

function getInstallmentNumberForMonth(item, targetMonth) {
  const parsed = parseInstallments(item.installments);
  if (!parsed) return null;
  const startMonth = item.installments_start_month || item.date?.slice(0, 7) || targetMonth;
  const monthDiff = getMonthDiff(startMonth, targetMonth);
  if (monthDiff < 0) return null;
  return parsed.paid + monthDiff;
}

function normalizeInstallmentsForMonth(item, targetMonth) {
  const parsed = parseInstallments(item.installments);
  const raw = String(item.installments || "").trim();
  if (!parsed) return raw || "-";

  const installmentNumber = getInstallmentNumberForMonth(item, targetMonth);
  const progressed = Math.max(0, Math.min(parsed.total, installmentNumber ?? parsed.paid));
  return `${progressed}/${parsed.total}`;
}

function isPersonalExpenseVisibleInMonth(item, selectedMonth) {
  const installmentsInfo = parseInstallments(item.installments);
  if (!installmentsInfo) {
    if (!item.is_fixed) {
      return String(item.date || "").startsWith(selectedMonth);
    }
    const startMonth = item.date?.slice(0, 7) || selectedMonth;
    return getMonthDiff(startMonth, selectedMonth) >= 0;
  }

  const installmentNumber = getInstallmentNumberForMonth(item, selectedMonth);
  if (installmentNumber === null) return false;
  return installmentNumber >= 1 && installmentNumber <= installmentsInfo.total;
}

function getPersonalExpenseDateForMonth(item, monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return String(item.date || "").slice(0, 10);

  const day = Number(item.due_day) || Number(String(item.date || "").slice(8, 10)) || 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, daysInMonth)).padStart(2, "0")}`;
}

function filterPersonalExpensesByMonth(items = [], monthKey) {
  return items
    .map(normalizePersonalExpenseItem)
    .filter((item) => !monthKey || isPersonalExpenseVisibleInMonth(item, monthKey))
    .sort((left, right) => {
      const leftDate = getPersonalExpenseDateForMonth(left, monthKey);
      const rightDate = getPersonalExpenseDateForMonth(right, monthKey);
      return leftDate.localeCompare(rightDate) || String(left.entry_key).localeCompare(String(right.entry_key));
    });
}

function getPersonalExpenseStatusForMonth(item, monthKey) {
  const targetMonth = String(monthKey || item.date?.slice(0, 7) || "").trim();
  return getMonthlyStatus(item.status_months, targetMonth, item.status, item.date?.slice(0, 7));
}

function getUpdatedStatusMonths(item, monthKey, nextStatus) {
  const targetMonth = String(monthKey || item.date?.slice(0, 7) || "").trim();
  const nextStatuses = {
    ...normalizeMonthlyStatusMap(item.status_months, item.status, item.date?.slice(0, 7)),
  };

  if (nextStatus === "pago") nextStatuses[targetMonth] = "pago";
  else delete nextStatuses[targetMonth];

  return nextStatuses;
}

function getBaseExpenseStatus(item, statusMonths) {
  const baseMonth = String(item.date || "").slice(0, 7);
  return getMonthlyStatus(statusMonths, baseMonth, item.status, baseMonth);
}

function PageHeader({ title, subtitle, actions, centered = false }) {
  return (
    <div className={`page-header${centered ? " page-header-center" : ""}`} style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

function MonthFilter({ month, onChange, months }) {
  return (
    <div className="filter-group">
      <label htmlFor="page-month-filter">Mês</label>
      <select id="page-month-filter" value={month} onChange={(event) => onChange(event.target.value || getCurrentMonthKey())}>
        {months.map((option) => (
          <option key={option} value={option}>
            {getMonthLabel(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

function PageTabs({ tabs, activeTab, onChange }) {
  return (
    <div className="page-tabs" role="tablist" aria-label="Abas da página">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.key}
          className={`page-tab${activeTab === tab.key ? " active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function PerformanceMetricCards({ metrics }) {
  const tones = ["card-green", "card-red", "card-blue", "card-orange"];

  return (
    <div className="summary-grid expenses-summary-grid">
      {metrics.map((metric, index) => (
        <div key={metric.label} className="card" style={dashboardSummaryCardStyles[tones[index % tones.length]]}>
          <span style={{ color: "rgba(255,255,255,0.82)" }}>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshRecords, user } = useOutletContext();
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const editState = location.state?.editDay || null;
  const isPessoal = isPessoalProfile(user?.profileType);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    uber_income: "",
    ninety_nine_income: "",
    indriver_income: "",
    fuel_expense: "",
    street_food_expense: "",
    oil_expense: "",
    wash_expense: "",
    other_expense: "",
    km: "",
    hours_worked: "",
    operation_notes: "",
  });
  const [personalRegisterForm, setPersonalRegisterForm] = useState({
    description: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    category: "Outros",
  });

  useEffect(() => {
    if (isPessoal) return;
    if (!editState) return;
    setForm({
      date: editState.date || new Date().toISOString().slice(0, 10),
      uber_income: String(editState.uberIncome || ""),
      ninety_nine_income: String(editState.ninetyNineIncome || ""),
      indriver_income: String(editState.indriverIncome || ""),
      fuel_expense: String(editState.fuelExpense || ""),
      street_food_expense: String(editState.streetFoodExpense || ""),
      oil_expense: String(editState.oilExpense || ""),
      wash_expense: String(editState.washExpense || ""),
      other_expense: String(editState.otherExpense || ""),
      km: String(editState.km || ""),
      hours_worked: String(editState.hoursWorked || ""),
      operation_notes: String(editState.operationNotes || ""),
    });
  }, [editState, isPessoal]);

  const updateField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const updatePersonalRegisterField = (name, value) => {
    setPersonalRegisterForm((current) => ({ ...current, [name]: value }));
  };

  const handlePersonalRegisterSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSaving(true);
    try {
      const normalized = normalizePersonalExpenseItem({
        entry_key: createPersonalExpenseKey(),
        description: personalRegisterForm.description,
        amount: Number(personalRegisterForm.amount) || 0,
        category: personalRegisterForm.category,
        status: "pendente",
        date: personalRegisterForm.date,
        due_day: Number(String(personalRegisterForm.date || "").slice(8, 10)) || 1,
        account: user?.profileType || "pessoal",
        is_fixed: null,
      });

      if (!normalized.description) {
        throw new Error("Informe a descrição.");
      }

      if (normalized.amount <= 0) {
        throw new Error("Informe um valor válido.");
      }

      const currentItems = await apiFetch("/api/personal-expenses");
      const nextItems = [
        normalized,
        ...(Array.isArray(currentItems) ? currentItems.map(normalizePersonalExpenseItem) : []),
      ];

      await apiFetch("/api/personal-expenses/replace", {
        method: "POST",
        body: JSON.stringify({ items: nextItems }),
      });

      setPersonalRegisterForm((current) => ({
        description: "",
        amount: "",
        date: current.date,
        category: current.category,
      }));
      setMessage("Despesa pessoal adicionada.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setIsSaving(true);
    try {
      const incomeEntries = registerIncomeSources
        .map((item) => ({
          type: "income",
          label: item.label,
          value: Number(form[item.key]) || 0,
        }))
        .filter((item) => item.value > 0);

      const expenseEntries = registerExpenseTypes
        .map((item) => ({
          type: "expense",
          label: item.label,
          value: Number(form[item.key]) || 0,
        }))
        .filter((item) => item.value > 0);

      const entries = [...incomeEntries, ...expenseEntries];
      if (!entries.length) {
        throw new Error("Informe ao menos um ganho ou uma despesa para salvar.");
      }

      const sharedKm = Number(form.km) || 0;
      const sharedHours = Number(form.hours_worked) || 0;
      const sharedNotes = String(form.operation_notes || "").trim();

      if (editState?.date) {
        await apiFetch(`/api/records/by-date/${encodeURIComponent(editState.date)}`, {
          method: "DELETE",
        });
      }

      await Promise.all(
        entries.map((entry, index) =>
          apiFetch("/api/records", {
            method: "POST",
            body: JSON.stringify({
              date: form.date,
              income_value: entry.type === "income" ? entry.value : 0,
              income_source: entry.type === "income" ? entry.label : "",
              expense_value: entry.type === "expense" ? entry.value : 0,
              expense_type: entry.type === "expense" ? entry.label : "",
              km: index === 0 ? sharedKm : 0,
              hours_worked: index === 0 ? sharedHours : 0,
              operation_notes: index === 0 ? sharedNotes : "",
            }),
          })
        )
      );

      await refreshRecords();
      setForm({
        date: form.date,
        uber_income: "",
        ninety_nine_income: "",
        indriver_income: "",
        fuel_expense: "",
        street_food_expense: "",
        oil_expense: "",
        wash_expense: "",
        other_expense: "",
        km: "",
        hours_worked: "",
        operation_notes: "",
      });
      setMessage(`${entries.length} lançamento(s) salvo(s) com sucesso.`);
      navigate("/driver/history", { replace: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isPessoal) {
    return (
      <>
        <PageHeader title="Registrar" centered />
        <div className="card register-personal-card">
          <div className="register-personal-header">
            <strong>Cadastrar despesa pessoal</strong>
          </div>

          <form className="register-personal-form" onSubmit={handlePersonalRegisterSubmit}>
            <div className="register-personal-grid">
              <div className="register-personal-field register-personal-field-wide">
                <label htmlFor="personal-register-description">Descrição</label>
                <input
                  id="personal-register-description"
                  type="text"
                  style={fieldStyle}
                  value={personalRegisterForm.description}
                  onChange={(event) => updatePersonalRegisterField("description", event.target.value)}
                  required
                />
              </div>

              <div className="register-personal-field">
                <label htmlFor="personal-register-date">Data</label>
                <input
                  id="personal-register-date"
                  type="date"
                  style={fieldStyle}
                  value={personalRegisterForm.date}
                  onChange={(event) => updatePersonalRegisterField("date", event.target.value)}
                  required
                />
              </div>

              <div className="register-personal-field">
                <label htmlFor="personal-register-category">Categoria</label>
                <select
                  id="personal-register-category"
                  style={fieldStyle}
                  value={personalRegisterForm.category}
                  onChange={(event) => updatePersonalRegisterField("category", event.target.value)}
                >
                  {personalExpenseCategories.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="register-personal-field">
                <label htmlFor="personal-register-amount">Valor</label>
                <input
                  id="personal-register-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  style={fieldStyle}
                  value={personalRegisterForm.amount}
                  onChange={(event) => updatePersonalRegisterField("amount", event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="register-personal-actions">
              <span style={{ color: "var(--muted)" }}>{message}</span>
              <button type="submit" className="auth-submit auth-submit-blue" disabled={isSaving}>
                {isSaving ? "Salvando..." : "Salvar registro"}
              </button>
            </div>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Registrar" centered />
      <div
        className="card"
        style={{
          padding: 0,
          overflow: "hidden",
          border: "1px solid rgba(148, 163, 184, 0.16)",
          boxShadow: "0 18px 34px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div
          style={{
            padding: "22px 24px",
            background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 58%, #f0fdf4 100%)",
            borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
          }}
        >
          <strong style={{ display: "block", fontSize: "1.1rem", color: "#0f172a", marginBottom: 6 }}>
            {editState ? `Editar lançamentos de ${formatDate(editState.date)}` : "Novo registro do motorista"}
          </strong>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 24, display: "grid", gap: 24 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <div
              style={{
                padding: 18,
                borderRadius: 18,
                background: "#f8fafc",
                border: "1px solid rgba(148, 163, 184, 0.14)",
              }}
            >
              <label htmlFor="record-date">Data</label>
              <input
                id="record-date"
                type="date"
                style={{ ...fieldStyle, marginTop: 8 }}
                value={form.date}
                onChange={(event) => updateField("date", event.target.value)}
                required
              />
            </div>

            <div
              style={{
                padding: 18,
                borderRadius: 18,
                background: "linear-gradient(135deg, rgba(22,163,74,0.08) 0%, rgba(255,255,255,0.98) 100%)",
                border: "1px solid rgba(34, 197, 94, 0.18)",
              }}
            >
              <strong style={{ display: "block", marginBottom: 10, color: "#166534", fontSize: "0.98rem" }}>Receita</strong>
              <div style={{ display: "grid", gap: 12 }}>
                {registerIncomeSources.map((source) => (
                  <div key={source.key}>
                    <label htmlFor={source.key}>{source.label}</label>
                    <input
                      id={source.key}
                      type="number"
                      step="0.01"
                      placeholder="0,00"
                      style={{ ...fieldStyle, marginTop: 8 }}
                      value={form[source.key]}
                      onChange={(event) => updateField(source.key, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                padding: 18,
                borderRadius: 18,
                background: "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(255,255,255,0.98) 100%)",
                border: "1px solid rgba(248, 113, 113, 0.18)",
              }}
            >
              <strong style={{ display: "block", marginBottom: 10, color: "#991b1b", fontSize: "0.98rem" }}>Despesa</strong>
              <div style={{ display: "grid", gap: 12 }}>
                {registerExpenseTypes.map((expenseType) => (
                  <div key={expenseType.key}>
                    <label htmlFor={expenseType.key}>{expenseType.label}</label>
                    <input
                      id={expenseType.key}
                      type="number"
                      step="0.01"
                      placeholder="0,00"
                      style={{ ...fieldStyle, marginTop: 8 }}
                      value={form[expenseType.key]}
                      onChange={(event) => updateField(expenseType.key, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={gridStyle}>
            <div>
              <label htmlFor="record-km">Km rodados</label>
              <input
                id="record-km"
                type="number"
                step="0.1"
                placeholder="0.0"
                style={{ ...fieldStyle, marginTop: 8 }}
                value={form.km}
                onChange={(event) => updateField("km", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="record-hours">Horas trabalhadas</label>
              <input
                id="record-hours"
                type="number"
                step="0.1"
                placeholder="0.0"
                style={{ ...fieldStyle, marginTop: 8 }}
                value={form.hours_worked}
                onChange={(event) => updateField("hours_worked", event.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="record-notes">Observações</label>
            <textarea
              id="record-notes"
              style={{ ...fieldStyle, minHeight: 120, marginTop: 8 }}
              value={form.operation_notes}
              onChange={(event) => updateField("operation_notes", event.target.value)}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
              paddingTop: 8,
            }}
          >
            <span style={{ color: "var(--muted)" }}>{message}</span>
            <button type="submit" className="auth-submit auth-submit-blue" disabled={isSaving}>
              {isSaving ? "Salvando..." : editState ? "Salvar alterações" : "Salvar registro"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export function HistoryPage() {
  const { records, refreshRecords, historyMonth } = useOutletContext();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const month = historyMonth || getCurrentMonthKey();
  const filteredRecords = useMemo(() => filterRecordsByMonth(records, month), [records, month]);
  const groupedRows = useMemo(() => aggregateRecordsByDate(filteredRecords), [filteredRecords]);

  const deleteRecord = async (date) => {
    try {
      setMessage("");
      await apiFetch(`/api/records/by-date/${encodeURIComponent(date)}`, { method: "DELETE" });
      await refreshRecords();
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <>
      <PageHeader title="Histórico" centered />
      <div className="card">
        <div className="admin-users-table-wrap">
          <table className="personal-table">
            <thead>
              <tr>
                <th>Uber</th>
                <th>99</th>
                <th>InDriver</th>
                <th>Comb.</th>
                <th>Rua</th>
                <th>Oleo</th>
                <th>Lavagem</th>
                <th>Outros</th>
                <th>Total</th>
                <th>Desp.</th>
                <th>Lucro</th>
                <th>Km</th>
                <th>Horas</th>
                <th>Dia</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.length ? (
                groupedRows.map((record) => (
                  <tr key={record.date}>
                    <td>{currency(record.uberIncome)}</td>
                    <td>{currency(record.ninetyNineIncome)}</td>
                    <td>{currency(record.indriverIncome)}</td>
                    <td>{currency(record.fuelExpense)}</td>
                    <td>{currency(record.streetFoodExpense)}</td>
                    <td>{currency(record.oilExpense)}</td>
                    <td>{currency(record.washExpense)}</td>
                    <td>{currency(record.otherExpense)}</td>
                    <td>{currency(record.income)}</td>
                    <td>{currency(record.expense)}</td>
                    <td>{currency(record.profit)}</td>
                    <td>{record.km.toFixed(1)}</td>
                    <td>{record.hoursWorked.toFixed(1)}</td>
                    <td>{String(record.date || "").slice(8, 10) || "-"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="password-btn"
                          onClick={() => navigate("/driver/register", { state: { editDay: record } })}
                        >
                          Editar
                        </button>
                        <button type="button" className="logout-btn" onClick={() => deleteRecord(record.date)}>
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="15" style={{ textAlign: "center" }}>
                    Nenhum registro encontrado para este mês.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {message ? <p className="auth-message">{message}</p> : null}
      </div>
    </>
  );
}

export function PerformancePage() {
  const { records, performanceMonth } = useOutletContext();
  const month = performanceMonth || getCurrentMonthKey();
  const [activeTab, setActiveTab] = useState("day");
  const [activeWeek, setActiveWeek] = useState("1");
  const monthRecords = useMemo(() => filterRecordsByMonth(records, month), [records, month]);
  const summary = useMemo(() => summarizeRecords(monthRecords), [monthRecords]);
  const performanceTabs = [
        { key: "day", label: "Médias por dia" },
        { key: "week", label: "Semanas do mês" },
        { key: "km", label: "Médias por km" },
        { key: "hour", label: "Médias por hora" },
  ];
  const weekOptions = useMemo(() => {
    const totalWeeks = Math.max(1, Math.ceil(getDaysInMonth(month) / 7));
    return Array.from({ length: totalWeeks }, (_, index) => {
      const weekNumber = index + 1;
      const weekRecords = monthRecords.filter((record) => getWeekNumberInMonth(record.date) === weekNumber);
      return {
        key: String(weekNumber),
        label: `Semana ${weekNumber}`,
        rangeLabel: getMonthWeekRangeLabel(month, weekNumber),
        summary: summarizeRecords(weekRecords),
      };
    });
  }, [month, monthRecords]);
  const activeWeekOption = weekOptions.find((week) => week.key === activeWeek) || weekOptions[0] || null;

  useEffect(() => {
    const defaultWeek = weekOptions.find((week) => week.summary.daysWorked > 0)?.key || weekOptions[0]?.key || "1";
    setActiveWeek((current) => (weekOptions.some((week) => week.key === current) ? current : defaultWeek));
  }, [weekOptions]);

  const metricsByTab = {
    day: [
      { label: "Faturamento por dia", value: currency(summary.incomePerDay) },
      { label: "Gastos por dia", value: currency(summary.expensePerDay) },
      { label: "Lucro por dia", value: currency(summary.profitPerDay) },
      { label: "Dias trabalhados", value: String(summary.daysWorked) },
    ],
    week: [
      { label: "Faturamento na semana", value: currency(activeWeekOption?.summary.income || 0) },
      { label: "Gastos na semana", value: currency(activeWeekOption?.summary.expense || 0) },
      { label: "Lucro na semana", value: currency(activeWeekOption?.summary.profit || 0) },
      { label: "Dias trabalhados na semana", value: String(activeWeekOption?.summary.daysWorked || 0) },
    ],
    km: [
      { label: "Faturamento por km", value: currency(summary.incomePerKm) },
      { label: "Gastos por km", value: currency(summary.expensePerKm) },
      { label: "Lucro por km", value: currency(summary.profitPerKm) },
      { label: "Km rodados", value: `${summary.km.toFixed(1)} km` },
    ],
    hour: [
      { label: "Faturamento por hora", value: currency(summary.incomePerHour) },
      { label: "Gastos por hora", value: currency(summary.expensePerHour) },
      { label: "Lucro por hora", value: currency(summary.profitPerHour) },
      { label: "Horas trabalhadas", value: `${summary.hours.toFixed(1)} h` },
    ],
  };
  const activeMetrics = metricsByTab[activeTab] || metricsByTab.day;
  const activeTabLabel = performanceTabs.find((tab) => tab.key === activeTab)?.label || performanceTabs[0].label;

  return (
    <>
      <PageHeader title="Desempenho" centered />
      <PageTabs tabs={performanceTabs} activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === "week" ? (
        <div className="card">
          <div className="filter-group">
            <label htmlFor="performance-week-filter">Semana</label>
            <select id="performance-week-filter" value={activeWeekOption?.key || "1"} onChange={(event) => setActiveWeek(event.target.value || "1")}>
              {weekOptions.map((week) => (
                <option key={week.key} value={week.key}>
                  {week.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      <PerformanceMetricCards metrics={activeMetrics} />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{activeTab === "week" ? activeWeekOption?.label || activeTabLabel : activeTabLabel}</h2>
      </div>
    </>
  );
}

export function SummaryPage() {
  const { records, summaryMonth } = useOutletContext();
  const month = summaryMonth || getCurrentMonthKey();
  const [goal, setGoal] = useState(() => getMonthlyGoalForMonth(month));
  const [goalDraft, setGoalDraft] = useState(() => String(getMonthlyGoalForMonth(month)));
  const [goalMessage, setGoalMessage] = useState("");
  const [dailyGoals, setDailyGoals] = useState(() => getSummaryMonthDailyData(month));
  const [dailyGoalsError, setDailyGoalsError] = useState("");
  const [savingDayOff, setSavingDayOff] = useState("");
  const [dailyGoalsVersion, setDailyGoalsVersion] = useState(0);
  const monthRecords = useMemo(() => filterRecordsByMonth(records, month), [records, month]);
  const monthDailyGoals = useMemo(() => dailyGoals || getSummaryMonthDailyData(month), [dailyGoals, month, dailyGoalsVersion]);
  const dailyRows = useMemo(() => {
    const incomeByDay = monthRecords.reduce((accumulator, record) => {
      const day = Number(String(record.date || "").slice(8, 10));
      if (!day) return accumulator;
      accumulator[day] = (accumulator[day] || 0) + Number(record.incomeValue || 0);
      return accumulator;
    }, {});

    const rows = [];
    const daysInMonth = getDaysInMonth(month);
    for (let day = 1; day <= daysInMonth; day += 1) {
      rows.push({
        day,
        weekday: getWeekdayLabel(month, day),
        goal: monthDailyGoals[String(day)]?.goal ?? "",
        dayOff: Boolean(monthDailyGoals[String(day)]?.dayOff),
        done: Number(incomeByDay[day] || 0),
      });
    }

    const baseGoal = Math.max(0, Number(goal) || 0);

    const isClosedRow = (row) => {
      if (row.dayOff) return true;
      return row.done > 0;
    };

    const suggestedByDay = {};
    const closedByDay = {};
    let remainingGoal = baseGoal;
    let openDayGoal = null;

    rows.forEach((row, index) => {
      if (row.dayOff) {
        suggestedByDay[row.day] = 0;
        closedByDay[row.day] = true;
        return;
      }

      const isClosed = isClosedRow(row);
      const remainingWorkDays = rows.slice(index).filter((candidate) => !candidate.dayOff).length;
      const remainingOpenDays = rows.slice(index).filter((candidate) => !candidate.dayOff && !isClosedRow(candidate)).length;
      const dayGoal = isClosed
        ? (remainingWorkDays > 0 ? Math.max(0, remainingGoal / remainingWorkDays) : 0)
        : (openDayGoal ?? (remainingOpenDays > 0 ? Math.max(0, remainingGoal / remainingOpenDays) : 0));

      suggestedByDay[row.day] = dayGoal;
      closedByDay[row.day] = isClosed;

      if (!isClosed && openDayGoal === null) {
        openDayGoal = dayGoal;
      }

      if (isClosed) {
        remainingGoal = Math.max(0, remainingGoal - row.done);
      }
    });

    return rows.map((row) => ({
      ...row,
      isClosed: Boolean(closedByDay[row.day]),
      suggested: suggestedByDay[row.day] ?? 0,
    }));
  }, [goal, month, monthDailyGoals, monthRecords]);

  useEffect(() => {
    const savedGoal = getMonthlyGoalForMonth(month);
    setGoal(savedGoal);
    setGoalDraft(String(savedGoal));
    setGoalMessage("");
  }, [month]);

  useEffect(() => {
    let isMounted = true;
    setDailyGoals(getSummaryMonthDailyData(month));
    setDailyGoalsError("");

    fetchSummaryMonthDailyData(month)
      .then((days) => {
        if (!isMounted) return;
        setDailyGoals(days);
      })
      .catch((error) => {
        if (!isMounted) return;
        setDailyGoalsError(error.message || "Não foi possível carregar as folgas salvas.");
      });

    return () => {
      isMounted = false;
    };
  }, [month, dailyGoalsVersion]);

  const toggleDayOff = async (row) => {
    const nextDayOff = !row.dayOff;
    const dayKey = String(row.day);
    const nextLocalStore = setSummaryDayValues(month, row.day, { dayOff: nextDayOff });
    setDailyGoals(nextLocalStore[month] || {});
    setDailyGoalsError("");
    setSavingDayOff(dayKey);

    try {
      await saveSummaryDayValues(month, row.day, { dayOff: nextDayOff });
    } catch (error) {
      setDailyGoalsError(error.message || "Não foi possível salvar a folga.");
    } finally {
      setSavingDayOff("");
      setDailyGoalsVersion((current) => current + 1);
    }
  };

  const saveMonthlyGoal = (event) => {
    event.preventDefault();

    const nextGoal = Number(goalDraft);
    if (!Number.isFinite(nextGoal) || nextGoal <= 0) {
      setGoalMessage("Informe uma meta mensal maior que zero.");
      return;
    }

    setGoal(nextGoal);
    setMonthlyGoalForMonth(month, nextGoal);
    setGoalMessage("Meta mensal salva.");
  };

  return (
    <>
      <PageHeader title="Metas" centered />
      <form className="card" onSubmit={saveMonthlyGoal}>
        <h2>Ajustar meta</h2>
        <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.95rem" }}>
          Meta mensal de {getMonthLabel(month)}: <strong style={{ color: "var(--text)" }}>{currency(goal)}</strong>
        </p>
        <label htmlFor="goal-input">Valor da meta mensal</label>
        <input
          id="goal-input"
          type="number"
          step="0.01"
          min="0"
          style={{ ...fieldStyle, marginTop: 8 }}
          value={goalDraft}
          onChange={(event) => setGoalDraft(event.target.value)}
        />
        <button type="submit" className="auth-submit auth-submit-blue" style={{ marginTop: 12, width: "auto", minWidth: 150 }}>
          Salvar meta
        </button>
        {goalMessage ? (
          <p style={{ margin: "10px 0 0", color: goalMessage.includes("salva") ? "#15803d" : "#b91c1c", fontWeight: 700 }}>
            {goalMessage}
          </p>
        ) : null}
      </form>
      <div className="card">
        <h2>Meta diária</h2>
        {dailyGoalsError ? (
          <p style={{ marginTop: 0, color: "#b91c1c", fontWeight: 700 }}>
            {dailyGoalsError}
          </p>
        ) : null}
        <div className="summary-goals-grid">
          {dailyRows.map((row) => {
            const hitTarget = !row.dayOff && row.suggested > 0 && row.done >= row.suggested;
            const statusClassName = row.dayOff ? "is-dayoff" : (hitTarget ? "is-hit" : "is-missed");
            const statusLabel = row.dayOff ? "Folga" : (hitTarget ? "Meta batida" : "Meta não batida");

            return (
              <div key={`${month}-${row.day}`} className={`summary-goal-card ${statusClassName}`}>
                <div className="summary-goal-card-header">
                  <div>
                    <strong>{String(row.day).padStart(2, "0")}</strong>
                    <span>{row.weekday}</span>
                  </div>
                  <span className="summary-goal-status">{statusLabel}</span>
                </div>

                <div className="summary-goal-card-values">
                  <div>
                    <span>Meta do dia</span>
                    <strong>{row.dayOff ? "Folga" : currency(row.suggested)}</strong>
                  </div>
                  <div>
                    <span>Fiz</span>
                    <strong>{currency(row.done)}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className={row.dayOff ? "logout-btn" : "password-btn"}
                  disabled={savingDayOff === String(row.day)}
                  onClick={() => toggleDayOff(row)}
                >
                  {savingDayOff === String(row.day) ? "Salvando..." : row.dayOff ? "Remover folga" : "Marcar folga"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function ExpensesPage() {
  const { user, expensesMonth } = useOutletContext();
  const [personalExpenses, setPersonalExpenses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState({ text: "", tone: "success" });
  const month = expensesMonth || getCurrentMonthKey();
  const [activeTab, setActiveTab] = useState("list");
  const [editingKey, setEditingKey] = useState("");
  const [form, setForm] = useState({
    description: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    installments: "",
    is_fixed: "",
    category: "",
    status: "pendente",
  });
  const filteredExpenses = useMemo(() => filterPersonalExpensesByMonth(personalExpenses, month), [personalExpenses, month]);
  const expenseRows = useMemo(
    () => filteredExpenses
      .filter((item) => item.type === "saida")
      .map((item) => ({ ...item, month_status: getPersonalExpenseStatusForMonth(item, month) })),
    [filteredExpenses, month]
  );
  const expenseTotal = useMemo(() => expenseRows.reduce((sum, item) => sum + Number(item.amount || 0), 0), [expenseRows]);
  const paidTotal = useMemo(
    () => expenseRows.filter((item) => item.month_status === "pago").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [expenseRows]
  );
  const pendingTotal = useMemo(
    () => expenseRows.filter((item) => item.month_status !== "pago").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [expenseRows]
  );
  const items = useMemo(() => {
    const grouped = expenseRows.reduce((accumulator, item) => {
      const key = item.category || "Outros";
      accumulator[key] = (accumulator[key] || 0) + Number(item.amount || 0);
      return accumulator;
    }, {});
    return Object.entries(grouped).sort((left, right) => right[1] - left[1]);
  }, [expenseRows]);
  const topCategory = items[0] || null;
  const chartColors = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#0f766e"];
  const chartSegments = useMemo(() => {
    if (!items.length || expenseTotal <= 0) return [];

    let currentPercent = 0;
    return items.map(([label, value], index) => {
      const percent = Number(((value / expenseTotal) * 100).toFixed(2));
      const start = currentPercent;
      currentPercent += percent;
      return {
        label,
        value,
        color: chartColors[index % chartColors.length],
        start,
        end: currentPercent,
      };
    });
  }, [items, expenseTotal]);
  const donutBackground = chartSegments.length
    ? `conic-gradient(${chartSegments.map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`).join(", ")})`
    : "conic-gradient(#e2e8f0 0 100%)";
  const tabs = [
    { key: "list", label: "Lista" },
    { key: "summary", label: "Resumo" },
  ];
  const summaryCards = [
    { key: "total", label: "Total do mês", value: currency(expenseTotal), tone: "card-blue" },
    { key: "paid", label: "Pagas", value: currency(paidTotal), tone: "card-green" },
    { key: "pending", label: "Pendentes", value: currency(pendingTotal), tone: "card-red" },
    { key: "category", label: "Maior categoria", value: topCategory ? `${getPersonalExpenseCategoryLabel(topCategory[0])} - ${currency(topCategory[1])}` : "Sem dados", tone: "card-orange" },
  ];

  const showToast = (text, tone = "success") => {
    setToast({ text, tone });
  };

  useEffect(() => {
    if (!toast.text) return undefined;
    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current.text === toast.text ? { text: "", tone: "success" } : current));
    }, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    let isMounted = true;
    const loadPersonalExpenses = async () => {
      try {
        setIsLoading(true);
        const payload = await apiFetch("/api/personal-expenses");
        if (!isMounted) return;
        setPersonalExpenses(Array.isArray(payload) ? payload.map(normalizePersonalExpenseItem) : []);
      } catch (error) {
        if (isMounted) showToast(error.message, "error");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadPersonalExpenses();
    return () => {
      isMounted = false;
    };
  }, []);

  const updateExpenseField = (name, value) => setForm((current) => {
    if (name === "installments") {
      const nextInstallments = String(value || "").trim();
      return {
        ...current,
        installments: value,
        is_fixed: nextInstallments ? "" : current.is_fixed,
      };
    }

    return { ...current, [name]: value };
  });

  const resetExpenseForm = () => {
    setEditingKey("");
    setForm({
      description: "",
      amount: "",
      date: new Date().toISOString().slice(0, 10),
      installments: "",
      is_fixed: "",
      category: "",
      status: "pendente",
    });
  };

  const persistExpenses = async (itemsToSave) => {
    const payload = await apiFetch("/api/personal-expenses/replace", {
      method: "POST",
      body: JSON.stringify({ items: itemsToSave }),
    });
    const normalized = Array.isArray(payload?.items) ? payload.items.map(normalizePersonalExpenseItem) : [];
    setPersonalExpenses(normalized);
    return normalized;
  };

  const handleExpenseSubmit = async (event) => {
    event.preventDefault();
    setToast({ text: "", tone: "success" });
    setIsSaving(true);
    try {
      const existingItem = editingKey ? personalExpenses.find((item) => item.entry_key === editingKey) : null;
      const normalized = normalizePersonalExpenseItem({
        entry_key: editingKey || createPersonalExpenseKey(),
        description: form.description,
        amount: Number(form.amount) || 0,
        category: form.category,
        status: form.status,
        date: form.date,
        due_day: Number(String(form.date || "").slice(8, 10)) || 1,
        installments: form.installments,
        is_fixed: form.installments ? null : (form.is_fixed === "" ? null : form.is_fixed === "sim"),
        account: user?.profileType || "outros",
        status_months: existingItem?.status_months || {},
      });

      const installmentsValue = String(form.installments || "").trim();

      if (!normalized.description) {
        throw new Error("Informe a descrição da despesa pessoal.");
      }
      if (normalized.amount <= 0) {
        throw new Error("Informe um valor válido para a despesa pessoal.");
      }
      if (installmentsValue && !parseInstallments(installmentsValue)) {
        throw new Error("Informe as parcelas no formato atual/total. Ex.: 3/9.");
      }
      if (!installmentsValue && form.is_fixed === "") {
        throw new Error("Informe se a despesa é fixa quando não houver parcelas.");
      }

      const nextStatusMonths = getUpdatedStatusMonths(normalized, month, form.status);
      normalized.status_months = nextStatusMonths;
      normalized.status = getBaseExpenseStatus(normalized, nextStatusMonths);

      const nextItems = editingKey
        ? personalExpenses.map((item) => (item.entry_key === editingKey ? normalized : item))
        : [normalized, ...personalExpenses];

      await persistExpenses(nextItems);
      resetExpenseForm();
      showToast(editingKey ? "Despesa pessoal atualizada." : "Despesa pessoal adicionada.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditExpense = (item) => {
    setEditingKey(item.entry_key);
    setForm({
      description: item.description || "",
      amount: String(item.amount || ""),
      date: String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      installments: item.installments || "",
      is_fixed: item.installments ? "" : item.is_fixed === true ? "sim" : item.is_fixed === false ? "nao" : "",
      category: item.category || "Outros",
      status: getPersonalExpenseStatusForMonth(item, month),
    });
    setActiveTab("list");
  };

  const handleDeleteExpense = async (entryKey) => {
    try {
      setToast({ text: "", tone: "success" });
      setIsSaving(true);
      await persistExpenses(personalExpenses.filter((item) => item.entry_key !== entryKey));
      if (editingKey === entryKey) resetExpenseForm();
      showToast("Despesa pessoal removida.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (entryKey) => {
    try {
      setToast({ text: "", tone: "success" });
      setIsSaving(true);
      await persistExpenses(
        personalExpenses.map((item) => {
          if (item.entry_key !== entryKey) return item;
          const currentStatus = getPersonalExpenseStatusForMonth(item, month);
          const nextStatus = currentStatus === "pago" ? "pendente" : "pago";
          const nextStatusMonths = getUpdatedStatusMonths(item, month, nextStatus);
          return {
            ...item,
            status_months: nextStatusMonths,
            status: getBaseExpenseStatus(item, nextStatusMonths),
          };
        })
      );
      showToast("Status da despesa atualizado.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        className={`app-toast${toast.text ? " visible" : ""}${toast.tone === "error" ? " error" : ""}`}
        role={toast.tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {toast.text}
      </div>
      <PageHeader title="Despesas pessoais" centered />
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "summary" ? (
        <div className="expenses-tab-content">
          <div className="card">
            <h2>Despesas pessoais por categoria</h2>
            <div className="admin-users-table-wrap">
              <table className="personal-table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Total</th>
                  <th>Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length ? (
                    items.map(([label, total]) => (
                      <tr key={label}>
                        <td>{getPersonalExpenseCategoryLabel(label)}</td>
                        <td>{currency(total)}</td>
                        <td>{expenseTotal > 0 ? `${((total / expenseTotal) * 100).toFixed(1)}%` : "0.0%"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" style={{ textAlign: "center" }}>
                        Nenhuma despesa encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Resumo</h2>
            {items.length ? (
              <div className="expenses-donut-layout">
                <div className="expenses-donut-card">
                  <div className="expenses-donut-chart" style={{ background: donutBackground }}>
                    <div className="expenses-donut-center">
                      <strong>{currency(expenseTotal)}</strong>
                      <span>Total</span>
                    </div>
                  </div>
                </div>

                <div className="expenses-donut-legend">
                  {chartSegments.map((segment) => (
                    <div key={segment.label} className="expenses-donut-legend-item">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="expenses-donut-dot" style={{ background: segment.color }} />
                        <strong>{getPersonalExpenseCategoryLabel(segment.label)}</strong>
                      </div>
                      <span>{currency(segment.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)" }}>Nenhuma despesa encontrada para exibir o resumo.</p>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "list" ? (
        <div className="expenses-tab-content">
          <section className="summary-grid dashboard-summary-cards expenses-summary-grid" aria-label="Resumo financeiro">
            {summaryCards.map((card) => (
              <div key={card.key} className={`card ${card.tone}`} style={dashboardSummaryCardStyles[card.tone]}>
                <span style={{ color: "rgba(255,255,255,0.82)" }}>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </section>

          <div className="card">
            <h2>Lista de despesas pessoais</h2>
            <form onSubmit={handleExpenseSubmit} className="admin-users-table-wrap">
              <table className="personal-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Vencimento</th>
                    <th>Parcelas</th>
                    <th>Fixo</th>
                    <th>Categoria</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        id="personal-expense-description"
                        style={fieldStyle}
                        value={form.description}
                        onChange={(event) => updateExpenseField("description", event.target.value)}
                        placeholder="Ex.: Faculdade"
                        required
                      />
                    </td>
                    <td>
                      <input
                        id="personal-expense-amount"
                        type="number"
                        step="0.01"
                        style={fieldStyle}
                        value={form.amount}
                        onChange={(event) => updateExpenseField("amount", event.target.value)}
                        placeholder="0,00"
                        required
                      />
                    </td>
                    <td>
                      <input
                        id="personal-expense-date"
                        type="date"
                        style={fieldStyle}
                        value={form.date}
                        onChange={(event) => updateExpenseField("date", event.target.value)}
                        required
                      />
                    </td>
                    <td>
                      <input
                        id="personal-expense-installments"
                        style={fieldStyle}
                        value={form.installments}
                        onChange={(event) => updateExpenseField("installments", event.target.value)}
                        placeholder="1/12"
                      />
                    </td>
                    <td>
                      <select
                        id="personal-expense-fixed"
                        style={fieldStyle}
                        value={form.is_fixed}
                        onChange={(event) => updateExpenseField("is_fixed", event.target.value)}
                        disabled={Boolean(String(form.installments || "").trim())}
                      >
                        <option value="">{String(form.installments || "").trim() ? "Parcelado" : "-"}</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </td>
                    <td>
                      <input
                        id="personal-expense-category"
                        list="personal-expense-category-options"
                        style={fieldStyle}
                        value={form.category}
                        onChange={(event) => updateExpenseField("category", event.target.value)}
                        placeholder="Digite a categoria"
                      />
                      <datalist id="personal-expense-category-options">
                        {personalExpenseCategories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </datalist>
                    </td>
                    <td>
                      <select
                        id="personal-expense-status"
                        style={fieldStyle}
                        value={form.status}
                        onChange={(event) => updateExpenseField("status", event.target.value)}
                      >
                        {personalExpenseStatuses.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="submit" className="auth-submit" disabled={isSaving}>
                          {isSaving ? "Salvando..." : editingKey ? "Salvar" : "Adicionar"}
                        </button>
                        {editingKey ? (
                          <button type="button" className="auth-outline-button" onClick={resetExpenseForm}>
                            Cancelar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expenseRows.length ? (
                    expenseRows.map((record) => (
                      <tr key={record.entry_key}>
                        <td>{record.description || "Sem descrição"}</td>
                        <td>{currency(record.amount)}</td>
                        <td>{formatDate(getPersonalExpenseDateForMonth(record, month))}</td>
                        <td>{record.is_fixed === true ? "-" : normalizeInstallmentsForMonth(record, month)}</td>
                        <td>{record.installments ? "-" : record.is_fixed === true ? "Sim" : record.is_fixed === false ? "Não" : "-"}</td>
                        <td>{getPersonalExpenseCategoryLabel(record.category || "Outros")}</td>
                        <td>
                          <span className={`status-pill ${record.month_status === "pago" ? "paid" : "pending"}`}>
                            {record.month_status === "pago" ? "Pago" : "Pendente"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="password-btn icon-action-btn"
                              onClick={() => handleToggleStatus(record.entry_key)}
                              title={record.month_status === "pago" ? "Marcar como pendente" : "Marcar como pago"}
                              aria-label={record.month_status === "pago" ? "Marcar como pendente" : "Marcar como pago"}
                            >
                              {record.month_status === "pago" ? "↩️" : "✅"}
                            </button>
                            <button
                              type="button"
                              className="password-btn icon-action-btn"
                              onClick={() => handleEditExpense(record)}
                              title="Editar"
                              aria-label="Editar"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className="logout-btn icon-action-btn"
                              onClick={() => handleDeleteExpense(record.entry_key)}
                              title="Excluir"
                              aria-label="Excluir"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" style={{ textAlign: "center" }}>
                        Nenhuma despesa encontrada neste mês.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </form>
          </div>
        </div>
      ) : null}

      {isLoading ? <p className="auth-message" style={{ color: "var(--text)" }}>Carregando despesas pessoais...</p> : null}
    </>
  );
}

export function NotesPage() {
  const { user } = useOutletContext();
  const [documents, setDocuments] = useState([]);
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    let isMounted = true;

    const loadDocuments = async () => {
      try {
        setIsLoading(true);
        const payload = await apiFetch("/api/admin-notes");
        if (!isMounted) return;
        const nextDocuments = Array.isArray(payload?.documents) ? payload.documents : [];
        const nextActiveDocument = payload?.activeDocument || null;
        setDocuments(nextDocuments);
        setActiveDocumentId(String(nextActiveDocument?.id || ""));
        setDocumentTitle(String(nextActiveDocument?.title || ""));
        setContent(String(nextActiveDocument?.contentHtml || "<p></p>"));
        setMessage(nextActiveDocument?.updatedAt ? "Arquivo carregado." : "");
      } catch (error) {
        if (isMounted) setMessage(error.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadDocuments();
    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!editorRef.current) return;
    const nextHtml = content || "<p></p>";
    if (editorRef.current.innerHTML !== nextHtml) {
      editorRef.current.innerHTML = nextHtml;
    }
    ensureNotesEditorHasContent(editorRef.current);
  }, [content]);

  const runEditorCommand = (command, value = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    ensureNotesEditorHasContent(editorRef.current);
    setContent(editorRef.current.innerHTML);
  };

  const applyNotesPayload = (payload, successMessage = "") => {
    const nextDocuments = Array.isArray(payload?.documents) ? payload.documents : [];
    const nextActiveDocument = payload?.activeDocument || null;
    setDocuments(nextDocuments);
    setActiveDocumentId(String(nextActiveDocument?.id || ""));
    setDocumentTitle(String(nextActiveDocument?.title || ""));
    setContent(String(nextActiveDocument?.contentHtml || "<p></p>"));
    setMessage(successMessage);
  };

  const insertTable = () => {
    const rows = Number(window.prompt("Quantidade de linhas da tabela:", "14"));
    const cols = Number(window.prompt("Quantidade de colunas da tabela:", "5"));
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand("insertHTML", false, createNotesTableMarkup(rows, cols));
    ensureNotesEditorHasContent(editorRef.current);
    setContent(editorRef.current.innerHTML);
  };

  const insertMonthlyTemplate = () => {
    if (!editorRef.current) return;
    const defaultMonth = `Mês ${notesMonthNames[new Date().getMonth()]}`;
    const monthLabel = window.prompt("Título do modelo:", defaultMonth);
    if (monthLabel === null) return;

    const headerInput = window.prompt("Nomes das colunas separados por vírgula:", "Nathan, Mauricio, Lene, Isaque, Saldo");
    if (headerInput === null) return;

    const headers = String(headerInput)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    editorRef.current.focus();
    document.execCommand("insertHTML", false, createMonthlyNotesTemplateMarkup({ monthLabel, headers }));
    ensureNotesEditorHasContent(editorRef.current);
    setContent(editorRef.current.innerHTML);
  };

  const save = async () => {
    if (!activeDocumentId) return;
    try {
      setMessage("");
      setIsSaving(true);
      const contentHtml = String(editorRef.current?.innerHTML || content || "<p></p>");
      const payload = await apiFetch(`/api/admin-notes/${activeDocumentId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: documentTitle,
          contentHtml,
        }),
      });
      applyNotesPayload(payload, "Arquivo salvo.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const openDocument = async (documentId) => {
    if (!documentId || String(documentId) === String(activeDocumentId)) return;
    try {
      setMessage("");
      setIsLoading(true);
      const payload = await apiFetch(`/api/admin-notes?documentId=${encodeURIComponent(documentId)}`);
      applyNotesPayload(payload, "Arquivo aberto.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const createDocument = async () => {
    const defaultTitle = `Arquivo ${documents.length + 1}`;
    const title = window.prompt("Nome do arquivo:", defaultTitle);
    if (title === null) return;

    try {
      setMessage("");
      setIsLoading(true);
      const payload = await apiFetch("/api/admin-notes", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      applyNotesPayload(payload, "Arquivo criado.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteDocument = async () => {
    if (!activeDocumentId) return;
    const activeDocument = documents.find((document) => String(document.id) === String(activeDocumentId));
    const confirmed = window.confirm(`Apagar o arquivo "${activeDocument?.title || documentTitle || "Arquivo sem título"}"?`);
    if (!confirmed) return;

    try {
      setMessage("");
      setIsDeleting(true);
      const payload = await apiFetch(`/api/admin-notes/${activeDocumentId}`, {
        method: "DELETE",
      });
      applyNotesPayload(payload, "Arquivo apagado.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <div className="card">
        <PageHeader title="Bloco de notas" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Bloco de notas"
        actions={(
          <button type="button" className="auth-outline-button" onClick={createDocument}>
            Novo arquivo
          </button>
        )}
      />
      <div className="card admin-notes-card">
        {documents.length ? (
          <div className="page-tabs" role="tablist" aria-label="Arquivos salvos do bloco de notas" style={{ marginBottom: 0 }}>
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                role="tab"
                aria-selected={String(document.id) === String(activeDocumentId)}
                className={`page-tab${String(document.id) === String(activeDocumentId) ? " active" : ""}`}
                onClick={() => openDocument(document.id)}
              >
                {document.title || "Arquivo sem título"}
              </button>
            ))}
          </div>
        ) : null}
        <div className="filter-group" style={{ maxWidth: 360 }}>
          <label htmlFor="admin-note-title">Nome do arquivo</label>
          <input
            id="admin-note-title"
            type="text"
            style={fieldStyle}
            value={documentTitle}
            onChange={(event) => setDocumentTitle(event.target.value)}
            placeholder="Arquivo sem título"
            maxLength={120}
          />
        </div>
        <div className="admin-notes-toolbar" role="toolbar" aria-label="Ferramentas do bloco de notas">
          {[
            { label: <strong>B</strong>, command: "bold" },
            { label: <em>I</em>, command: "italic" },
            { label: <u>U</u>, command: "underline" },
            { label: "Lista", command: "insertUnorderedList" },
            { label: "Numerada", command: "insertOrderedList" },
            { label: "Título", command: "formatBlock", value: "h2" },
            { label: "Texto", command: "formatBlock", value: "p" },
          ].map((item, index) => (
            <button
              key={`${item.command}-${index}`}
              type="button"
              className="admin-notes-toolbar-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runEditorCommand(item.command, item.value || null)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className="admin-notes-toolbar-btn" onMouseDown={(event) => event.preventDefault()} onClick={insertTable}>
            Tabela
          </button>
          <button type="button" className="admin-notes-toolbar-btn" onMouseDown={(event) => event.preventDefault()} onClick={insertMonthlyTemplate}>
            Modelo mensal
          </button>
        </div>
        <div
          ref={editorRef}
          className="admin-notes-editor"
          contentEditable
          suppressContentEditableWarning
          aria-label="Editor do bloco de notas"
          onInput={(event) => setContent(event.currentTarget.innerHTML)}
          onBlur={() => ensureNotesEditorHasContent(editorRef.current)}
        />
        <div className="admin-notes-actions">
          <button type="button" className="auth-submit auth-submit-blue" onClick={save} disabled={!activeDocumentId || isSaving || isDeleting}>
            {isSaving ? "Salvando..." : "Salvar arquivo"}
          </button>
          <button type="button" className="logout-btn" onClick={deleteDocument} disabled={!activeDocumentId || isDeleting || isSaving}>
            {isDeleting ? "Apagando..." : "Apagar arquivo"}
          </button>
          <span
            className="admin-notes-message"
            style={{ color: ["Arquivo salvo.", "Arquivo criado.", "Arquivo aberto.", "Arquivo carregado.", "Arquivo apagado."].includes(message) ? "var(--success, #166534)" : undefined }}
          >
            {message}
          </span>
        </div>
        {isLoading ? <p className="admin-notes-message" style={{ color: "var(--text)" }}>Carregando arquivos...</p> : null}
      </div>
    </>
  );
}

export function UsersPage() {
  const { user } = useOutletContext();
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", profileType: "driver", isAdmin: false });

  const loadUsers = async () => {
    try {
      const payload = await apiFetch("/api/auth/users");
      setUsers(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setMessage(error.message);
    }
  };

  useEffect(() => {
    if (user?.isAdmin) {
      loadUsers();
    }
  }, [user]);

  const createUser = async (event) => {
    event.preventDefault();
    try {
      setMessage("");
      await apiFetch("/api/auth/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ name: "", email: "", password: "", profileType: "driver", isAdmin: false });
      await loadUsers();
      setMessage("Usuário criado.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  const deleteUser = async (id) => {
    try {
      setMessage("");
      await apiFetch(`/api/auth/users/${id}`, { method: "DELETE" });
      await loadUsers();
    } catch (error) {
      setMessage(error.message);
    }
  };

  if (!user?.isAdmin) {
    return (
      <div className="card">
        <PageHeader title="Usuários" centered />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Usuários" centered />
      <div className="card admin-users-card">
        <form onSubmit={createUser} className="admin-user-form">
          <input placeholder="Nome" style={fieldStyle} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          <input placeholder="Email" type="email" style={fieldStyle} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
          <input placeholder="Senha inicial" type="password" style={fieldStyle} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
          <select style={fieldStyle} value={form.profileType} onChange={(event) => setForm((current) => ({ ...current, profileType: event.target.value }))}>
            <option value="driver">Motorista</option>
            <option value="pessoal">Pessoal</option>
          </select>
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={form.isAdmin} onChange={(event) => setForm((current) => ({ ...current, isAdmin: event.target.checked }))} />
            <span>Criar como admin</span>
          </label>
          <button type="submit" className="auth-submit auth-submit-blue">Criar usuário</button>
        </form>
        <div className="admin-users-table-wrap">
          <table className="personal-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Perfil</th>
                <th>Visto por último</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>{getProfileTypeLabel(row.profile_type)}</td>
                  <td>{formatLastSeenLabel(row.last_login_at)}</td>
                  <td>
                    {Number(row.id) === Number(user?.id) ? (
                      <span>Sua conta</span>
                    ) : (
                      <button type="button" className="logout-btn" onClick={() => deleteUser(row.id)}>
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {message ? <p className="auth-message">{message}</p> : null}
      </div>
    </>
  );
}

export function ProfilePage() {
  const { user, onLogout, refreshSession } = useOutletContext();
  const [message, setMessage] = useState("");
  const [name, setName] = useState(user?.name || "");
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });

  useEffect(() => {
    setName(user?.name || "");
  }, [user?.name]);

  const changeName = async (event) => {
    event.preventDefault();
    try {
      setMessage("");
      await apiFetch("/api/auth/change-name", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await refreshSession();
      setMessage("Nome alterado com sucesso.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    try {
      setMessage("");
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify(passwords),
      });
      setPasswords({ currentPassword: "", newPassword: "" });
      setMessage("Senha alterada com sucesso.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <>
      <PageHeader title="Perfil" centered />
      <div className="dashboard-main-grid">
        <div className="card">
          <h2>Conta</h2>
          <form className="password-form" onSubmit={changeName}>
            <label htmlFor="profile-name">Nome</label>
            <input
              id="profile-name"
              type="text"
              style={fieldStyle}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <button type="submit" className="auth-submit">Salvar nome</button>
          </form>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>Perfil:</strong> {getProfileTypeLabel(user.profileType)}</p>
          <p><strong>Admin:</strong> {user.isAdmin ? "Sim" : "Não"}</p>
          <button type="button" className="logout-btn" onClick={onLogout}>
            Sair
          </button>
        </div>
        <div className="card">
          <h2>Trocar senha</h2>
          <form className="password-form" onSubmit={changePassword}>
            <label htmlFor="current-password">Senha atual</label>
            <input id="current-password" type="password" style={fieldStyle} value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} required />
            <label htmlFor="new-password">Nova senha</label>
            <input id="new-password" type="password" style={fieldStyle} value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} required />
            <button type="submit" className="auth-submit auth-submit-blue">Salvar nova senha</button>
          </form>
          {message ? <p className="auth-message">{message}</p> : null}
        </div>
      </div>
    </>
  );
}

// Componentes exclusivos do perfil pessoal
export function PersonalReceitasPage() {
  const { user, expensesMonth } = useOutletContext?.() || {};
  const month = expensesMonth || getCurrentMonthKey();
  const [personalEntries, setPersonalEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    description: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [toast, setToast] = useState({ text: "", tone: "success" });

  // Carregar receitas e saídas do usuário
  useEffect(() => {
    let isMounted = true;
    const loadPersonalEntries = async () => {
      try {
        setIsLoading(true);
        const payload = await apiFetch("/api/personal-expenses");
        if (!isMounted) return;
        setPersonalEntries(Array.isArray(payload) ? payload.map(normalizePersonalExpenseItem) : []);
      } catch (error) {
        if (isMounted) setToast({ text: error.message, tone: "error" });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadPersonalEntries();
    return () => { isMounted = false; };
  }, []);

  // Filtrar por mês e tipo
  const monthEntries = useMemo(() => personalEntries.filter(e => e.date.slice(0,7) === month), [personalEntries, month]);
  const receitas = useMemo(() => monthEntries.filter(e => e.type === "entrada"), [monthEntries]);
  const saidas = useMemo(() => monthEntries.filter(e => e.type === "saida"), [monthEntries]);
  const totalReceitas = receitas.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalSaidas = saidas.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const lucro = totalReceitas - totalSaidas;

  // Lembrete de vencimento (igual dashboard)
  const dueReminders = useMemo(() => {
    const today = new Date();
    const currentMonth = getCurrentMonthKey();
    const nextMonth = (() => {
      const [y, m] = currentMonth.split("-").map(Number);
      const d = new Date(y, m, 1);
      return d.toISOString().slice(0, 7);
    })();
    const seen = new Set();
    return personalEntries
      .flatMap((item) => [currentMonth, nextMonth].map((monthKey) => ({ item, monthKey })))
      .filter(({ item, monthKey }) => item.type === "saida" && getPersonalExpenseStatusForMonth(item, monthKey) !== "pago")
      .map(({ item, monthKey }) => {
        const dueDate = String(item.date || "").slice(0, 10);
        const dayDiff = Math.round((new Date(dueDate) - today) / (1000 * 60 * 60 * 24));
        return {
          key: `${item.entry_key || item.id || item.description}-${dueDate}`,
          description: item.description || item.category || "Conta sem descrição",
          amount: item.amount,
          dueDate,
          dayDiff,
        };
      })
      .filter((item) => item.dayDiff >= -7 && item.dayDiff <= 7)
      .filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      })
      .sort((left, right) => left.dayDiff - right.dayDiff || left.dueDate.localeCompare(right.dueDate))
      .slice(0, 3);
  }, [personalEntries]);

  // Atualizar campo do formulário
  const updateForm = (name, value) => setForm(f => ({ ...f, [name]: value }));
  const resetForm = () => setForm({ description: "", amount: "", date: new Date().toISOString().slice(0, 10) });

  // Persistir receitas (tipo entrada)
  const persistEntries = async (itemsToSave) => {
    const payload = await apiFetch("/api/personal-expenses/replace", {
      method: "POST",
      body: JSON.stringify({ items: itemsToSave }),
    });
    const normalized = Array.isArray(payload?.items) ? payload.items.map(normalizePersonalExpenseItem) : [];
    setPersonalEntries(normalized);
    return normalized;
  };

  // Submeter nova receita
  const handleSubmit = async (event) => {
    event.preventDefault();
    setToast({ text: "", tone: "success" });
    setIsSaving(true);
    try {
      if (!form.description) throw new Error("Informe a descrição da receita.");
      const valor = Number(form.amount.toString().replace(",", "."));
      if (!valor || valor <= 0) throw new Error("Informe um valor válido.");
      if (!form.date) throw new Error("Informe a data.");
      const entry = {
        entry_key: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        description: form.description,
        amount: valor,
        type: "entrada",
        category: "Receita",
        account: user?.profileType || "outros",
        status: "pago",
        status_months: {},
        date: form.date,
        due_day: Number(form.date.slice(8, 10)) || 1,
        installments: "",
        is_fixed: null,
        installments_start_month: form.date.slice(0, 7),
      };
      const nextItems = [entry, ...personalEntries];
      await persistEntries(nextItems);
      resetForm();
      setToast({ text: "Receita adicionada!", tone: "success" });
    } catch (error) {
      setToast({ text: error.message, tone: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card">
      <h1>Receitas</h1>
      {/* Lembrete de vencimento */}
      <div className={`dashboard-reminder-card${!dueReminders.length ? " is-empty" : ""}`} aria-live="polite" style={{marginBottom: 24}}>
        <div className="dashboard-reminder-icon">!</div>
        <div className="dashboard-reminder-content">
          <strong>Lembrete de vencimento</strong>
          {dueReminders.length ? (
            <ul className="dashboard-reminder-list">
              {dueReminders.map((item) => (
                <li key={item.key}>
                  <span>{item.description}</span>
                  {" "}
                  <strong>
                    {item.dayDiff < 0
                      ? `atrasada desde ${formatDate(item.dueDate)}`
                      : item.dayDiff === 0
                      ? "vence hoje"
                      : `vence em ${item.dayDiff} dia${item.dayDiff > 1 ? "s" : ""}`}
                    {` - ${currency(item.amount)}`}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma conta pendente vence nos próximos 7 dias.</p>
          )}
        </div>
      </div>

      {/* Formulário de receita */}
      <form className="modern-finance-form" style={{marginBottom: 24}} onSubmit={handleSubmit}>
        <div className="modern-form-group">
          <label>Receita</label>
          <input type="text" placeholder="Ex: Salário, Pix, Venda..." className="modern-input" value={form.description} onChange={e => updateForm("description", e.target.value)} required />
        </div>
        <div className="modern-form-group">
          <label>Valor</label>
          <input type="number" inputMode="decimal" placeholder="0,00" className="modern-input" value={form.amount} onChange={e => updateForm("amount", e.target.value)} required min="0.01" step="0.01" />
        </div>
        <div className="modern-form-group">
          <label>Dia de recebimento</label>
          <input type="date" className="modern-input" value={form.date} onChange={e => updateForm("date", e.target.value)} required />
        </div>
        <div className="modern-form-group" style={{alignSelf: 'flex-end'}}>
          <button type="submit" className="modern-add-btn" disabled={isSaving}>{isSaving ? "Salvando..." : "Adicionar"}</button>
        </div>
      </form>

      {/* Cards de resumo */}
      <div className="summary-grid dashboard-summary-cards personal-dashboard-cards">
        <div className="card card-green">
          <span>Receitas</span>
          <strong>{currency(totalReceitas)}</strong>
        </div>
        <div className="card card-red">
          <span>Saídas</span>
          <strong>{currency(totalSaidas)}</strong>
        </div>
        <div className="card card-blue">
          <span>Lucro</span>
          <strong>{currency(lucro)}</strong>
        </div>
      </div>

      {toast.text && (
        <div className={`app-toast visible${toast.tone === "error" ? " error" : ""}`} role={toast.tone === "error" ? "alert" : "status"} aria-live="polite">{toast.text}</div>
      )}
      {isLoading && <p>Carregando receitas...</p>}
      {!isLoading && receitas.length > 0 && (
        <div style={{marginTop:32}}>
          <h2 style={{fontSize:18,marginBottom:8}}>Receitas do mês</h2>
          <table className="personal-table">
            <thead>
              <tr>
                <th>Receita</th>
                <th>Valor</th>
                <th>Dia de recebimento</th>
              </tr>
            </thead>
            <tbody>
              {receitas.map((item) => (
                <tr key={item.entry_key}>
                  <td>{item.description}</td>
                  <td>{currency(item.amount)}</td>
                  <td>{formatDate(item.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PersonalDespesasPage() {
  const { user, expensesMonth } = useOutletContext?.() || {};
  const month = expensesMonth || getCurrentMonthKey();
  const [personalEntries, setPersonalEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState({ text: "", tone: "success" });
  const [activeTab, setActiveTab] = useState("list");
  const [editingKey, setEditingKey] = useState("");
  const [form, setForm] = useState({
    description: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    installments: "",
    is_fixed: "",
    category: "",
    status: "pendente",
  });

  // Carregar despesas pessoais
  useEffect(() => {
    let isMounted = true;
    const loadPersonalEntries = async () => {
      try {
        setIsLoading(true);
        const payload = await apiFetch("/api/personal-expenses");
        if (!isMounted) return;
        setPersonalEntries(Array.isArray(payload) ? payload.map(normalizePersonalExpenseItem) : []);
      } catch (error) {
        if (isMounted) setToast({ text: error.message, tone: "error" });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadPersonalEntries();
    return () => { isMounted = false; };
  }, []);

  // Filtrar por mês e tipo
  const monthEntries = useMemo(() => personalEntries.filter(e => e.date.slice(0,7) === month), [personalEntries, month]);
  const saidas = useMemo(() => monthEntries.filter(e => e.type === "saida"), [monthEntries]);
  const expenseRows = useMemo(
    () => saidas.map((item) => ({ ...item, month_status: getPersonalExpenseStatusForMonth(item, month) })),
    [saidas, month]
  );
  const expenseTotal = useMemo(() => expenseRows.reduce((sum, item) => sum + Number(item.amount || 0), 0), [expenseRows]);
  const paidTotal = useMemo(
    () => expenseRows.filter((item) => item.month_status === "pago").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [expenseRows]
  );
  const pendingTotal = useMemo(
    () => expenseRows.filter((item) => item.month_status !== "pago").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [expenseRows]
  );
  const items = useMemo(() => {
    const grouped = expenseRows.reduce((accumulator, item) => {
      const key = item.category || "Outros";
      accumulator[key] = (accumulator[key] || 0) + Number(item.amount || 0);
      return accumulator;
    }, {});
    return Object.entries(grouped).sort((left, right) => right[1] - left[1]);
  }, [expenseRows]);
  const topCategory = items[0] || null;
  const chartColors = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#0f766e"];
  const chartSegments = useMemo(() => {
    if (!items.length || expenseTotal <= 0) return [];
    let currentPercent = 0;
    return items.map(([label, value], index) => {
      const percent = Number(((value / expenseTotal) * 100).toFixed(2));
      const start = currentPercent;
      currentPercent += percent;
      return {
        label,
        value,
        color: chartColors[index % chartColors.length],
        start,
        end: currentPercent,
      };
    });
  }, [items, expenseTotal]);
  const donutBackground = chartSegments.length
    ? `conic-gradient(${chartSegments.map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`).join(", ")})`
    : "conic-gradient(#e2e8f0 0 100%)";
  const tabs = [
    { key: "list", label: "Lista" },
    { key: "summary", label: "Resumo" },
  ];
  const summaryCards = [
    { key: "total", label: "Total do mês", value: currency(expenseTotal), tone: "card-blue" },
    { key: "paid", label: "Pagas", value: currency(paidTotal), tone: "card-green" },
    { key: "pending", label: "Pendentes", value: currency(pendingTotal), tone: "card-red" },
    { key: "category", label: "Maior categoria", value: topCategory ? `${getPersonalExpenseCategoryLabel(topCategory[0])} - ${currency(topCategory[1])}` : "Sem dados", tone: "card-orange" },
  ];

  const showToast = (text, tone = "success") => {
    setToast({ text, tone });
  };

  const updateExpenseField = (name, value) => setForm((current) => {
    if (name === "installments") {
      const nextInstallments = String(value || "").trim();
      return {
        ...current,
        installments: value,
        is_fixed: nextInstallments ? "" : current.is_fixed,
      };
    }
    return { ...current, [name]: value };
  });

  const resetExpenseForm = () => {
    setEditingKey("");
    setForm({
      description: "",
      amount: "",
      date: new Date().toISOString().slice(0, 10),
      installments: "",
      is_fixed: "",
      category: "",
      status: "pendente",
    });
  };

  const persistEntries = async (itemsToSave) => {
    const payload = await apiFetch("/api/personal-expenses/replace", {
      method: "POST",
      body: JSON.stringify({ items: itemsToSave }),
    });
    const normalized = Array.isArray(payload?.items) ? payload.items.map(normalizePersonalExpenseItem) : [];
    setPersonalEntries(normalized);
    return normalized;
  };

  const handleExpenseSubmit = async (event) => {
    event.preventDefault();
    setToast({ text: "", tone: "success" });
    setIsSaving(true);
    try {
      const existingItem = editingKey ? personalEntries.find((item) => item.entry_key === editingKey) : null;
      const normalized = normalizePersonalExpenseItem({
        entry_key: editingKey || createPersonalExpenseKey(),
        description: form.description,
        amount: Number(form.amount) || 0,
        category: form.category,
        status: form.status,
        date: form.date,
        due_day: Number(String(form.date || "").slice(8, 10)) || 1,
        installments: form.installments,
        is_fixed: form.installments ? null : (form.is_fixed === "" ? null : form.is_fixed === "sim"),
        account: user?.profileType || "outros",
        status_months: existingItem?.status_months || {},
        type: "saida",
      });
      const installmentsValue = String(form.installments || "").trim();
      if (!normalized.description) {
        throw new Error("Informe a descrição da despesa pessoal.");
      }
      if (normalized.amount <= 0) {
        throw new Error("Informe um valor válido para a despesa pessoal.");
      }
      if (installmentsValue && !parseInstallments(installmentsValue)) {
        throw new Error("Informe as parcelas no formato atual/total. Ex.: 3/9.");
      }
      if (!installmentsValue && form.is_fixed === "") {
        throw new Error("Informe se a despesa é fixa quando não houver parcelas.");
      }
      const nextStatusMonths = getUpdatedStatusMonths(normalized, month, form.status);
      normalized.status_months = nextStatusMonths;
      normalized.status = getBaseExpenseStatus(normalized, nextStatusMonths);
      const nextItems = editingKey
        ? personalEntries.map((item) => (item.entry_key === editingKey ? normalized : item))
        : [normalized, ...personalEntries];
      await persistEntries(nextItems);
      resetExpenseForm();
      showToast(editingKey ? "Despesa pessoal atualizada." : "Despesa pessoal adicionada.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditExpense = (item) => {
    setEditingKey(item.entry_key);
    setForm({
      description: item.description || "",
      amount: String(item.amount || ""),
      date: String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      installments: item.installments || "",
      is_fixed: item.installments ? "" : item.is_fixed === true ? "sim" : item.is_fixed === false ? "nao" : "",
      category: item.category || "Outros",
      status: getPersonalExpenseStatusForMonth(item, month),
    });
    setActiveTab("list");
  };

  const handleDeleteExpense = async (entryKey) => {
    try {
      setToast({ text: "", tone: "success" });
      setIsSaving(true);
      await persistEntries(personalEntries.filter((item) => item.entry_key !== entryKey));
      if (editingKey === entryKey) resetExpenseForm();
      showToast("Despesa pessoal removida.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (entryKey) => {
    try {
      setToast({ text: "", tone: "success" });
      setIsSaving(true);
      await persistEntries(
        personalEntries.map((item) => {
          if (item.entry_key !== entryKey) return item;
          const currentStatus = getPersonalExpenseStatusForMonth(item, month);
          const nextStatus = currentStatus === "pago" ? "pendente" : "pago";
          const nextStatusMonths = getUpdatedStatusMonths(item, month, nextStatus);
          return {
            ...item,
            status_months: nextStatusMonths,
            status: getBaseExpenseStatus(item, nextStatusMonths),
          };
        })
      );
      showToast("Status da despesa atualizado.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        className={`app-toast${toast.text ? " visible" : ""}${toast.tone === "error" ? " error" : ""}`}
        role={toast.tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {toast.text}
      </div>
      <PageHeader title="Despesas pessoais" centered />
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "summary" ? (
        <div className="expenses-tab-content">
          <div className="card">
            <h2>Despesas pessoais por categoria</h2>
            <div className="admin-users-table-wrap">
              <table className="personal-table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Total</th>
                    <th>Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length ? (
                    items.map(([label, total]) => (
                      <tr key={label}>
                        <td>{getPersonalExpenseCategoryLabel(label)}</td>
                        <td>{currency(total)}</td>
                        <td>{expenseTotal > 0 ? `${((total / expenseTotal) * 100).toFixed(1)}%` : "0.0%"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" style={{ textAlign: "center" }}>
                        Nenhuma despesa encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2>Resumo</h2>
            {items.length ? (
              <div className="expenses-donut-layout">
                <div className="expenses-donut-card">
                  <div className="expenses-donut-chart" style={{ background: donutBackground }}>
                    <div className="expenses-donut-center">
                      <strong>{currency(expenseTotal)}</strong>
                      <span>Total</span>
                    </div>
                  </div>
                </div>
                <div className="expenses-donut-legend">
                  {chartSegments.map((segment) => (
                    <div key={segment.label} className="expenses-donut-legend-item">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="expenses-donut-dot" style={{ background: segment.color }} />
                        <strong>{getPersonalExpenseCategoryLabel(segment.label)}</strong>
                      </div>
                      <span>{currency(segment.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)" }}>Nenhuma despesa encontrada para exibir o resumo.</p>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "list" ? (
        <div className="expenses-tab-content">
          <section className="summary-grid dashboard-summary-cards expenses-summary-grid" aria-label="Resumo financeiro">
            {summaryCards.map((card) => (
              <div key={card.key} className={`card ${card.tone}`} style={dashboardSummaryCardStyles[card.tone]}>
                <span style={{ color: "rgba(255,255,255,0.82)" }}>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </section>
          <div className="card">
            <h2>Lista de despesas pessoais</h2>
            <form onSubmit={handleExpenseSubmit} className="admin-users-table-wrap">
              <table className="personal-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Vencimento</th>
                    <th>Parcelas</th>
                    <th>Fixo</th>
                    <th>Categoria</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        id="personal-expense-description"
                        style={fieldStyle}
                        value={form.description}
                        onChange={(event) => updateExpenseField("description", event.target.value)}
                        placeholder="Ex.: Faculdade"
                        required
                      />
                    </td>
                    <td>
                      <input
                        id="personal-expense-amount"
                        type="number"
                        step="0.01"
                        style={fieldStyle}
                        value={form.amount}
                        onChange={(event) => updateExpenseField("amount", event.target.value)}
                        placeholder="0,00"
                        required
                      />
                    </td>
                    <td>
                      <input
                        id="personal-expense-date"
                        type="date"
                        style={fieldStyle}
                        value={form.date}
                        onChange={(event) => updateExpenseField("date", event.target.value)}
                        required
                      />
                    </td>
                    <td>
                      <input
                        id="personal-expense-installments"
                        style={fieldStyle}
                        value={form.installments}
                        onChange={(event) => updateExpenseField("installments", event.target.value)}
                        placeholder="1/12"
                      />
                    </td>
                    <td>
                      <select
                        id="personal-expense-fixed"
                        style={fieldStyle}
                        value={form.is_fixed}
                        onChange={(event) => updateExpenseField("is_fixed", event.target.value)}
                        disabled={Boolean(String(form.installments || "").trim())}
                      >
                        <option value="">{String(form.installments || "").trim() ? "Parcelado" : "-"}</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </td>
                    <td>
                      <input
                        id="personal-expense-category"
                        list="personal-expense-category-options"
                        style={fieldStyle}
                        value={form.category}
                        onChange={(event) => updateExpenseField("category", event.target.value)}
                        placeholder="Digite a categoria"
                      />
                      <datalist id="personal-expense-category-options">
                        {personalExpenseCategories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </datalist>
                    </td>
                    <td>
                      <select
                        id="personal-expense-status"
                        style={fieldStyle}
                        value={form.status}
                        onChange={(event) => updateExpenseField("status", event.target.value)}
                      >
                        {personalExpenseStatuses.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="submit" className="auth-submit" disabled={isSaving}>
                          {isSaving ? "Salvando..." : editingKey ? "Salvar" : "Adicionar"}
                        </button>
                        {editingKey ? (
                          <button type="button" className="auth-outline-button" onClick={resetExpenseForm}>
                            Cancelar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expenseRows.length ? (
                    expenseRows.map((record) => (
                      <tr key={record.entry_key}>
                        <td>{record.description || "Sem descrição"}</td>
                        <td>{currency(record.amount)}</td>
                        <td>{formatDate(getPersonalExpenseDateForMonth(record, month))}</td>
                        <td>{record.is_fixed === true ? "-" : normalizeInstallmentsForMonth(record, month)}</td>
                        <td>{record.installments ? "-" : record.is_fixed === true ? "Sim" : record.is_fixed === false ? "Não" : "-"}</td>
                        <td>{getPersonalExpenseCategoryLabel(record.category || "Outros")}</td>
                        <td>
                          <span className={`status-pill ${record.month_status === "pago" ? "paid" : "pending"}`}>
                            {record.month_status === "pago" ? "Pago" : "Pendente"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="password-btn icon-action-btn"
                              onClick={() => handleToggleStatus(record.entry_key)}
                              title={record.month_status === "pago" ? "Marcar como pendente" : "Marcar como pago"}
                              aria-label={record.month_status === "pago" ? "Marcar como pendente" : "Marcar como pago"}
                            >
                              {record.month_status === "pago" ? "↩️" : "✅"}
                            </button>
                            <button
                              type="button"
                              className="password-btn icon-action-btn"
                              onClick={() => handleEditExpense(record)}
                              title="Editar"
                              aria-label="Editar"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className="logout-btn icon-action-btn"
                              onClick={() => handleDeleteExpense(record.entry_key)}
                              title="Excluir"
                              aria-label="Excluir"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" style={{ textAlign: "center" }}>
                        Nenhuma despesa encontrada neste mês.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </form>
          </div>
        </div>
      ) : null}

      {isLoading ? <p className="auth-message" style={{ color: "var(--text)" }}>Carregando despesas pessoais...</p> : null}
    </>
  );
}

export function PersonalResumoPage() {
  return (
    <div className="card">
      <h1>Resumo</h1>
      {/* Cards e gráficos de resumo financeiro */}
      <p>Em breve: resumo financeiro do perfil pessoal.</p>
    </div>
  );
}

