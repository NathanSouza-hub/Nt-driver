import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { FaArrowTrendUp, FaCircleArrowDown, FaCircleArrowUp } from "react-icons/fa6";
import { currency, filterRecordsByMonth, formatDate, getCurrentMonthKey, getMonthlyGoalForMonth, summarizeRecords } from "./driver-data";
import { fetchGoalsMonth, resolveMonthlyGoal } from "./goals-api";
import { apiFetch } from "./http";
import { getPersonalExpenseCategoryLabel } from "./Pages";
import SummaryCards from "./SummaryCards";
import SalaryTab from "./SalaryTab";
import TikTokTab from "./TikTokTab";
import { getSalaryTotalForMonth, getTikTokSalesTotal, roundMoney, shiftMonth, sumAmounts } from "./finance-areas";
import { fetchExpenseMonth, useExpenseMonth } from "./expenses-shared";

const DASHBOARD_TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "uber", label: "Uber" },
  { key: "salario", label: "Salário" },
  { key: "tiktok", label: "TikTok" },
];

const REMINDER_WINDOW_DAYS = 7;
const DAY_IN_MS = 86400000;
const EMPTY_TIKTOK_DATA = { month: "", sellers: [], archivedSellers: [], sales: [], expenses: [] };

function getExpenseTypeLabel(label) {
  const labels = {
    combustivel: "Combustível",
    "alimentacao na rua": "Alimentação na rua",
    "troca de oleo": "Troca de óleo",
  };
  return labels[String(label || "").toLowerCase()] || label || "Outros";
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

function DashboardTabs({ activeTab, onChange }) {
  return (
    <div className="page-tabs dashboard-area-tabs" role="tablist" aria-label="Áreas do dashboard">
      {DASHBOARD_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`dashboard-tab-${tab.key}`}
          aria-selected={activeTab === tab.key}
          aria-controls={`dashboard-panel-${tab.key}`}
          className={`page-tab${activeTab === tab.key ? " active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function MiniCardsGrid({ items }) {
  return (
    <div className="small-grid dashboard-kpis-grid">
      {items.map((item) => (
        <div key={item.label} className={`mini-card ${item.tone}`}>
          <span>{item.label}</span>
          <strong>{item.formatter ? item.formatter(item.value) : currency(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function DueReminderCard({ reminderItems, reminderError }) {
  const dueReminders = useMemo(() => {
    const today = startOfDay(new Date());
    return reminderItems
      .filter((item) => item.status !== "pago")
      .map((item) => ({
        key: item.key,
        description: item.description || item.category || "Conta sem descrição",
        amount: item.amount,
        dueDate: item.due_date,
        dayDiff: Math.round((startOfDay(`${item.due_date}T00:00:00`) - today) / DAY_IN_MS),
      }))
      .filter((item) => item.dayDiff >= -REMINDER_WINDOW_DAYS && item.dayDiff <= REMINDER_WINDOW_DAYS)
      .sort((left, right) => left.dayDiff - right.dayDiff || left.dueDate.localeCompare(right.dueDate))
      .slice(0, 3);
  }, [reminderItems]);

  const weeklyPaymentReminder = useMemo(() => {
    const weekRange = getCurrentMonthWeekRange();
    const items = reminderItems.filter((item) => item.due_date >= weekRange.startDate && item.due_date <= weekRange.endDate);
    return { ...weekRange, total: items.reduce((sum, item) => sum + item.amount, 0), count: items.length };
  }, [reminderItems]);

  const hasReminderContent = dueReminders.length || weeklyPaymentReminder.total > 0;
  const reminderCardClassName = `dashboard-reminder-card${!hasReminderContent || reminderError ? " is-empty" : ""}`;

  return (
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
  );
}

// Aba Dashboard: visão geral. Receitas = Uber + Salário + TikTok. Despesas = somente a página geral de Despesas.
function OverviewTab({ reminderItems, reminderError, uberIncome, salaryIncome, tiktokIncome, generalExpenseRows, sourceWarning }) {
  const totalIncome = roundMoney(uberIncome + salaryIncome + tiktokIncome);
  const totalExpense = sumAmounts(generalExpenseRows);
  const balance = roundMoney(totalIncome - totalExpense);
  const expenseByCategory = useMemo(() => {
    const grouped = generalExpenseRows.reduce((accumulator, item) => {
      const key = item.category || "Outros";
      accumulator[key] = (accumulator[key] || 0) + Number(item.amount || 0);
      return accumulator;
    }, {});
    return Object.entries(grouped).sort((left, right) => right[1] - left[1]).slice(0, 6);
  }, [generalExpenseRows]);

  const cards = [
    { label: "Receitas", value: totalIncome, tone: "card-green", icon: FaCircleArrowUp },
    { label: "Despesas", value: totalExpense, tone: "card-red", icon: FaCircleArrowDown },
    { label: "Saldo do mês", value: balance, tone: "card-blue", icon: FaArrowTrendUp },
  ];

  const summaryItems = [
    { label: "Receitas Uber", value: uberIncome, tone: "green" },
    { label: "Receitas Salário", value: salaryIncome, tone: "green" },
    { label: "Receitas TikTok", value: tiktokIncome, tone: "green" },
    ...expenseByCategory.map(([label, value]) => ({ label: getPersonalExpenseCategoryLabel(label), value, tone: "red" })),
  ];

  return (
    <>
      <DueReminderCard reminderItems={reminderItems} reminderError={reminderError} />
      <SummaryCards cards={cards} />
      {sourceWarning ? <p className="dashboard-source-warning" role="status">{sourceWarning}</p> : null}
      <div className="dashboard-main-grid">
        <div className="card dashboard-kpis-card">
          <h2>Resumo do Mês</h2>
          <MiniCardsGrid items={summaryItems} />
          {!expenseByCategory.length ? (
            <p style={{ margin: 0, color: "var(--muted)" }}>Nenhuma despesa geral cadastrada neste mês.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}

// Aba Uber: somente os registros diários do motorista (ganhos e despesas da atividade).
function UberTab({ monthRecords, month }) {
  const summary = useMemo(() => summarizeRecords(monthRecords), [monthRecords]);
  const totalIncome = roundMoney(summary.income);
  const totalExpense = roundMoney(summary.expense);
  // Meta mensal salva no banco (a mesma da página Metas); enquanto carrega, usa o valor local.
  const [meta, setMeta] = useState(() => getMonthlyGoalForMonth(month));
  useEffect(() => {
    let isMounted = true;
    setMeta(getMonthlyGoalForMonth(month));
    fetchGoalsMonth(month)
      .then((payload) => {
        if (isMounted) setMeta(resolveMonthlyGoal(payload));
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [month]);
  const percentual = meta > 0 ? Math.min(100, Math.round((totalIncome / meta) * 100)) : 0;
  const topExpenses = Object.entries(summary.expenseByType).filter(([, value]) => value > 0).sort((left, right) => right[1] - left[1]).slice(0, 6);
  const cards = [
    { label: "Receitas", value: totalIncome, tone: "card-green", icon: FaCircleArrowUp },
    { label: "Despesas", value: totalExpense, tone: "card-red", icon: FaCircleArrowDown },
    { label: "Saldo do mês", value: roundMoney(totalIncome - totalExpense), tone: "card-blue", icon: FaArrowTrendUp },
  ];

  return (
    <>
      <SummaryCards cards={cards} />

      <div className="dashboard-main-grid">
        <div className="card chart-card">
          <h2>Meta Mensal</h2>
          <div className="goal-box">
            <div className="goal-details">
              <div>
                Meta <strong>{currency(meta)}</strong>
              </div>
              <div>
                Resultado <strong>{currency(totalIncome)}</strong> <span>({percentual}%)</span>
              </div>
              <div>
                Restante <strong>{currency(Math.max(meta - totalIncome, 0))}</strong> <span>({100 - percentual}%)</span>
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
                  color: "var(--text)",
                  fontSize: "2rem",
                  fontWeight: 700,
                  background: `conic-gradient(#3b82f6 0 ${percentual}%, var(--panel-soft) ${percentual}% 100%)`,
                }}
              >
                <div
                  style={{
                    width: 150,
                    height: 150,
                    borderRadius: "50%",
                    background: "var(--panel)",
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
          <h2>Desempenho Uber</h2>
          <MiniCardsGrid
            items={[
              { label: "Uber", value: summary.incomeBySource.Uber || 0, tone: "green" },
              { label: "99", value: summary.incomeBySource["99"] || 0, tone: "green" },
              { label: "InDriver", value: summary.incomeBySource.InDriver || 0, tone: "green" },
              { label: "Outros", value: summary.incomeBySource.Outros || 0, tone: "green" },
              { label: "Km", value: summary.km, tone: "green", formatter: (value) => `${value.toFixed(1)} km` },
              { label: "Horas", value: summary.hours, tone: "green", formatter: (value) => `${value.toFixed(1)} h` },
              { label: "Receita por dia", value: summary.incomePerDay, tone: "green" },
              { label: "Lucro por hora", value: summary.profitPerHour, tone: "green" },
              ...topExpenses.map(([label, value]) => ({ label: getExpenseTypeLabel(label), value, tone: "red" })),
            ]}
          />
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { records, dashboardMonth, setDashboardMonth } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("aba");
  const activeTab = DASHBOARD_TABS.some((tab) => tab.key === requestedTab) ? requestedTab : "dashboard";
  const month = dashboardMonth || getCurrentMonthKey();

  const [reminderItems, setReminderItems] = useState([]);
  const [reminderError, setReminderError] = useState("");
  // Despesas gerais do mês: somente a página de Despesas (competência correta, edições e congelamentos).
  const generalExpenses = useExpenseMonth(month);
  const [salaryReceipts, setSalaryReceipts] = useState([]);
  const [salaryState, setSalaryState] = useState({ loading: true, error: "" });
  const [tiktokData, setTiktokData] = useState(EMPTY_TIKTOK_DATA);
  const [tiktokState, setTiktokState] = useState({ loading: true, error: "" });

  const monthRecords = useMemo(() => filterRecordsByMonth(records, month), [records, month]);
  const uberIncome = useMemo(() => roundMoney(summarizeRecords(monthRecords).income), [monthRecords]);
  const salaryIncome = useMemo(() => getSalaryTotalForMonth(salaryReceipts, month), [salaryReceipts, month]);
  const tiktokIncome = useMemo(
    () => (tiktokData.month === month ? getTikTokSalesTotal(tiktokData.sales, month) : 0),
    [tiktokData, month]
  );
  const generalExpenseRows = generalExpenses.items;

  const changeTab = (tabKey) => {
    const next = new URLSearchParams(searchParams);
    if (tabKey === "dashboard") next.delete("aba");
    else next.set("aba", tabKey);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let isMounted = true;
    const loadSharedSources = async () => {
      const currentMonth = getCurrentMonthKey();
      const [currentResult, nextResult, salaryResult] = await Promise.allSettled([
        fetchExpenseMonth(currentMonth),
        fetchExpenseMonth(shiftMonth(currentMonth, 1)),
        apiFetch("/api/salary"),
      ]);
      if (!isMounted) return;

      if (currentResult.status === "fulfilled" && nextResult.status === "fulfilled") {
        setReminderError("");
        setReminderItems([...(currentResult.value.items || []), ...(nextResult.value.items || [])]);
      } else {
        setReminderItems([]);
        setReminderError((currentResult.reason || nextResult.reason)?.message || "Falha ao carregar despesas.");
      }

      if (salaryResult.status === "fulfilled") {
        setSalaryReceipts(Array.isArray(salaryResult.value) ? salaryResult.value : []);
        setSalaryState({ loading: false, error: "" });
      } else {
        setSalaryState({ loading: false, error: salaryResult.reason?.message || "Falha ao carregar recebimentos." });
      }
    };

    loadSharedSources();
    return () => {
      isMounted = false;
    };
  }, []);

  const latestTikTokMonthRef = useRef(month);
  const loadTikTokMonth = useCallback(async (targetMonth) => {
    latestTikTokMonthRef.current = targetMonth;
    setTiktokState({ loading: true, error: "" });
    try {
      const payload = await apiFetch(`/api/tiktok/month/${encodeURIComponent(targetMonth)}`);
      // Ignora respostas de meses que já não estão selecionados (troca rápida de mês).
      if (latestTikTokMonthRef.current !== targetMonth) return;
      setTiktokData({ ...EMPTY_TIKTOK_DATA, ...payload, month: targetMonth });
      setTiktokState({ loading: false, error: "" });
    } catch (error) {
      if (latestTikTokMonthRef.current !== targetMonth) return;
      setTiktokState({ loading: false, error: error.message });
    }
  }, []);

  useEffect(() => {
    loadTikTokMonth(month);
  }, [month, loadTikTokMonth]);

  const failedSources = [generalExpenses.error ? "Despesas" : "", salaryState.error ? "Salário" : "", tiktokState.error ? "TikTok" : ""].filter(Boolean);

  return (
    <>
      <div className="dashboard-toolbar dashboard-toolbar-center">
        <div className="dashboard-title">
          <h1>{DASHBOARD_TABS.find((tab) => tab.key === activeTab)?.label || "Dashboard"}</h1>
        </div>
      </div>

      <DashboardTabs activeTab={activeTab} onChange={changeTab} />

      <section id={`dashboard-panel-${activeTab}`} role="tabpanel" aria-labelledby={`dashboard-tab-${activeTab}`} className="dashboard-area-panel">
        {activeTab === "dashboard" ? (
          <OverviewTab
            reminderItems={reminderItems}
            reminderError={reminderError}
            uberIncome={uberIncome}
            salaryIncome={salaryIncome}
            tiktokIncome={tiktokIncome}
            generalExpenseRows={generalExpenseRows}
            sourceWarning={failedSources.length ? `Não foi possível carregar: ${failedSources.join(", ")}. Os totais podem estar incompletos.` : ""}
          />
        ) : null}

        {activeTab === "uber" ? <UberTab monthRecords={monthRecords} month={month} /> : null}

        {activeTab === "salario" ? (
          <SalaryTab
            month={month}
            receipts={salaryReceipts}
            setReceipts={setSalaryReceipts}
            isLoading={salaryState.loading}
            loadError={salaryState.error}
          />
        ) : null}

        {activeTab === "tiktok" ? (
          <TikTokTab
            month={month}
            onMonthChange={setDashboardMonth}
            data={tiktokData.month === month ? tiktokData : { ...EMPTY_TIKTOK_DATA, month }}
            setData={setTiktokData}
            isLoading={tiktokState.loading}
            loadError={tiktokState.error}
            onReload={() => loadTikTokMonth(month)}
          />
        ) : null}
      </section>
    </>
  );
}
