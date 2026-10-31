import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { currency, filterRecordsByMonth, formatDate, getCurrentMonthKey, getMonthLabel, setMonthlyGoalForMonth } from "./driver-data";
import { PageHeader } from "./Pages";
import { fetchGoalsMonth, goalsRequest, resolveMonthlyGoal } from "./goals-api";
import {
  GOAL_ORIGINS,
  buildAutoDistribution,
  buildGoalRows,
  buildRedistributionPreview,
  getDistributionStatus,
  getPendingDifferences,
} from "./goals-logic";

const fieldStyle = {
  width: "100%",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 12,
  padding: "11px 12px",
  background: "var(--panel)",
  color: "var(--text)",
};

const EMPTY_DAYS = {};

const ORIGIN_LABELS = {
  [GOAL_ORIGINS.manual]: "individual",
  [GOAL_ORIGINS.redistribution]: "redistribuída",
  [GOAL_ORIGINS.automatic]: "automática",
};

const STATUS_LABELS = { dayoff: "Folga", empty: "Não preenchido", hit: "Meta batida", missed: "Meta não batida" };
const STATUS_CLASSES = { dayoff: "is-dayoff", empty: "is-empty", hit: "is-hit", missed: "is-missed" };

function getLocalToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getWeekdayLabel(monthKey, day) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR", { weekday: "short" });
}

const shortDate = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const differenceKey = (month, difference) => `${month}|${difference.day}|${difference.done}|${difference.goal}`;

