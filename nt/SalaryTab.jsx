import React, { useEffect, useMemo, useState } from "react";
import { FaCircleArrowUp } from "react-icons/fa6";
import { currency, formatDate, getMonthLabel } from "./driver-data";
import { apiFetch } from "./http";
import SummaryCards from "./SummaryCards";
import {
  SALARY_RECEIPT_TYPES,
  SALARY_RECURRENCES,
  getSalaryReceiptsForMonth,
  getSalaryTotalsByType,
  getSalaryTypeLabel,
  normalizeSalaryReceipt,
  shiftMonth,
  sumAmounts,
} from "./finance-areas";

export const areaFieldStyle = {
  width: "100%",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 12,
  padding: "11px 12px",
  background: "var(--panel)",
  color: "var(--text)",
};

const SALARY_SUBTABS = [
  { key: "lancamentos", label: "Lançamentos" },
  { key: "resumo", label: "Resumo" },
  { key: "historico", label: "Histórico" },
];

const CHART_COLORS = ["#16a34a", "#2563eb", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#0f766e", "#64748b"];

function getDefaultDate(month) {
  const today = new Date().toISOString().slice(0, 10);
  return today.startsWith(month) ? today : `${month}-05`;
}

function createEmptyForm(month) {
  return {
    receipt_type: "salario",
    amount: "",
    date: getDefaultDate(month),
    recurrence: "unica",
    recurrence_end_month: "",
    notes: "",
  };
}

export function useToast() {
  const [toast, setToast] = useState({ text: "", tone: "success" });
  useEffect(() => {
    if (!toast.text) return undefined;
    const timeoutId = window.setTimeout(() => setToast({ text: "", tone: "success" }), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);
  return [toast, (text, tone = "success") => setToast({ text, tone })];
}

export function AreaToast({ toast }) {
  return (
    <div
      className={`app-toast${toast.text ? " visible" : ""}${toast.tone === "error" ? " error" : ""}`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {toast.text}
    </div>
  );
}

// Abas internas de uma área (Salário, TikTok): mesmo controle segmentado já usado nos filtros de Despesas.
export function AreaSubTabs({ tabs, active, onChange, label }) {
  return (
    <div className="expense-segmented area-subtabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={active === tab.key ? "is-active" : ""}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// Gráfico de rosca no mesmo padrão do Resumo de Despesas.
export function DonutChart({ segments, total, emptyText }) {
  if (!segments.length || total <= 0) return <p style={{ margin: 0, color: "var(--muted)" }}>{emptyText}</p>;
  let cursor = 0;
  const parts = segments.map((segment, index) => {
    const start = cursor;
    cursor += (segment.value / total) * 100;
    return { ...segment, color: segment.color || CHART_COLORS[index % CHART_COLORS.length], start, end: cursor };
  });
  const background = `conic-gradient(${parts.map((part) => `${part.color} ${part.start}% ${part.end}%`).join(", ")})`;

  return (
    <div className="expenses-donut-layout">
      <div className="expenses-donut-card">
        <div className="expenses-donut-chart" style={{ background }}>
          <div className="expenses-donut-center">
            <strong>{currency(total)}</strong>
            <span>Total</span>
          </div>
        </div>
      </div>
      <div className="expenses-donut-legend">
        {parts.map((part) => (
          <div key={part.label} className="expenses-donut-legend-item">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="expenses-donut-dot" style={{ background: part.color }} />
              <strong>{part.label}</strong>
            </div>
            <span>{currency(part.value)} · {((part.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptsTable({ items, isLoading, isSaving, onEdit, onDelete, emptyText, total }) {
  return (
    <div className="area-table-wrap">
      <table className="personal-table area-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Valor</th>
            <th>Recorrência</th>
            <th>Observações</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan="6" style={{ textAlign: "center" }}>Carregando recebimentos...</td></tr>
          ) : items.length ? (
            items.map((item) => (
              <tr key={`${item.id}-${item.month_date}`}>
                <td>{formatDate(item.month_date)}</td>
                <td>{getSalaryTypeLabel(item.receipt_type)}</td>
                <td>{currency(item.amount)}</td>
                <td>
                  {item.recurrence === "mensal" ? (
                    <span className="status-pill paid">
                      Mensal{item.recurrence_end_month ? ` até ${getMonthLabel(item.recurrence_end_month)}` : ""}
                    </span>
                  ) : (
                    "Única"
                  )}
                </td>
                <td>{item.notes || "-"}</td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="password-btn icon-action-btn" onClick={() => onEdit(item)} title="Editar" aria-label={`Editar ${getSalaryTypeLabel(item.receipt_type)} de ${formatDate(item.month_date)}`}>
                      ✏️
                    </button>
                    <button type="button" className="logout-btn icon-action-btn" onClick={() => onDelete(item)} disabled={isSaving} title="Excluir" aria-label={`Excluir ${getSalaryTypeLabel(item.receipt_type)} de ${formatDate(item.month_date)}`}>
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr><td colSpan="6" style={{ textAlign: "center" }}>{emptyText}</td></tr>
          )}
        </tbody>
        {items.length ? (
          <tfoot>
            <tr>
              <td colSpan="2">Total do mês</td>
              <td>{currency(total)}</td>
              <td colSpan="3" />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// Aba Salário: recebimentos de salário e benefícios. Todos os tipos (inclusive VR, VA e VT) somam no card verde
// e nas receitas gerais do Dashboard. Não há despesas nesta área.
export default function SalaryTab({ month, receipts, setReceipts, isLoading, loadError }) {
  const [subTab, setSubTab] = useState("lancamentos");
  const [form, setForm] = useState(() => createEmptyForm(month));
  const [editingId, setEditingId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => shiftMonth(month, -1));
  const [toast, showToast] = useToast();

  const monthReceipts = useMemo(() => getSalaryReceiptsForMonth(receipts, month), [receipts, month]);
  const monthTotal = useMemo(() => sumAmounts(monthReceipts), [monthReceipts]);
  const totalsByType = useMemo(() => getSalaryTotalsByType(receipts, month), [receipts, month]);

  // Histórico: meses com recebimentos (do mais recente para o mais antigo) + mês filtrado.
  const historyMonths = useMemo(() => {
    const normalized = receipts.map(normalizeSalaryReceipt).filter((item) => item.date);
    if (!normalized.length) return [];
    const first = normalized.reduce((min, item) => (item.date.slice(0, 7) < min ? item.date.slice(0, 7) : min), month);
    const months = [];
    for (let cursor = month; cursor >= first && months.length < 60; cursor = shiftMonth(cursor, -1)) {
      const items = getSalaryReceiptsForMonth(receipts, cursor);
      if (items.length) months.push({ monthKey: cursor, count: items.length, total: sumAmounts(items) });
    }
    return months;
  }, [receipts, month]);
  const historyReceipts = useMemo(() => getSalaryReceiptsForMonth(receipts, historyMonth), [receipts, historyMonth]);
  const historyTotal = useMemo(() => sumAmounts(historyReceipts), [historyReceipts]);

  useEffect(() => {
    if (!editingId) setForm((current) => ({ ...current, date: getDefaultDate(month) }));
  }, [month, editingId]);

  const updateField = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  const resetForm = () => {
    setEditingId(null);
    setForm(createEmptyForm(month));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const amount = Number(String(form.amount).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Informe um valor maior que zero.", "error");
      return;
    }

    const payload = {
      receipt_type: form.receipt_type,
      amount,
      date: form.date,
      recurrence: form.recurrence,
      recurrence_end_month: form.recurrence === "mensal" ? form.recurrence_end_month : "",
      notes: form.notes,
    };

    setIsSaving(true);
    try {
      if (editingId) {
        const saved = await apiFetch(`/api/salary/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        setReceipts((current) => current.map((item) => (Number(item.id) === editingId ? saved : item)));
        showToast("Recebimento atualizado.");
      } else {
        const saved = await apiFetch("/api/salary", { method: "POST", body: JSON.stringify(payload) });
        setReceipts((current) => [saved, ...current]);
        showToast("Recebimento adicionado.");
      }
      resetForm();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Edição sempre acontece no formulário da aba Lançamentos (inclusive quando iniciada pelo Histórico).
  const handleEdit = (item) => {
    const receipt = normalizeSalaryReceipt(item);
    setEditingId(receipt.id);
    setForm({
      receipt_type: receipt.receipt_type,
      amount: String(receipt.amount),
      date: receipt.date,
      recurrence: receipt.recurrence,
      recurrence_end_month: receipt.recurrence_end_month,
      notes: receipt.notes,
    });
    setSubTab("lancamentos");
  };

  const handleDelete = async (item) => {
    setIsSaving(true);
    try {
      await apiFetch(`/api/salary/${item.id}`, { method: "DELETE" });
      setReceipts((current) => current.filter((row) => Number(row.id) !== item.id));
      if (editingId === item.id) resetForm();
      showToast(item.recurrence === "mensal" ? "Recebimento recorrente removido." : "Recebimento removido.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const editingReceipt = editingId ? receipts.map(normalizeSalaryReceipt).find((item) => item.id === editingId) : null;

  return (
    <>
      <AreaToast toast={toast} />

      <AreaSubTabs tabs={SALARY_SUBTABS} active={subTab} onChange={setSubTab} label="Seções do Salário" />

      {loadError ? <p className="dashboard-source-warning" role="alert">Não foi possível carregar os recebimentos: {loadError}</p> : null}

      {subTab === "lancamentos" ? (
        <>
          <SummaryCards
            className="is-single"
            cards={[{ label: "Receitas do mês", value: monthTotal, tone: "card-green", icon: FaCircleArrowUp, hint: getMonthLabel(month) }]}
          />

          <div className="card area-form-card">
            <div className="area-form-header">
              <strong>{editingId ? "Editar recebimento" : "Novo recebimento"}</strong>
              <p>
                {editingReceipt
                  ? `Lançamento de ${formatDate(editingReceipt.date)}${editingReceipt.recurrence === "mensal" ? " (recorrente)" : ""}.`
                  : "Salário e benefícios (VR, VA e VT também entram no total do mês)."}
              </p>
            </div>
            <form className="area-form-grid" onSubmit={handleSubmit}>
              <div className="area-field">
                <label htmlFor="salary-type">Tipo de recebimento</label>
                <select id="salary-type" style={areaFieldStyle} value={form.receipt_type} onChange={(event) => updateField("receipt_type", event.target.value)}>
                  {SALARY_RECEIPT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div className="area-field">
                <label htmlFor="salary-amount">Valor</label>
                <input
                  id="salary-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  style={areaFieldStyle}
                  value={form.amount}
                  onChange={(event) => updateField("amount", event.target.value)}
                  required
                />
              </div>
              <div className="area-field">
                <label htmlFor="salary-date">Data de recebimento</label>
                <input id="salary-date" type="date" style={areaFieldStyle} value={form.date} onChange={(event) => updateField("date", event.target.value)} required />
              </div>
              <div className="area-field">
                <label htmlFor="salary-recurrence">Recorrência</label>
                <select id="salary-recurrence" style={areaFieldStyle} value={form.recurrence} onChange={(event) => updateField("recurrence", event.target.value)}>
                  {SALARY_RECURRENCES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              {form.recurrence === "mensal" ? (
                <div className="area-field">
                  <label htmlFor="salary-recurrence-end">Repetir até (opcional)</label>
                  <input
                    id="salary-recurrence-end"
                    type="month"
                    style={areaFieldStyle}
                    value={form.recurrence_end_month}
                    min={String(form.date || "").slice(0, 7)}
                    onChange={(event) => updateField("recurrence_end_month", event.target.value)}
                  />
                </div>
              ) : null}
              <div className="area-field area-field-wide">
                <label htmlFor="salary-notes">Observações (opcional)</label>
                <input
                  id="salary-notes"
                  style={areaFieldStyle}
                  maxLength={500}
                  placeholder="Ex.: adiantamento quinzenal"
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </div>
              <div className="area-form-actions">
                <button type="submit" className="auth-submit" disabled={isSaving}>
                  {isSaving ? "Salvando..." : editingId ? "Salvar alterações" : "Adicionar recebimento"}
                </button>
                {editingId ? (
                  <button type="button" className="auth-outline-button" onClick={resetForm}>Cancelar</button>
                ) : null}
              </div>
              {editingId && form.recurrence === "mensal" ? (
                <p className="area-form-note">Alterar um recebimento mensal atualiza todos os meses da recorrência.</p>
              ) : null}
            </form>
          </div>

          <div className="card">
            <h2>Lançamentos de {getMonthLabel(month)}</h2>
            <ReceiptsTable
              items={monthReceipts}
              isLoading={isLoading}
              isSaving={isSaving}
              onEdit={handleEdit}
              onDelete={handleDelete}
              total={monthTotal}
              emptyText="Nenhum recebimento neste mês."
            />
          </div>
        </>
      ) : null}

      {subTab === "resumo" ? (
        <>
          <div className="card area-summary-total">
            <div>
              <h2 style={{ margin: 0 }}>Total recebido</h2>
              <p className="area-month-cell" style={{ margin: "4px 0 0", color: "var(--muted)" }}>{getMonthLabel(month)}</p>
            </div>
            <strong>{currency(monthTotal)}</strong>
          </div>

          <div className="area-two-columns">
            <div className="card dashboard-kpis-card">
              <h2>Por tipo de recebimento</h2>
              {totalsByType.length ? (
                <div className="small-grid dashboard-kpis-grid">
                  {totalsByType.map((type) => (
                    <div key={type.value} className="mini-card green">
                      <span>{type.label}</span>
                      <strong>{currency(type.total)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, color: "var(--muted)" }}>Sem recebimentos neste mês.</p>
              )}
            </div>

            <div className="card">
              <h2>Distribuição</h2>
              <DonutChart
                segments={totalsByType.map((type) => ({ label: type.label, value: type.total }))}
                total={monthTotal}
                emptyText="Sem recebimentos para exibir o gráfico."
              />
            </div>
          </div>
        </>
      ) : null}

      {subTab === "historico" ? (
        <>
          <div className="card area-history-card">
            <div className="area-history-toolbar">
              <h2 style={{ margin: 0 }}>Histórico de recebimentos</h2>
              <div className="area-field area-history-filter">
                <label htmlFor="salary-history-month">Mês</label>
                <input
                  id="salary-history-month"
                  type="month"
                  style={areaFieldStyle}
                  value={historyMonth}
                  onChange={(event) => event.target.value && setHistoryMonth(event.target.value)}
                />
              </div>
            </div>
            {historyMonths.length ? (
              <div className="area-history-months" aria-label="Meses com recebimentos">
                {historyMonths.map((entry) => (
                  <button
                    key={entry.monthKey}
                    type="button"
                    className={`area-history-month${entry.monthKey === historyMonth ? " is-active" : ""}`}
                    onClick={() => setHistoryMonth(entry.monthKey)}
                  >
                    <span className="area-month-cell">{getMonthLabel(entry.monthKey)}</span>
                    <strong>{currency(entry.total)}</strong>
                    <small>{entry.count} {entry.count === 1 ? "lançamento" : "lançamentos"}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="card">
            <h2>Lançamentos de {getMonthLabel(historyMonth)}</h2>
            <ReceiptsTable
              items={historyReceipts}
              isLoading={isLoading}
              isSaving={isSaving}
              onEdit={handleEdit}
              onDelete={handleDelete}
              total={historyTotal}
              emptyText="Nenhum recebimento neste mês."
            />
          </div>
        </>
      ) : null}
    </>
  );
}
