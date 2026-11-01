import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "./driver-data";
import { apiFetch } from "./http";
import { PageHeader } from "./Pages";
import ModalShell from "./ModalShell";
import { AreaToast, areaFieldStyle, useToast } from "./SalaryTab";
import { ConfirmDialog } from "./expenses-shared";
import { centsToInput, formatCents, toCents } from "./month-control-logic";
import { DEBT_CATEGORIES, filterDebts, getCategoryLabel, summarizeDebt, summarizeDebts, validateOriginal, validatePayment } from "./old-debts-logic";

const STATUS_FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "aberto", label: "Em aberto" },
  { key: "quitada", label: "Quitadas" },
];

const getToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function StatusPill({ status }) {
  return <small className={`status-pill ${status === "quitada" ? "paid" : "pending"}`}>{status === "quitada" ? "Quitada" : "Em aberto"}</small>;
}

// Guarda contra envio duplo (clique repetido no botão salvar).
function useSingleFlight() {
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const run = useCallback(async (task) => {
    if (runningRef.current) return undefined;
    runningRef.current = true;
    setRunning(true);
    try {
      return await task();
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, []);
  return [running, run];
}

function DebtFormModal({ editing, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    description: editing?.description || "",
    category: editing?.category || "",
    creditor: editing?.creditor || "",
    original: editing ? centsToInput(editing.original_cents) : "",
    notes: editing?.notes || "",
  }));
  const [error, setError] = useState("");
  const [saving, runOnce] = useSingleFlight();
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const summary = editing ? summarizeDebt(editing) : null;

  const submit = (event) => {
    event.preventDefault();
    setError("");
    const originalCents = toCents(form.original);
    if (!form.description.trim()) return setError("Informe a descrição da dívida.");
    if (!form.category) return setError("Selecione uma categoria.");
    if (!originalCents) return setError("Informe um valor original maior que zero (ex.: 5.000,00).");
    if (editing) {
      const check = validateOriginal(editing, originalCents);
      if (!check.ok) return setError(`${check.error} Mínimo permitido: ${formatCents(check.minCents)}.`);
    }
    return runOnce(async () => {
      try {
        const payload = { description: form.description, category: form.category, creditor: form.creditor, original_cents: originalCents, notes: form.notes };
        const saved = editing
          ? await apiFetch(`/api/old-debts/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) })
          : await apiFetch("/api/old-debts", { method: "POST", body: JSON.stringify(payload) });
        onSaved(saved, Boolean(editing));
      } catch (requestError) {
        setError(requestError.message);
      }
    });
  };

  return (
    <ModalShell
      wide
      title={editing ? "Editar dívida" : "Nova dívida"}
      onClose={onClose}
      busy={saving}
      labelId="debt-form-title"
      footer={(
        <div className="goal-dialog-buttons">
          <button type="button" className="auth-outline-button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" form="debt-form" className="auth-submit" disabled={saving}>{saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar dívida"}</button>
        </div>
      )}
    >
      <form id="debt-form" className="mc-form-grid" onSubmit={submit}>
        <div className="area-field area-field-wide">
          <label htmlFor="debt-description">Descrição da dívida</label>
          <input id="debt-description" maxLength={120} placeholder="Ex.: Faculdade 2023, Empréstimo do banco" style={areaFieldStyle} value={form.description} onChange={(event) => update("description", event.target.value)} required />
        </div>
        <div className="area-field">
          <label htmlFor="debt-category">Categoria</label>
          <select id="debt-category" style={areaFieldStyle} value={form.category} onChange={(event) => update("category", event.target.value)} required>
            <option value="">Selecione</option>
            {DEBT_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select>
        </div>
        <div className="area-field">
          <label htmlFor="debt-original">Valor original</label>
          <input id="debt-original" inputMode="decimal" placeholder="0,00" style={areaFieldStyle} value={form.original} onChange={(event) => update("original", event.target.value)} required />
          {summary && summary.paidCents > 0 ? <small className="mc-hint">Já pago: {formatCents(summary.paidCents)} (mínimo permitido).</small> : null}
        </div>
        <div className="area-field area-field-wide">
          <label htmlFor="debt-creditor">Empresa ou credor (opcional)</label>
          <input id="debt-creditor" maxLength={120} placeholder="Ex.: Banco, faculdade, nome da pessoa" style={areaFieldStyle} value={form.creditor} onChange={(event) => update("creditor", event.target.value)} />
        </div>
        <div className="area-field area-field-wide">
          <label htmlFor="debt-notes">Observações (opcional)</label>
          <textarea id="debt-notes" rows={3} maxLength={1000} style={{ ...areaFieldStyle, resize: "vertical" }} value={form.notes} onChange={(event) => update("notes", event.target.value)} />
        </div>
        {error ? <p className="goal-redistribution-error">{error}</p> : null}
      </form>
    </ModalShell>
  );
}

function PaymentForm({ debt, editingPayment, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    amount: editingPayment ? centsToInput(editingPayment.amount_cents) : "",
    paid_on: editingPayment?.paid_on || getToday(),
    notes: editingPayment?.notes || "",
  }));
  const [error, setError] = useState("");
  const [saving, runOnce] = useSingleFlight();
  const summary = summarizeDebt(debt);
  const maxCents = summary.remainingCents + (editingPayment?.amount_cents || 0);

  const submit = (event) => {
    event.preventDefault();
    setError("");
    const amountCents = toCents(form.amount);
    const check = validatePayment(debt, amountCents || 0, editingPayment?.amount_cents || 0);
    if (!check.ok) return setError(amountCents > 0 ? `${check.error} Máximo permitido: ${formatCents(check.maxCents)}.` : check.error);
    if (!form.paid_on) return setError("Informe a data do pagamento.");
    return runOnce(async () => {
      try {
        const payload = { amount_cents: amountCents, paid_on: form.paid_on, notes: form.notes };
        const saved = editingPayment
          ? await apiFetch(`/api/old-debts/${debt.id}/payments/${editingPayment.id}`, { method: "PUT", body: JSON.stringify(payload) })
          : await apiFetch(`/api/old-debts/${debt.id}/payments`, { method: "POST", body: JSON.stringify(payload) });
        onSaved(saved, Boolean(editingPayment));
      } catch (requestError) {
        setError(requestError.message);
      }
    });
  };

  return (
    <form className="debt-payment-form" onSubmit={submit}>
      <strong>{editingPayment ? "Editar pagamento" : "Registrar pagamento"}</strong>
      <div className="debt-payment-fields">
        <div className="area-field">
          <label htmlFor="payment-amount">Valor pago</label>
          <input id="payment-amount" inputMode="decimal" placeholder="0,00" autoFocus style={areaFieldStyle} value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required />
          <small className="mc-hint">Máximo: {formatCents(maxCents)}</small>
        </div>
        <div className="area-field">
          <label htmlFor="payment-date">Data do pagamento</label>
          <input id="payment-date" type="date" style={areaFieldStyle} value={form.paid_on} onChange={(event) => setForm((current) => ({ ...current, paid_on: event.target.value }))} required />
        </div>
        <div className="area-field area-field-wide">
          <label htmlFor="payment-notes">Observação (opcional)</label>
          <input id="payment-notes" maxLength={500} style={areaFieldStyle} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </div>
      </div>
      {error ? <p className="goal-redistribution-error">{error}</p> : null}
      <div className="goal-dialog-buttons">
        <button type="button" className="auth-outline-button" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="auth-submit" disabled={saving}>{saving ? "Salvando..." : "Salvar pagamento"}</button>
      </div>
    </form>
  );
}

function DebtDetailsModal({ debt, onClose, onChanged, showToast }) {
  const [paymentForm, setPaymentForm] = useState(null); // { editing }
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const summary = summarizeDebt(debt);

  const deletePayment = (payment) => setConfirm({
    title: "Excluir pagamento",
    message: <p>Excluir o pagamento de <strong>{formatCents(payment.amount_cents)}</strong> em {formatDate(payment.paid_on)}? O total pago e o saldo serão recalculados.</p>,
    actions: [{
      label: "Excluir pagamento",
      tone: "danger",
      onClick: async () => {
        setBusy(true);
        try {
          const saved = await apiFetch(`/api/old-debts/${debt.id}/payments/${payment.id}`, { method: "DELETE" });
          onChanged(saved);
          setConfirm(null);
          showToast("Pagamento excluído.");
        } catch (requestError) {
          showToast(requestError.message, "error");
        } finally {
          setBusy(false);
        }
      },
    }],
  });

  return (
    <ModalShell wide title={debt.description} onClose={onClose} labelId="debt-details-title">
      <div className="debt-details-grid">
        <div><small>Categoria</small><strong>{getCategoryLabel(debt.category)}</strong></div>
        <div><small>Empresa ou credor</small><strong>{debt.creditor || "-"}</strong></div>
        <div><small>Situação</small><StatusPill status={summary.status} /></div>
        <div><small>Valor original</small><strong>{formatCents(summary.originalCents)}</strong></div>
        <div><small>Total já pago</small><strong className="is-paid">{formatCents(summary.paidCents)}</strong></div>
        <div><small>Saldo restante</small><strong className="is-remaining">{formatCents(summary.remainingCents)}</strong></div>
      </div>
      {debt.notes ? <p className="debt-notes"><small>Observações</small>{debt.notes}</p> : null}

      <div className="debt-payments-head">
        <h3>Histórico de pagamentos</h3>
        {summary.status !== "quitada" && !paymentForm ? (
          <button type="button" className="auth-submit debt-pay-btn" onClick={() => setPaymentForm({ editing: null })}>+ Registrar pagamento</button>
        ) : null}
      </div>

      {paymentForm ? (
        <PaymentForm
          debt={debt}
          editingPayment={paymentForm.editing}
          onCancel={() => setPaymentForm(null)}
          onSaved={(saved, wasEditing) => {
            onChanged(saved);
            setPaymentForm(null);
            const after = summarizeDebt(saved);
            showToast(after.status === "quitada" ? "Pagamento registrado. Dívida quitada! 🎉" : wasEditing ? "Pagamento atualizado." : "Pagamento registrado.");
          }}
        />
      ) : null}

      {summary.payments.length ? (
        <ul className="debt-payments-list">
          {summary.payments.map((payment) => (
            <li key={payment.id}>
              <div>
                <strong>{formatCents(payment.amount_cents)}</strong>
                <small>{formatDate(payment.paid_on)}{payment.notes ? ` · ${payment.notes}` : ""}</small>
              </div>
              <div className="mc-actions">
                <button type="button" className="password-btn icon-action-btn" onClick={() => setPaymentForm({ editing: payment })} disabled={busy} title="Editar pagamento" aria-label={`Editar pagamento de ${formatDate(payment.paid_on)}`}>✏️</button>
                <button type="button" className="logout-btn icon-action-btn" onClick={() => deletePayment(payment)} disabled={busy} title="Excluir pagamento" aria-label={`Excluir pagamento de ${formatDate(payment.paid_on)}`}>🗑️</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="expense-list-empty">Nenhum pagamento registrado ainda.</p>
      )}

      {confirm ? <ConfirmDialog {...confirm} busy={busy} onClose={() => setConfirm(null)} /> : null}
    </ModalShell>
  );
}

// Dívidas Antigas: controle pessoal de pendências e pagamentos parciais. Totalmente independente dos demais módulos.
export function OldDebtsPage() {
  const [debts, setDebts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [search, setSearch] = useState("");
  const [formModal, setFormModal] = useState(null); // { editing }
  const [detailsId, setDetailsId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const payload = await apiFetch("/api/old-debts");
      setDebts(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => summarizeDebts(debts), [debts]);
  const visible = useMemo(() => filterDebts(debts, { status: statusFilter, search }), [debts, statusFilter, search]);
  const detailsDebt = debts.find((debt) => debt.id === detailsId) || null;

  const upsertDebt = (saved) => setDebts((current) => (current.some((debt) => debt.id === saved.id)
    ? current.map((debt) => (debt.id === saved.id ? saved : debt))
    : [saved, ...current]));

  const handleDelete = (debt) => {
    const summary = summarizeDebt(debt);
    setConfirm({
      title: "Excluir dívida",
      message: (
        <p>
          Excluir <strong>{debt.description}</strong> ({formatCents(summary.originalCents)})?
          {summary.payments.length ? ` O histórico de ${summary.payments.length} pagamento${summary.payments.length > 1 ? "s" : ""} (${formatCents(summary.paidCents)}) também será excluído.` : ""}
        </p>
      ),
      actions: [{
        label: "Excluir dívida",
        tone: "danger",
        onClick: async () => {
          setBusy(true);
          try {
            await apiFetch(`/api/old-debts/${debt.id}`, { method: "DELETE" });
            setDebts((current) => current.filter((item) => item.id !== debt.id));
            setConfirm(null);
            showToast("Dívida excluída.");
          } catch (requestError) {
            showToast(requestError.message, "error");
          } finally {
            setBusy(false);
          }
        },
      }],
    });
  };

  const stats = [
    { label: "Total das dívidas", value: formatCents(totals.totalCents), tone: "is-total" },
    { label: "Total pago", value: formatCents(totals.paidCents), tone: "is-paid" },
    { label: "Saldo restante", value: formatCents(totals.remainingCents), tone: "is-remaining" },
    { label: "Dívidas cadastradas", value: String(totals.count), tone: "is-count" },
  ];

  return (
    <>
      <AreaToast toast={toast} />
      <PageHeader
        title={<span className="mc-title"><span className="mc-title-icon" aria-hidden="true">📋</span>Dívidas Antigas</span>}
        subtitle="Registro e acompanhamento das minhas pendências financeiras"
        centered
      />

      <div className="debt-stats" aria-label="Resumo das dívidas">
        {stats.map((stat) => (
          <div key={stat.label} className={`card debt-stat ${stat.tone}`}>
            <small>{stat.label}</small>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>

      {loadError ? (
        <p className="dashboard-source-warning" role="alert">
          Não foi possível carregar as dívidas: {loadError}{" "}
          <button type="button" className="ghost-button" onClick={load}>Tentar novamente</button>
        </p>
      ) : null}

      <div className="card mc-entries-card">
        <div className="mc-entries-toolbar">
          <div className="expense-segmented" role="radiogroup" aria-label="Filtrar por situação">
            {STATUS_FILTERS.map((filter) => (
              <button key={filter.key} type="button" role="radio" aria-checked={statusFilter === filter.key} className={statusFilter === filter.key ? "is-active" : ""} onClick={() => setStatusFilter(filter.key)}>
                {filter.label}
              </button>
            ))}
          </div>
          <input type="search" className="debt-search" style={areaFieldStyle} placeholder="Pesquisar por nome ou empresa" aria-label="Pesquisar dívida" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="button" className="auth-submit mc-new-btn" onClick={() => setFormModal({ editing: null })}>+ Nova dívida</button>
        </div>

        {isLoading && !debts.length ? (
          <p className="expense-list-empty">Carregando dívidas...</p>
        ) : visible.length ? (
          <div className="mc-table-wrap">
            <table className="personal-table mc-table responsive-table debt-table">
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Empresa / Credor</th>
                  <th className="is-money">Valor original</th>
                  <th className="is-money">Total pago</th>
                  <th className="is-money">Saldo restante</th>
                  <th>Situação</th>
                  <th className="is-actions">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((debt) => (
                  <tr key={debt.id} className={debt.status === "quitada" ? "is-settled" : ""}>
                    <td data-label="Descrição">
                      <strong className="mc-entry-title">{debt.description}</strong>
                      <small className="mc-entry-notes">{getCategoryLabel(debt.category)}</small>
                    </td>
                    <td data-label="Empresa / Credor">{debt.creditor || "-"}</td>
                    <td data-label="Valor original" className="is-money">{formatCents(debt.originalCents)}</td>
                    <td data-label="Total pago" className="is-money">{formatCents(debt.paidCents)}</td>
                    <td data-label="Saldo restante" className="is-money"><strong>{formatCents(debt.remainingCents)}</strong></td>
                    <td data-label="Situação"><StatusPill status={debt.status} /></td>
                    <td data-label="Ações" className="is-actions">
                      <div className="mc-actions">
                        <button type="button" className="password-btn icon-action-btn" onClick={() => setDetailsId(debt.id)} title="Visualizar" aria-label={`Visualizar ${debt.description}`}>👁️</button>
                        <button type="button" className="password-btn icon-action-btn" onClick={() => setFormModal({ editing: debt })} title="Editar" aria-label={`Editar ${debt.description}`}>✏️</button>
                        <button type="button" className="logout-btn icon-action-btn" onClick={() => handleDelete(debt)} disabled={busy} title="Excluir" aria-label={`Excluir ${debt.description}`}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="expense-list-empty">
            {debts.length ? "Nenhuma dívida corresponde ao filtro ou à pesquisa." : "Nenhuma dívida cadastrada. Clique em “+ Nova dívida” para começar."}
          </p>
        )}
      </div>

      {formModal ? (
        <DebtFormModal
          editing={formModal.editing}
          onClose={() => setFormModal(null)}
          onSaved={(saved, wasEditing) => {
            upsertDebt(saved);
            setFormModal(null);
            showToast(wasEditing ? "Dívida atualizada." : "Dívida cadastrada.");
          }}
        />
      ) : null}
      {detailsDebt ? <DebtDetailsModal debt={detailsDebt} onClose={() => setDetailsId(null)} onChanged={upsertDebt} showToast={showToast} /> : null}
      {confirm ? <ConfirmDialog {...confirm} busy={busy} onClose={() => setConfirm(null)} /> : null}
    </>
  );
}
