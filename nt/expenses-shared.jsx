import React, { useCallback, useEffect, useRef, useState } from "react";
import { currency, formatDate } from "./driver-data";
import { apiFetch } from "./http";

// Peças compartilhadas do módulo de Despesas (página de Despesas, Dashboard e telas do perfil Pessoal).
// A fonte única das despesas de um mês é GET /api/expenses/month/:mes (calculada no servidor).

export const DEFAULT_CATEGORY_LABELS = {
  Alimentacao: "Alimentação",
  Servicos: "Serviços",
  Emprestimo: "Empréstimo",
  Dividas: "Dívidas",
  "Renegociacao de dividas": "Renegociação de dívidas",
  Educacao: "Educação",
  Saude: "Saúde",
};

export const RECURRENCE_OPTIONS = [
  { value: "unica", label: "Única" },
  { value: "mensal", label: "Mensal" },
  { value: "anual", label: "Anual" },
  { value: "parcelada", label: "Parcelada" },
];

export const getCategoryLabel = (value) => DEFAULT_CATEGORY_LABELS[value] || value || "Outros";
export const getRecurrenceLabel = (value) => RECURRENCE_OPTIONS.find((item) => item.value === value)?.label || "Única";

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const getShortMonthLabel = (monthKey) => {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  return month ? `${MONTH_SHORT[month - 1]}/${String(year).slice(2)}` : "";
};

export const getTodayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const isOverdue = (item) => item.status !== "pago" && item.due_date < getTodayKey();

export const fetchExpenseMonth = (month) => apiFetch(`/api/expenses/month/${encodeURIComponent(month)}`);

// Carrega as ocorrências de despesa da competência informada (com proteção contra respostas fora de ordem).
export function useExpenseMonth(month) {
  const [state, setState] = useState({ month: "", items: [], summary: { total: 0, paid: 0, pending: 0, count: 0 }, isLoading: true, error: "" });
  const latestRef = useRef(month);

  const reload = useCallback(async () => {
    latestRef.current = month;
    setState((current) => ({ ...current, isLoading: true, error: "" }));
    try {
      const payload = await fetchExpenseMonth(month);
      if (latestRef.current !== month) return;
      setState({ month, items: payload.items || [], summary: payload.summary || {}, isLoading: false, error: "" });
    } catch (error) {
      if (latestRef.current !== month) return;
      setState((current) => ({ ...current, isLoading: false, error: error.message }));
    }
  }, [month]);

  useEffect(() => {
    reload();
  }, [reload]);

  const items = state.month === month ? state.items : [];
  return { ...state, items, reload };
}

export function ConfirmDialog({ title, message, actions, onClose, busy }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="password-modal expense-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="password-card">
        <div className="password-card-header">
          <h2 id="expense-dialog-title">{title}</h2>
          <button type="button" className="password-close-btn" aria-label="Fechar" onClick={onClose} disabled={busy}>×</button>
        </div>
        {message ? <div className="expense-dialog-message">{message}</div> : null}
        <div className="expense-dialog-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`expense-dialog-action${action.tone ? ` is-${action.tone}` : ""}`}
              onClick={action.onClick}
              disabled={busy}
            >
              <strong>{action.label}</strong>
              {action.description ? <small>{action.description}</small> : null}
            </button>
          ))}
          <button type="button" className="auth-outline-button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function getStatusPill(item) {
  if (item.status === "pago") return { className: "paid", label: "Pago" };
  if (isOverdue(item)) return { className: "overdue", label: "Atrasada" };
  return { className: "pending", label: "A pagar" };
}

// Lista compacta de lançamentos. As ações são opcionais (o Dashboard pessoal usa apenas situação e edição).
export function ExpenseCompactList({ items, onToggleStatus, onEdit, onFreeze, onDelete, busyKey, emptyText = "Nenhuma despesa neste mês." }) {
  if (!items.length) return <p className="expense-list-empty">{emptyText}</p>;

  return (
    <ul className="expense-list" aria-label="Lançamentos de despesas">
      {items.map((item) => {
        const pill = getStatusPill(item);
        const frozenFrom = (item.transfer_history || []).filter((entry) => entry.type === "congelado").map((entry) => entry.from_month);
        const isBusy = busyKey === item.key;
        return (
          <li key={item.key} className={`expense-row${item.status === "pago" ? " is-paid" : ""}${isBusy ? " is-busy" : ""}`}>
            <div className="expense-row-date" title={formatDate(item.due_date)}>
              <strong>{item.due_date.slice(8, 10)}</strong>
              <small>{getShortMonthLabel(item.due_date.slice(0, 7))}</small>
            </div>
            <div className="expense-row-main">
              <strong className="expense-row-title">{item.description}</strong>
              <div className="expense-row-meta">
                <small>{getCategoryLabel(item.category)}</small>
                {item.recurrence !== "unica" ? (
                  <small className="expense-tag">
                    {item.recurrence === "parcelada" && item.installment_label ? `Parcela ${item.installment_label}` : getRecurrenceLabel(item.recurrence)}
                  </small>
                ) : null}
                {frozenFrom.length ? (
                  <small className="expense-tag is-frozen" title={`Congelada: ${frozenFrom.map(getShortMonthLabel).join(" → ")} → ${getShortMonthLabel(item.competence_month)}`}>
                    🧊 de {getShortMonthLabel(frozenFrom[0])}
                  </small>
                ) : null}
                {item.notes ? <small className="expense-row-notes" title={item.notes}>{item.notes}</small> : null}
              </div>
            </div>
            <strong className="expense-row-amount">{currency(item.amount)}</strong>
            <small className={`status-pill ${pill.className}`}>{pill.label}</small>
            <div className="expense-row-actions">
              {onToggleStatus ? (
                <button
                  type="button"
                  className="password-btn icon-action-btn"
                  onClick={() => onToggleStatus(item)}
                  disabled={isBusy}
                  title={item.status === "pago" ? "Marcar como a pagar" : "Marcar como pago"}
                  aria-label={item.status === "pago" ? `Marcar ${item.description} como a pagar` : `Marcar ${item.description} como pago`}
                >
                  {item.status === "pago" ? "↩️" : "✅"}
                </button>
              ) : null}
              {onEdit ? (
                <button type="button" className="password-btn icon-action-btn" onClick={() => onEdit(item)} disabled={isBusy} title="Editar este lançamento" aria-label={`Editar ${item.description}`}>
                  ✏️
                </button>
              ) : null}
              {onFreeze && item.status !== "pago" ? (
                <button type="button" className="password-btn icon-action-btn" onClick={() => onFreeze(item)} disabled={isBusy} title="Congelar: transferir para o próximo mês" aria-label={`Congelar ${item.description}`}>
                  🧊
                </button>
              ) : null}
              {onDelete ? (
                <button type="button" className="logout-btn icon-action-btn" onClick={() => onDelete(item)} disabled={isBusy} title="Excluir" aria-label={`Excluir ${item.description}`}>
                  🗑️
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
