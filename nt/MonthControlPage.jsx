import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate, getCurrentMonthKey, getMonthLabel } from "./driver-data";
import { apiFetch } from "./http";
import { PageHeader } from "./Pages";
import ModalShell from "./ModalShell";
import { AreaSubTabs, AreaToast, areaFieldStyle, useToast } from "./SalaryTab";
import { ConfirmDialog } from "./expenses-shared";
import { shiftMonth } from "./finance-areas";
import {
  ENTRY_TYPES,
  PARTICIPANTS,
  centsToInput,
  computeClosing,
  formatCents,
  getEntryTypeLabel,
  getParticipant,
  hasBillFields,
  toCents,
  totalsByPayer,
} from "./month-control-logic";

const TABS = [
  { key: "lancamentos", label: "Lançamentos" },
  { key: "fechamento", label: "Fechamento" },
  { key: "historico", label: "Histórico" },
];

const STATUS_LABELS = { receber: "A receber", pagar: "A pagar", equilibrado: "Equilibrado" };

const getToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const signedCents = (cents) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${formatCents(Math.abs(cents))}`;

function PersonAvatar({ participantKey, size = 36 }) {
  const participant = getParticipant(participantKey);
  return (
    <span className="tiktok-avatar" style={{ background: participant?.color || "#64748b", width: size, height: size, fontSize: size > 30 ? "0.95rem" : "0.72rem" }} aria-hidden="true">
      {participant?.name.charAt(0) || "?"}
    </span>
  );
}

function MonthNav({ month, onChange }) {
  return (
    <div className="tiktok-month-nav mc-month-nav" aria-label="Navegação entre meses">
      <button type="button" className="tiktok-month-btn" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
      <strong className="tiktok-month-label">{getMonthLabel(month)}</strong>
      <button type="button" className="tiktok-month-btn" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
    </div>
  );
}

// Cards de pessoa: total pago no mês (Isaque: "paga por fora"). Só lançamentos pagos.
function PersonCards({ entries }) {
  const totals = useMemo(() => totalsByPayer(entries), [entries]);
  return (
    <div className="mc-person-grid">
      {PARTICIPANTS.map((participant) => (
        <div key={participant.key} className={`card mc-person-card${participant.key === "isaque" ? " is-isaque" : ""}`}>
          <PersonAvatar participantKey={participant.key} />
          <div className="mc-person-info">
            <small>{participant.name}</small>
            <strong>{formatCents(totals[participant.key])}</strong>
            {participant.key === "isaque" ? <em>paga por fora</em> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function EntriesTable({ entries, onEdit, onDelete, onMarkPaid, busyId, emptyText }) {
  const withActions = Boolean(onEdit || onDelete);
  if (!entries.length) return <p className="expense-list-empty">{emptyText}</p>;
  return (
    <div className="mc-table-wrap">
      <table className="personal-table mc-table responsive-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Quem pagou</th>
            <th>Tipo</th>
            <th className="is-money">Valor</th>
            {withActions ? <th className="is-actions">Ações</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const participant = getParticipant(entry.payer);
            const isPending = entry.payment_status === "pendente";
            return (
              <tr key={entry.id} className={isPending ? "is-pending" : ""}>
                <td data-label="Data">{formatDate(entry.entry_date)}</td>
                <td data-label="Descrição">
                  <strong className="mc-entry-title">{entry.description}</strong>
                  {isPending ? (
                    <small className="status-pill pending mc-pending-pill">
                      Pendente{entry.due_date ? ` · vence ${formatDate(entry.due_date).slice(0, 5)}` : ""}
                    </small>
                  ) : null}
                  {entry.notes ? <small className="mc-entry-notes">{entry.notes}</small> : null}
                </td>
                <td data-label="Quem pagou">
                  <div className="mc-payer"><PersonAvatar participantKey={entry.payer} size={24} />{participant?.name}</div>
                </td>
                <td data-label="Tipo">{getEntryTypeLabel(entry.entry_type)}</td>
                <td data-label="Valor" className="is-money"><strong>{formatCents(entry.amount_cents)}</strong></td>
                {withActions ? (
                  <td data-label="Ações" className="is-actions">
                    <div className="mc-actions">
                      {isPending && onMarkPaid ? (
                        <button type="button" className="password-btn icon-action-btn" onClick={() => onMarkPaid(entry)} disabled={busyId === entry.id} title="Marcar como pago" aria-label={`Marcar ${entry.description} como pago`}>✅</button>
                      ) : null}
                      <button type="button" className="password-btn icon-action-btn" onClick={() => onEdit(entry)} disabled={busyId === entry.id} title="Editar" aria-label={`Editar ${entry.description}`}>✏️</button>
                      <button type="button" className="logout-btn icon-action-btn" onClick={() => onDelete(entry)} disabled={busyId === entry.id} title="Excluir" aria-label={`Excluir ${entry.description}`}>🗑️</button>
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Simulação do fechamento: sempre calculada a partir dos lançamentos atuais; nada é salvo.
function ClosingView({ entries }) {
  const closing = useMemo(() => computeClosing(entries), [entries]);
  const plural = closing.pendingCount > 1;
  return (
    <div className="mc-closing">
      <div className="mc-closing-summary" aria-label="Como o cálculo foi feito">
        <span>Total de despesas <strong>{formatCents(closing.totalCents)}</strong></span>
        <span>− Pago pelo Isaque <strong>{formatCents(closing.isaqueCents)}</strong></span>
        <span>= Valor a dividir <strong>{formatCents(closing.toSplitCents)}</strong></span>
      </div>
      {closing.pendingCount ? (
        <p className="dashboard-source-warning">
          {closing.pendingCount} conta{plural ? "s" : ""} pendente{plural ? "s" : ""} ({formatCents(closing.pendingCents)}) fora do fechamento até ser{plural ? "em" : ""} marcada{plural ? "s" : ""} como paga{plural ? "s" : ""}.
        </p>
      ) : null}
      <div className="mc-closing-grid">
        {closing.people.map((person) => (
          <div key={person.key} className={`card mc-closing-card is-${person.status}`}>
            <div className="mc-closing-head">
              <PersonAvatar participantKey={person.key} />
              <strong>{person.name}</strong>
              <small className={`mc-status-pill is-${person.status}`}>{STATUS_LABELS[person.status]}</small>
            </div>
            <dl>
              <div><dt>Total pago</dt><dd>{formatCents(person.paidCents)}</dd></div>
              <div><dt>Cota individual</dt><dd>{formatCents(person.quotaCents)}</dd></div>
            </dl>
            <div className="mc-closing-result">
              <small>Resultado final</small>
              <strong>{signedCents(person.balanceCents)}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function createEmptyForm(month) {
  const today = getToday();
  return {
    entry_date: today.startsWith(month) ? today : `${month}-01`,
    description: "",
    amount: "",
    payer: "nathan",
    entry_type: "individual",
    due_date: "",
    payment_status: "pago",
    notes: "",
  };
}

function EntryModal({ month, editing, onClose, onSaved }) {
  const [form, setForm] = useState(() => (editing ? {
    entry_date: editing.entry_date,
    description: editing.description,
    amount: centsToInput(editing.amount_cents),
    payer: editing.payer,
    entry_type: editing.entry_type,
    due_date: editing.due_date || "",
    payment_status: editing.payment_status,
    notes: editing.notes || "",
  } : createEmptyForm(month)));
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const isBill = hasBillFields(form.entry_type);

  const save = async (force = false) => {
    if (savingRef.current) return; // proteção contra clique repetido
    setError("");
    const amountCents = toCents(form.amount);
    if (!amountCents || amountCents <= 0) {
      setError("Informe um valor maior que zero (ex.: 120,50).");
      return;
    }
    if (!form.description.trim()) {
      setError("Informe a descrição.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        entry_date: form.entry_date,
        description: form.description,
        amount_cents: amountCents,
        payer: form.payer,
        entry_type: form.entry_type,
        due_date: isBill ? form.due_date || null : null,
        payment_status: isBill ? form.payment_status : "pago",
        notes: form.notes,
        force,
      };
      const saved = editing
        ? await apiFetch(`/api/month-control/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch("/api/month-control", { method: "POST", body: JSON.stringify(payload) });
      onSaved(saved, Boolean(editing));
    } catch (requestError) {
      if (requestError.status === 409 && requestError.payload?.code === "possible_duplicate") {
        setDuplicate(requestError.payload.duplicate);
      } else {
        setError(requestError.message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <ModalShell
      wide
      title={editing ? "Editar lançamento" : "Novo lançamento"}
      onClose={onClose}
      busy={saving}
      footer={duplicate ? (
        <div className="mc-duplicate-box">
          <p>
            Possível duplicidade: já existe <strong>{duplicate.description}</strong> de {formatCents(duplicate.amount_cents)} pago por {getParticipant(duplicate.payer)?.name} em {formatDate(duplicate.entry_date)}.
            Deseja salvar mesmo assim?
          </p>
          <div className="goal-dialog-buttons">
            <button type="button" className="auth-outline-button" onClick={() => setDuplicate(null)} disabled={saving}>Voltar e revisar</button>
            <button type="button" className="auth-submit" onClick={() => save(true)} disabled={saving}>{saving ? "Salvando..." : "Salvar mesmo assim"}</button>
          </div>
        </div>
      ) : (
        <div className="goal-dialog-buttons">
          <button type="button" className="auth-outline-button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" form="mc-entry-form" className="auth-submit" disabled={saving}>{saving ? "Salvando..." : editing ? "Salvar alterações" : "Salvar lançamento"}</button>
        </div>
      )}
    >
      <form
        id="mc-entry-form"
        className="mc-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          save(false);
        }}
      >
        <div className="area-field">
          <label htmlFor="mc-date">Data</label>
          <input id="mc-date" type="date" style={areaFieldStyle} value={form.entry_date} onChange={(event) => update("entry_date", event.target.value)} required />
        </div>
        <div className="area-field">
          <label htmlFor="mc-amount">Valor</label>
          <input id="mc-amount" inputMode="decimal" placeholder="0,00" style={areaFieldStyle} value={form.amount} onChange={(event) => update("amount", event.target.value)} required />
        </div>
        <div className="area-field area-field-wide">
          <label htmlFor="mc-description">Descrição</label>
          <input id="mc-description" maxLength={120} placeholder="Ex.: Mercado, Internet, Fatura do cartão" style={areaFieldStyle} value={form.description} onChange={(event) => update("description", event.target.value)} required />
        </div>
        <div className="area-field area-field-wide">
          <label id="mc-payer-label">Quem pagou</label>
          <div className="mc-payer-picker" role="radiogroup" aria-labelledby="mc-payer-label">
            {PARTICIPANTS.map((participant) => (
              <button
                key={participant.key}
                type="button"
                role="radio"
                aria-checked={form.payer === participant.key}
                className={form.payer === participant.key ? "is-active" : ""}
                onClick={() => update("payer", participant.key)}
              >
                <PersonAvatar participantKey={participant.key} size={22} />
                {participant.name}
              </button>
            ))}
          </div>
        </div>
        <div className="area-field">
          <label htmlFor="mc-type">Tipo de lançamento</label>
          <select id="mc-type" style={areaFieldStyle} value={form.entry_type} onChange={(event) => update("entry_type", event.target.value)}>
            {ENTRY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        {isBill ? (
          <>
            <div className="area-field">
              <label htmlFor="mc-due">Vencimento</label>
              <input id="mc-due" type="date" style={areaFieldStyle} value={form.due_date} onChange={(event) => update("due_date", event.target.value)} />
            </div>
            <div className="area-field area-field-wide">
              <label id="mc-status-label">Situação de pagamento</label>
              <div className="expense-segmented mc-status-picker" role="radiogroup" aria-labelledby="mc-status-label">
                {[{ value: "pago", label: "Pago" }, { value: "pendente", label: "Pendente" }].map((option) => (
                  <button key={option.value} type="button" role="radio" aria-checked={form.payment_status === option.value} className={form.payment_status === option.value ? "is-active" : ""} onClick={() => update("payment_status", option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
              {form.payment_status === "pendente" ? <small className="mc-hint">Pendente não entra no fechamento até ser marcado como pago.</small> : null}
              {form.entry_type === "cartao" ? <small className="mc-hint">Registre só o valor total da fatura (as compras do cartão não são lançadas separadamente).</small> : null}
            </div>
          </>
        ) : null}
        <div className="area-field area-field-wide">
          <label htmlFor="mc-notes">Observação (opcional)</label>
          <input id="mc-notes" maxLength={500} style={areaFieldStyle} value={form.notes} onChange={(event) => update("notes", event.target.value)} />
        </div>
        {error ? <p className="goal-redistribution-error">{error}</p> : null}
      </form>
    </ModalShell>
  );
}

function useMonthEntries(month, enabled = true) {
  const [state, setState] = useState({ month: "", entries: [], isLoading: true, error: "" });
  const latest = useRef(month);
  const reload = useCallback(async () => {
    if (!enabled) return;
    latest.current = month;
    setState((current) => ({ ...current, isLoading: true, error: "" }));
    try {
      const entries = await apiFetch(`/api/month-control/${encodeURIComponent(month)}`);
      if (latest.current === month) setState({ month, entries: Array.isArray(entries) ? entries : [], isLoading: false, error: "" });
    } catch (error) {
      if (latest.current === month) setState((current) => ({ ...current, isLoading: false, error: error.message }));
    }
  }, [month, enabled]);
  useEffect(() => {
    reload();
  }, [reload]);
  const setEntries = useCallback((updater) => setState((current) => ({ ...current, entries: updater(current.entries) })), []);
  return { ...state, entries: state.month === month ? state.entries : [], setEntries, reload };
}

// Controle do Mês: gastos de Nathan, Mauricio e Lene, contas pagas por fora pelo Isaque e simulação do acerto.
// Módulo independente (não alimenta Dashboard, Despesas, Uber, Salário nem TikTok).
export function MonthControlPage() {
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [tab, setTab] = useState("lancamentos");
  const [personFilter, setPersonFilter] = useState("todos");
  const [modal, setModal] = useState(null); // { editing }
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [historyMonths, setHistoryMonths] = useState([]);
  const [historyMonth, setHistoryMonth] = useState("");
  const [toast, showToast] = useToast();
  const { entries, isLoading, error, setEntries, reload } = useMonthEntries(month);
  const selectedHistoryMonth = historyMonth || month;
  const history = useMonthEntries(selectedHistoryMonth, tab === "historico");

  const filteredEntries = useMemo(
    () => (personFilter === "todos" ? entries : entries.filter((entry) => entry.payer === personFilter)),
    [entries, personFilter]
  );

  useEffect(() => {
    if (tab !== "historico") return;
    apiFetch("/api/month-control/months")
      .then((list) => setHistoryMonths(Array.isArray(list) ? list : []))
      .catch(() => setHistoryMonths([]));
  }, [tab]);

  const handleSaved = (saved, wasEditing) => {
    setModal(null);
    if (saved.year_month !== month) {
      setMonth(saved.year_month);
    } else {
      setEntries((current) => [saved, ...current.filter((item) => item.id !== saved.id)]
        .sort((left, right) => right.entry_date.localeCompare(left.entry_date) || right.id - left.id));
    }
    showToast(wasEditing ? "Lançamento atualizado." : "Lançamento salvo.");
  };

  const handleDelete = (entry) => {
    setConfirm({
      title: "Excluir lançamento",
      message: <p><strong>{entry.description}</strong> · {formatCents(entry.amount_cents)} · {getParticipant(entry.payer)?.name} · {formatDate(entry.entry_date)}</p>,
      actions: [{
        label: "Excluir lançamento",
        tone: "danger",
        onClick: async () => {
          setBusyId(entry.id);
          try {
            await apiFetch(`/api/month-control/${entry.id}`, { method: "DELETE" });
            setEntries((current) => current.filter((item) => item.id !== entry.id));
            setConfirm(null);
            showToast("Lançamento excluído.");
          } catch (requestError) {
            showToast(requestError.message, "error");
          } finally {
            setBusyId(null);
          }
        },
      }],
    });
  };

  const handleMarkPaid = async (entry) => {
    setBusyId(entry.id);
    try {
      const saved = await apiFetch(`/api/month-control/${entry.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...entry, payment_status: "pago", force: true }),
      });
      setEntries((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      showToast("Conta marcada como paga. Ela já entra no fechamento.");
    } catch (requestError) {
      showToast(requestError.message, "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <AreaToast toast={toast} />
      <PageHeader
        title={<span className="mc-title"><span className="mc-title-icon" aria-hidden="true">🗓️</span>Controle do Mês</span>}
        subtitle="Registro de gastos e acerto entre o grupo."
        centered
      />

      <div className="mc-topbar">
        {tab !== "historico" ? <MonthNav month={month} onChange={setMonth} /> : <span />}
        <AreaSubTabs tabs={TABS} active={tab} onChange={setTab} label="Seções do Controle do Mês" />
      </div>

      {error ? (
        <p className="dashboard-source-warning" role="alert">
          Não foi possível carregar os lançamentos: {error}{" "}
          <button type="button" className="ghost-button" onClick={reload}>Tentar novamente</button>
        </p>
      ) : null}

      {tab === "lancamentos" ? (
        <>
          <PersonCards entries={entries} />
          <div className="card mc-entries-card">
            <div className="mc-entries-toolbar">
              <div className="expense-segmented mc-person-filter" role="radiogroup" aria-label="Filtrar por pessoa">
                {[{ key: "todos", name: "Todos" }, ...PARTICIPANTS].map((option) => (
                  <button key={option.key} type="button" role="radio" aria-checked={personFilter === option.key} className={personFilter === option.key ? "is-active" : ""} onClick={() => setPersonFilter(option.key)}>
                    {option.name}
                  </button>
                ))}
              </div>
              <button type="button" className="auth-submit mc-new-btn" onClick={() => setModal({ editing: null })}>+ Novo lançamento</button>
            </div>
            {isLoading && !entries.length ? (
              <p className="expense-list-empty">Carregando lançamentos...</p>
            ) : (
              <EntriesTable
                entries={filteredEntries}
                onEdit={(entry) => setModal({ editing: entry })}
                onDelete={handleDelete}
                onMarkPaid={handleMarkPaid}
                busyId={busyId}
                emptyText={entries.length ? "Nenhum lançamento desta pessoa no mês." : `Nenhum lançamento em ${getMonthLabel(month)}.`}
              />
            )}
          </div>
        </>
      ) : null}

      {tab === "fechamento" ? <ClosingView entries={entries} /> : null}

      {tab === "historico" ? (
        <>
          <div className="card area-history-card">
            <div className="area-history-toolbar">
              <h2 style={{ margin: 0 }}>Meses anteriores</h2>
              <div className="area-field area-history-filter">
                <label htmlFor="mc-history-month">Mês e ano</label>
                <input id="mc-history-month" type="month" style={areaFieldStyle} value={selectedHistoryMonth} onChange={(event) => event.target.value && setHistoryMonth(event.target.value)} />
              </div>
            </div>
            {historyMonths.length ? (
              <div className="area-history-months">
                {historyMonths.map((item) => (
                  <button key={item.month} type="button" className={`area-history-month${item.month === selectedHistoryMonth ? " is-active" : ""}`} onClick={() => setHistoryMonth(item.month)}>
                    <span className="area-month-cell">{getMonthLabel(item.month)}</span>
                    <strong>{formatCents(Object.values(item.paidTotals).reduce((sum, value) => sum + value, 0))}</strong>
                    <small>{item.count} lançamento{item.count === 1 ? "" : "s"}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)" }}>Ainda não há meses com lançamentos.</p>
            )}
          </div>
          <h2 className="mc-section-title area-month-cell">{getMonthLabel(selectedHistoryMonth)}</h2>
          <PersonCards entries={history.entries} />
          <ClosingView entries={history.entries} />
          <div className="card mc-entries-card">
            <h2 style={{ margin: 0 }}>Lançamentos</h2>
            <EntriesTable entries={history.entries} emptyText="Nenhum lançamento neste mês." />
          </div>
        </>
      ) : null}

      {modal ? <EntryModal month={month} editing={modal.editing} onClose={() => setModal(null)} onSaved={handleSaved} /> : null}
      {confirm ? <ConfirmDialog {...confirm} busy={Boolean(busyId)} onClose={() => setConfirm(null)} /> : null}
    </>
  );
}