function GoalDialog({ title, children, footer, onClose, busy, wide }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="password-modal expense-dialog goal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className={`password-card${wide ? " goal-dialog-wide" : ""}`}>
        <div className="password-card-header">
          <h2 id="goal-dialog-title">{title}</h2>
          <button type="button" className="password-close-btn" aria-label="Fechar" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="goal-dialog-body">{children}</div>
        {footer ? <div className="goal-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// Pergunta: deseja redistribuir a diferença do dia?
function DifferencePrompt({ difference, onRedistribute, onKeep, onClose, busy }) {
  const isShort = difference.type === "falta";
  return (
    <GoalDialog
      title={`Diferença no dia ${shortDate(difference.date)}`}
      onClose={onClose}
      busy={busy}
      footer={(
        <div className="expense-dialog-actions">
          <button type="button" className="expense-dialog-action is-primary" onClick={onRedistribute} disabled={busy}>
            <strong>Sim, redistribuir</strong>
            <small>Você escolhe os dias e os valores; nada muda sem confirmação.</small>
          </button>
          <button type="button" className="expense-dialog-action" onClick={onKeep} disabled={busy}>
            <strong>Não, manter as metas atuais</strong>
            <small>Só pergunto de novo se o realizado deste dia mudar.</small>
          </button>
        </div>
      )}
    >
      <p>
        Meta do dia: <strong>{currency(difference.goal)}</strong> · Realizado: <strong>{currency(difference.done)}</strong>
      </p>
      <p className={`goal-difference-pill ${isShort ? "is-short" : "is-extra"}`}>
        {isShort ? "Faltou" : "Excedeu"} {currency(difference.amount)}
      </p>
      <p>
        {isShort
          ? "Deseja acrescentar essa diferença nas metas de dias futuros?"
          : "Deseja usar esse excedente para reduzir metas de dias futuros?"}
      </p>
    </GoalDialog>
  );
}

// Redistribuição manual: o usuário define quanto acrescentar/retirar em cada dia futuro, revisa e confirma.
function RedistributionDialog({ rows, difference, onApply, onClose, busy }) {
  const [adjustments, setAdjustments] = useState({});
  const [step, setStep] = useState("edit");
  const isShort = difference.type === "falta";
  const availableRows = rows.filter((row) => row.isAvailable);
  const preview = useMemo(() => buildRedistributionPreview(rows, difference, adjustments), [rows, difference, adjustments]);
  const errorsByDay = new Map(preview.errors.filter((error) => error.day).map((error) => [error.day, error.message]));
  const generalErrors = preview.errors.filter((error) => !error.day);

  return (
    <GoalDialog
      wide
      title={step === "edit" ? "Redistribuir diferença" : "Confirmar redistribuição"}
      onClose={onClose}
      busy={busy}
      footer={step === "edit" ? (
        <div className="goal-dialog-buttons">
          <button type="button" className="auth-outline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="auth-submit" onClick={() => setStep("review")} disabled={!preview.canApply || busy}>Revisar</button>
        </div>
      ) : (
        <div className="goal-dialog-buttons">
          <button type="button" className="auth-outline-button" onClick={() => setStep("edit")} disabled={busy}>Alterar</button>
          <button type="button" className="auth-submit" onClick={() => onApply(preview)} disabled={busy}>
            {busy ? "Aplicando..." : "Confirmar"}
          </button>
        </div>
      )}
    >
      <div className="goal-redistribution-summary">
        <div><small>{isShort ? "Valor a acrescentar" : "Valor a retirar"}</small><strong>{currency(difference.amount)}</strong></div>
        <div><small>Distribuído</small><strong>{currency(preview.distributed)}</strong></div>
        <div className={preview.remaining === 0 ? "is-done" : ""}><small>Restante</small><strong>{currency(Math.max(preview.remaining, 0))}</strong></div>
      </div>
      <p className="goal-dialog-hint">
        Origem: dia {shortDate(difference.date)} (meta {currency(difference.goal)}, realizado {currency(difference.done)}).
      </p>

      {step === "edit" ? (
        availableRows.length ? (
          <div className="goal-redistribution-table">
            <div className="goal-redistribution-head">
              <small>Dia</small>
              <small>Meta atual</small>
              <small>{isShort ? "Acrescentar" : "Retirar"}</small>
              <small>Nova meta</small>
            </div>
            {availableRows.map((row) => {
              const change = preview.changes.find((item) => item.day === row.day);
              const error = errorsByDay.get(row.day);
              return (
                <div key={row.day} className={`goal-redistribution-row${error ? " has-error" : ""}${change ? " is-changed" : ""}`}>
                  <div><strong>{shortDate(row.date)}</strong> <small>{getWeekdayLabel(row.date.slice(0, 7), row.day)}</small></div>
                  <div>{row.goal === null ? "Sem meta" : currency(row.goal)}</div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label={`${isShort ? "Acrescentar" : "Retirar"} no dia ${shortDate(row.date)}`}
                    style={{ ...fieldStyle, padding: "7px 10px" }}
                    value={adjustments[row.day] ?? ""}
                    onChange={(event) => setAdjustments((current) => ({ ...current, [row.day]: event.target.value }))}
                  />
                  <div className="goal-redistribution-new">{change ? currency(change.to) : "—"}</div>
                  {error ? <small className="goal-redistribution-error">{error}</small> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="goal-dialog-hint">Não há dias futuros disponíveis (sem folga) neste mês.</p>
        )
      ) : (
        <ul className="goal-review-list">
          {preview.changes.map((change) => (
            <li key={change.day}>
              <strong>{shortDate(change.date)}</strong>: de {currency(change.from)} para <strong>{currency(change.to)}</strong>
            </li>
          ))}
          <li className="goal-review-remaining">Valor restante: <strong>{currency(preview.remaining)}</strong></li>
          {preview.remaining > 0 ? (
            <li className="goal-review-warning">{currency(preview.remaining)} não serão redistribuídos e a diferença deste dia será considerada tratada.</li>
          ) : null}
        </ul>
      )}
      {generalErrors.map((error) => <p key={error.message} className="goal-redistribution-error">{error.message}</p>)}
    </GoalDialog>
  );
}

// "Voltar ao automático": prévia da divisão igual do que falta entre os dias futuros sem folga.
function AutoDistributionDialog({ rows, monthlyGoal, onApply, onClose, busy }) {
  const [overwriteProtected, setOverwriteProtected] = useState(false);
  const plan = useMemo(() => buildAutoDistribution(rows, monthlyGoal, { overwriteProtected }), [rows, monthlyGoal, overwriteProtected]);

  return (
    <GoalDialog
      wide
      title="Voltar ao automático"
      onClose={onClose}
      busy={busy}
      footer={(
        <div className="goal-dialog-buttons">
          <button type="button" className="auth-outline-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="auth-submit" onClick={() => onApply(plan, overwriteProtected)} disabled={busy || !plan.assignments.length}>
            {busy ? "Aplicando..." : "Confirmar distribuição"}
          </button>
        </div>
      )}
    >
      <p className="goal-dialog-hint">
        Falta {currency(plan.remaining)} da meta mensal ({currency(monthlyGoal)} − {currency(plan.realized)} já realizados
        {plan.keptDays.length ? " − metas mantidas" : ""}), divididos igualmente entre os dias futuros sem folga.
        Dias passados não são alterados.
      </p>

      {plan.protectedDays.length ? (
        <div className="goal-protected-box">
          <strong>Estes dias têm meta individual ou redistribuída:</strong>
          <ul>
            {plan.protectedDays.map((item) => (
              <li key={item.day}>{shortDate(item.date)} — {currency(item.goal)} ({ORIGIN_LABELS[item.origin] || "individual"})</li>
            ))}
          </ul>
          <label className="goal-protected-check">
            <input type="checkbox" checked={overwriteProtected} onChange={(event) => setOverwriteProtected(event.target.checked)} />
            Também substituir estes dias pela divisão automática
          </label>
        </div>
      ) : null}

      {plan.assignments.length ? (
        <ul className="goal-review-list goal-review-columns">
          {plan.assignments.map((item) => (
            <li key={item.day}>
              <strong>{shortDate(item.date)}</strong>: {item.from === null ? "sem meta" : currency(item.from)} → <strong>{currency(item.to)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="goal-dialog-hint">Não há dias futuros disponíveis para distribuir neste mês.</p>
      )}
    </GoalDialog>
  );
}

export function SummaryPage() {
  const { records, summaryMonth } = useOutletContext();
  const month = summaryMonth || getCurrentMonthKey();
  const [payload, setPayload] = useState({ month: "", days: EMPTY_DAYS, monthly: null });
  const [isLoading, setIsLoading] = useState(true);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalMessage, setGoalMessage] = useState("");
  const [dailyGoalsError, setDailyGoalsError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [savingDay, setSavingDay] = useState("");
  const [editingGoalDay, setEditingGoalDay] = useState("");
  const [dayGoalDraft, setDayGoalDraft] = useState("");
  const [dialog, setDialog] = useState(null); // { type: "prompt" | "redistribute" | "auto", difference? }
  const [dismissed, setDismissed] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const today = getLocalToday();

  const monthRecords = useMemo(() => filterRecordsByMonth(records, month), [records, month]);
  const doneByDay = useMemo(() => monthRecords.reduce((accumulator, record) => {
    const day = Number(String(record.date || "").slice(8, 10));
    if (day) accumulator[String(day)] = (accumulator[String(day)] || 0) + Number(record.incomeValue || 0);
    return accumulator;
  }, {}), [monthRecords]);

  const isCurrentPayload = payload.month === month;
  const monthlyGoal = resolveMonthlyGoal(isCurrentPayload ? payload : null);
  const days = isCurrentPayload && payload.days ? payload.days : EMPTY_DAYS;
  const rows = useMemo(() => buildGoalRows({ month, today, days, doneByDay }), [month, today, days, doneByDay]);
  const distribution = useMemo(() => getDistributionStatus(rows, monthlyGoal), [rows, monthlyGoal]);
  // Todas as diferenças pendentes ficam no aviso; a pergunta automática não reabre as que o usuário fechou nesta sessão.
  const pending = useMemo(() => getPendingDifferences(rows), [rows]);
  const pendingToAsk = useMemo(() => pending.filter((item) => !dismissed.has(differenceKey(month, item))), [pending, dismissed, month]);

  const applyPayload = useCallback((next) => {
    setPayload({ ...next, month: next.month || month, days: next.days || EMPTY_DAYS });
    setGoalDraft(String(resolveMonthlyGoal(next)));
  }, [month]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setDailyGoalsError("");
    setGoalMessage("");
    setInfoMessage("");
    setDialog(null);
    fetchGoalsMonth(month)
      .then((next) => {
        if (isMounted) applyPayload(next);
      })
      .catch((error) => {
        if (isMounted) setDailyGoalsError(error.message || "Não foi possível carregar as metas.");
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [month, applyPayload]);

  // Pergunta automaticamente sobre a primeira diferença ainda não tratada.
  useEffect(() => {
    if (isLoading || !isCurrentPayload || dialog || !pendingToAsk.length) return;
    setDialog({ type: "prompt", difference: pendingToAsk[0] });
  }, [isLoading, isCurrentPayload, dialog, pendingToAsk]);

  const run = async (request, successText) => {
    setBusy(true);
    setDailyGoalsError("");
    setInfoMessage("");
    try {
      const next = await request();
      if (next) applyPayload(next);
      if (successText) setInfoMessage(successText);
      return true;
    } catch (error) {
      setDailyGoalsError(error.message || "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const dismissDifference = (difference) => {
    setDismissed((current) => new Set(current).add(differenceKey(month, difference)));
    setDialog(null);
  };

  const saveDay = async (row, values) => {
    setSavingDay(String(row.day));
    await run(() => goalsRequest(month, `/${row.day}`, values, "PUT"));
    setSavingDay("");
  };

  const toggleDayOff = (row) => saveDay(row, { goal: row.goal, dayOff: !row.dayOff });

  const startEditingDayGoal = (row) => {
    setEditingGoalDay(String(row.day));
    setDayGoalDraft(row.goal === null ? "" : String(row.goal));
  };

  const saveDayGoal = async (event, row) => {
    event.preventDefault();
    const nextGoal = Number(dayGoalDraft);
    if (dayGoalDraft === "" || !Number.isFinite(nextGoal) || nextGoal < 0) {
      setDailyGoalsError("Informe uma meta do dia igual ou maior que zero.");
      return;
    }
    setEditingGoalDay("");
    await saveDay(row, { goal: nextGoal, dayOff: row.dayOff, origin: GOAL_ORIGINS.manual });
  };

  const saveMonthlyGoal = async (event) => {
    event.preventDefault();
    setGoalMessage("");
    const nextGoal = Number(goalDraft);
    if (!Number.isFinite(nextGoal) || nextGoal <= 0) {
      setGoalMessage("Informe uma meta mensal maior que zero.");
      return;
    }
    const ok = await run(() => goalsRequest(month, "/monthly", { goal: nextGoal }, "PUT"));
    if (ok) {
      setMonthlyGoalForMonth(month, nextGoal);
      setGoalMessage("Meta mensal salva.");
    }
  };

  const confirmDistribution = () => run(() => goalsRequest(month, "/confirm"), "Distribuição confirmada.");

  const applyRedistribution = async (difference, preview) => {
    const ok = await run(() => goalsRequest(month, "/redistribute", {
      source_day: difference.day,
      allocations: preview.changes.map((change) => ({ day: change.day, amount: Math.abs(change.delta) })),
      expected_goals: Object.fromEntries(preview.changes.map((change) => [change.day, rows.find((row) => row.day === change.day)?.goal ?? null])),
    }), "Redistribuição aplicada.");
    if (ok) setDialog(null);
  };

  const keepGoals = async (difference) => {
    const ok = await run(() => goalsRequest(month, "/settle", { day: difference.day }), "Metas mantidas.");
    if (ok) setDialog(null);
  };

  const applyAuto = async (plan, overwriteProtected) => {
    const ok = await run(() => goalsRequest(month, "/auto", {
      assignments: plan.assignments.map((item) => ({ day: item.day, goal: item.to })),
      expected_goals: Object.fromEntries(plan.assignments.map((item) => [item.day, item.from])),
      overwrite_protected: overwriteProtected,
    }), "Distribuição automática aplicada.");
    if (ok) setDialog(null);
  };

  const confirmedAt = isCurrentPayload ? payload.monthly?.confirmedAt : null;

  return (
    <>
      <PageHeader title="Metas" centered />
      <form className="card" onSubmit={saveMonthlyGoal}>
        <h2>Ajustar meta</h2>
        <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.95rem" }}>
          Meta mensal de {getMonthLabel(month)}: <strong style={{ color: "var(--text)" }}>{currency(monthlyGoal)}</strong>
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
        <button type="submit" className="auth-submit auth-submit-blue" style={{ marginTop: 12, width: "auto", minWidth: 150 }} disabled={busy}>
          Salvar meta
        </button>
        {goalMessage ? (
          <p style={{ margin: "10px 0 0", color: goalMessage.includes("salva") ? "var(--green-soft)" : "var(--red-soft)", fontWeight: 700 }}>
            {goalMessage}
          </p>
        ) : null}
      </form>
      <div className="card">
        <h2>Meta diária</h2>
        <div className={`goal-distribution-status${distribution.canConfirm ? " is-ok" : " is-short"}`} aria-live="polite">
          <div className="goal-distribution-text">
            <strong>Distribuído {currency(distribution.distributed)} de {currency(distribution.monthlyGoal)}</strong>
            <small>
              {distribution.canConfirm
                ? (confirmedAt ? `Distribuição confirmada em ${formatDate(String(confirmedAt).slice(0, 10))}.` : "A meta mensal está coberta. Confirme a distribuição.")
                : `Faltam ${currency(distribution.missing)} para distribuir.`}
            </small>
          </div>
          <div className="goal-distribution-actions">
            {pending.length ? (
              <button type="button" className="logout-btn" onClick={() => setDialog({ type: "prompt", difference: pending[0] })}>
                {pending.length} diferença{pending.length > 1 ? "s" : ""} aguardando
              </button>
            ) : null}
            <button
              type="button"
              className="password-btn"
              onClick={confirmDistribution}
              disabled={!distribution.canConfirm || busy}
              title={distribution.canConfirm ? undefined : `Faltam ${currency(distribution.missing)} para distribuir`}
            >
              Confirmar distribuição
            </button>
          </div>
        </div>
        {dailyGoalsError ? (
          <p style={{ marginTop: 0, color: "var(--red-soft)", fontWeight: 700 }}>
            {dailyGoalsError}
          </p>
        ) : null}
        {infoMessage && !dailyGoalsError ? (
          <p style={{ marginTop: 0, color: "var(--green-soft)", fontWeight: 700 }}>{infoMessage}</p>
        ) : null}
        <div className="summary-goals-grid">
          {rows.map((row) => {
            const isSaving = savingDay === String(row.day);
            const originLabel = row.goal !== null && !row.dayOff ? ORIGIN_LABELS[row.origin] : "";
            return (
              <div key={`${month}-${row.day}`} className={`summary-goal-card ${STATUS_CLASSES[row.status]}`}>
                <div className="summary-goal-card-header">
                  <div>
                    <strong>{String(row.day).padStart(2, "0")}</strong>
                    <span>{getWeekdayLabel(month, row.day)}</span>
                  </div>
                  <span className="summary-goal-status">{STATUS_LABELS[row.status]}</span>
                </div>

                <div className="summary-goal-card-values">
                  <div>
                    <span>{originLabel ? `Meta do dia (${originLabel})` : "Meta do dia"}</span>
                    <strong>{row.dayOff ? "Folga" : row.goal === null ? "Sem meta" : currency(row.goal)}</strong>
                  </div>
                  <div>
                    <span>Fiz</span>
                    <strong>{currency(row.done)}</strong>
                  </div>
                </div>

                {editingGoalDay === String(row.day) ? (
                  <form onSubmit={(event) => saveDayGoal(event, row)} style={{ display: "grid", gap: 8 }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      aria-label={`Meta do dia ${row.day}`}
                      style={fieldStyle}
                      value={dayGoalDraft}
                      onChange={(event) => setDayGoalDraft(event.target.value)}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="submit" className="password-btn" style={{ flex: 1 }}>Salvar</button>
                      <button type="button" className="logout-btn" style={{ flex: 1 }} onClick={() => setEditingGoalDay("")}>Cancelar</button>
                    </div>
                  </form>
                ) : !row.dayOff ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="password-btn"
                      style={{ flex: 1 }}
                      disabled={isSaving || busy || row.isPast}
                      title={row.isPast ? "Metas de dias passados não podem ser alteradas." : undefined}
                      onClick={() => startEditingDayGoal(row)}
                    >
                      Alterar meta
                    </button>
                    {row.isAvailable ? (
                      <button
                        type="button"
                        className="logout-btn"
                        style={{ flex: 1 }}
                        disabled={isSaving || busy}
                        title="Mostra uma prévia da divisão automática do que falta entre os dias futuros sem folga"
                        onClick={() => setDialog({ type: "auto" })}
                      >
                        Voltar ao automático
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="button"
                  className={row.dayOff ? "logout-btn" : "password-btn"}
                  disabled={isSaving || busy}
                  onClick={() => toggleDayOff(row)}
                >
                  {isSaving ? "Salvando..." : row.dayOff ? "Remover folga" : "Marcar folga"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {dialog?.type === "prompt" ? (
        <DifferencePrompt
          difference={dialog.difference}
          busy={busy}
          onRedistribute={() => setDialog({ type: "redistribute", difference: dialog.difference })}
          onKeep={() => keepGoals(dialog.difference)}
          onClose={() => dismissDifference(dialog.difference)}
        />
      ) : null}
      {dialog?.type === "redistribute" ? (
        <RedistributionDialog
          rows={rows}
          difference={dialog.difference}
          busy={busy}
          onApply={(preview) => applyRedistribution(dialog.difference, preview)}
          onClose={() => dismissDifference(dialog.difference)}
        />
      ) : null}
      {dialog?.type === "auto" ? (
        <AutoDistributionDialog
          rows={rows}
          monthlyGoal={monthlyGoal}
          busy={busy}
          onApply={applyAuto}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
