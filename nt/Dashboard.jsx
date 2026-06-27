import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FaArrowTrendUp, FaCircleArrowDown, FaCircleArrowUp } from "react-icons/fa6";
import { currency, filterRecordsByMonth, formatDate, getCurrentMonthKey, getMonthlyGoalForMonth, getMonthlyStatus, normalizeMonthlyStatusMap, summarizeRecords } from "./driver-data";
import { apiFetch } from "./http";

const summaryCardStyles = {
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
};

const REMINDER_WINDOW_DAYS = 7;
const DAY_IN_MS = 86400000;

function getExpenseTypeLabel(label) {
  const labels = {
    combustivel: "Combustível",
    "alimentacao na rua": "Alimentação na rua",
    "troca de oleo": "Troca de óleo",
  };
  return labels[String(label || "").toLowerCase()] || label || "Outros";
}

function normalizePersonalExpenseItem(item = {}) {
  const date = String(item.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return {
    id: item.id || null,
    entry_key: String(item.entry_key || item.entryKey || item.id || ""),
    description: String(item.description || "").trim(),
    amount: Number(item.amount) || 0,
    category: String(item.category || "Outros").trim() || "Outros",
    status: item.status === "pago" ? "pago" : "pendente",
    status_months: normalizeMonthlyStatusMap(item.status_months ?? item.statusMonths, item.status, date.slice(0, 7)),
    date,
    due_day: Number(item.due_day) || Number(date.slice(8, 10)) || 1,
    installments: String(item.installments || "").trim(),
    is_fixed: item.is_fixed === null || item.is_fixed === undefined || item.is_fixed === "" ? null : Boolean(item.is_fixed),
    installments_start_month: String(item.installments_start_month || date.slice(0, 7)),
  };
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

function getNextMonthKey(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return getCurrentMonthKey();
  const nextDate = new Date(year, month, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDueLabel(dayDiff, dueDate) {
  if (dayDiff < 0) return `atrasada desde ${formatDate(dueDate)}`;
  if (dayDiff === 0) return "vence hoje";
  if (dayDiff === 1) return "vence amanhã";
  return `vence em ${dayDiff} dias`;
}

function getPersonalExpenseStatusForMonth(item, monthKey) {
  const targetMonth = String(monthKey || item.date?.slice(0, 7) || "").trim();
  return getMonthlyStatus(item.status_months, targetMonth, item.status, item.date?.slice(0, 7));
}

function getDaysInMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

function getCurrentMonthWeekRange() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const weekNumber = Math.max(1, Math.ceil(today.getDate() / 7));
  const startDay = ((weekNumber - 1) * 7) + 1;
  const endDay = Math.min(weekNumber * 7, getDaysInMonth(monthKey));
  const startDate = `${monthKey}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${monthKey}-${String(endDay).padStart(2, "0")}`;

  return {
    monthKey,
    startDate,
    endDate,
    label: `${String(startDay).padStart(2, "0")}/${String(month).padStart(2, "0")} a ${String(endDay).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
  };
}

export default function Dashboard() {
  const { records, dashboardMonth } = useOutletContext();
  const [personalExpenses, setPersonalExpenses] = useState([]);
  const [reminderError, setReminderError] = useState("");
  const month = dashboardMonth || getCurrentMonthKey();
  const monthRecords = useMemo(() => filterRecordsByMonth(records, month), [records, month]);
  const summary = useMemo(() => summarizeRecords(monthRecords), [monthRecords]);
  const totalIncome = useMemo(
    () => Object.values(summary.incomeBySource || {}).reduce((sum, value) => sum + Number(value || 0), 0),
    [summary.incomeBySource]
  );
  const totalExpense = useMemo(
    () => Object.values(summary.expenseByType || {}).reduce((sum, value) => sum + Number(value || 0), 0),
    [summary.expenseByType]
  );
  const totalProfit = totalIncome - totalExpense;
  const goalResult = totalIncome;
  const meta = getMonthlyGoalForMonth(month);
  const percentual = meta > 0 ? Math.min(100, Math.round((goalResult / meta) * 100)) : 0;
  const topExpenses = Object.entries(summary.expenseByType).sort((left, right) => right[1] - left[1]).slice(0, 6);
  const summaryCards = [
    { label: "Receitas", value: totalIncome, tone: "card-green", icon: FaCircleArrowUp },
    { label: "Despesas", value: totalExpense, tone: "card-red", icon: FaCircleArrowDown },
    { label: "Saldo do mês", value: totalProfit, tone: "card-blue", icon: FaArrowTrendUp },
  ];
  const dueReminders = useMemo(() => {
    const today = startOfDay(new Date());
    const currentMonth = getCurrentMonthKey();
    const nextMonth = getNextMonthKey(currentMonth);
    const seen = new Set();

    return personalExpenses
      .flatMap((item) => [currentMonth, nextMonth].map((monthKey) => ({ item, monthKey })))
      .filter(({ item, monthKey }) => getPersonalExpenseStatusForMonth(item, monthKey) !== "pago" && isPersonalExpenseVisibleInMonth(item, monthKey))
      .map(({ item, monthKey }) => {
        const dueDate = getPersonalExpenseDateForMonth(item, monthKey);
        const dayDiff = Math.round((startOfDay(`${dueDate}T00:00:00`) - today) / DAY_IN_MS);
        return {
          key: `${item.entry_key || item.id || item.description}-${dueDate}`,
          description: item.description || item.category || "Conta sem descrição",
          amount: item.amount,
          dueDate,
          dayDiff,
        };
      })
      .filter((item) => item.dayDiff >= -REMINDER_WINDOW_DAYS && item.dayDiff <= REMINDER_WINDOW_DAYS)
      .filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      })
      .sort((left, right) => left.dayDiff - right.dayDiff || left.dueDate.localeCompare(right.dueDate))
      .slice(0, 3);
  }, [personalExpenses]);
  const weeklyPaymentReminder = useMemo(() => {
    const weekRange = getCurrentMonthWeekRange();
    const seen = new Set();
    const items = personalExpenses
      .filter((item) => isPersonalExpenseVisibleInMonth(item, weekRange.monthKey))
      .map((item) => {
        const dueDate = getPersonalExpenseDateForMonth(item, weekRange.monthKey);
        return {
          key: `${item.entry_key || item.id || item.description}-${dueDate}`,
          amount: Number(item.amount || 0),
          dueDate,
        };
      })
      .filter((item) => item.dueDate >= weekRange.startDate && item.dueDate <= weekRange.endDate)
      .filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });

    return {
      ...weekRange,
      total: items.reduce((sum, item) => sum + item.amount, 0),
      count: items.length,
    };
  }, [personalExpenses]);
  const hasReminderContent = dueReminders.length || weeklyPaymentReminder.total > 0;
  const reminderCardClassName = `dashboard-reminder-card${!hasReminderContent || reminderError ? " is-empty" : ""}`;

  useEffect(() => {
    let isMounted = true;

    const loadPersonalExpenses = async () => {
      try {
        setReminderError("");
        const payload = await apiFetch("/api/personal-expenses");
        if (!isMounted) return;
        setPersonalExpenses(Array.isArray(payload) ? payload.map(normalizePersonalExpenseItem) : []);
      } catch (error) {
        if (!isMounted) return;
        setPersonalExpenses([]);
        setReminderError(error.message);
      }
    };

    loadPersonalExpenses();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <div className="dashboard-toolbar dashboard-toolbar-center">
        <div className="dashboard-title">
          <h1>Dashboard</h1>
        </div>
      </div>

      <div className={reminderCardClassName} aria-live="polite">
        <div className="dashboard-reminder-icon">{hasReminderContent && !reminderError ? "!" : "i"}</div>
        <div className="dashboard-reminder-content">
          <strong>Lembrete de vencimento</strong>
          {reminderError ? (
            <p>Não foi possível carregar as contas com vencimento próximo.</p>
          ) : hasReminderContent ? (
            <>
              <p className="dashboard-weekly-reminder">
                Semana {weeklyPaymentReminder.label}: <strong>{currency(weeklyPaymentReminder.total)}</strong> em contas da semana
              </p>
              {dueReminders.length ? (
                <ul className="dashboard-reminder-list">
                  {dueReminders.map((item) => (
                    <li key={item.key}>
                      <span>{item.description}</span>
                      {" "}
                      <strong>
                        {getDueLabel(item.dayDiff, item.dueDate)} - {currency(item.amount)}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p>Nenhuma conta pendente vence nos próximos 7 dias.</p>
          )}
        </div>
      </div>

        <div className="summary-grid dashboard-summary-cards">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
            <div key={card.label} className="card" style={summaryCardStyles[card.tone]}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "rgba(255,255,255,0.82)" }}>{card.label}</span>
                  <strong>{currency(card.value)}</strong>
                </div>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 42,
                    height: 42,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.16)",
                    color: "#ffffff",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={20} />
                </span>
              </div>
            </div>
            );
          })}
        </div>

      <div className="dashboard-main-grid">
        <div className="card chart-card">
          <h2>Meta Mensal</h2>
          <div className="goal-box">
            <div className="goal-details">
              <div>
                Meta <strong>{currency(meta)}</strong>
              </div>
              <div>
                Resultado <strong>{currency(goalResult)}</strong> <span>({percentual}%)</span>
              </div>
              <div>
                Restante <strong>{currency(Math.max(meta - goalResult, 0))}</strong> <span>({100 - percentual}%)</span>
              </div>
            </div>

            <div className="goal-chart">
              <div
                aria-label={`Meta concluída em ${percentual}%`}
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  color: "#0f172a",
                  fontSize: "2rem",
                  fontWeight: 700,
                  background: `conic-gradient(#2563eb 0 ${percentual}%, #dbeafe ${percentual}% 100%)`,
                }}
              >
                <div
                  style={{
                    width: 150,
                    height: 150,
                    borderRadius: "50%",
                    background: "#ffffff",
                    display: "grid",
                    placeItems: "center",
                    boxShadow: "inset 0 0 0 1px rgba(148, 163, 184, 0.18)",
                  }}
                >
                  {percentual}%
                </div>
              </div>

              <div className="goal-chart-labels">
                <div className="goal-chart-item">
                  <strong>{percentual}%</strong>
                  <span>Concluído</span>
                </div>
                <div className="goal-chart-item">
                  <strong>{summary.daysWorked}</strong>
                  <span>Dias trabalhados</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card dashboard-kpis-card">
          <h2>Resumo do Mês</h2>
          <div className="small-grid dashboard-kpis-grid">
            {[
              { label: "Uber", value: summary.incomeBySource.Uber || 0, tone: "green" },
              { label: "99", value: summary.incomeBySource["99"] || 0, tone: "green" },
              { label: "InDriver", value: summary.incomeBySource.InDriver || 0, tone: "green" },
              { label: "Km", value: summary.km, tone: "green", formatter: (value) => `${value.toFixed(1)} km` },
              { label: "Horas", value: summary.hours, tone: "green", formatter: (value) => `${value.toFixed(1)} h` },
              { label: "Receita por dia", value: summary.incomePerDay, tone: "green" },
              { label: "Lucro por hora", value: summary.profitPerHour, tone: "green" },
              ...topExpenses.map(([label, value]) => ({ label: getExpenseTypeLabel(label), value, tone: "red" })),
            ].map((item) => (
              <div key={item.label} className={`mini-card ${item.tone}`}>
                <span>{item.label}</span>
                <strong>{item.formatter ? item.formatter(item.value) : currency(item.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

    </>
  );
}
