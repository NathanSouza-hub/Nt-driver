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
  SHARE_STATUS_LABELS,
  SPLIT_STATUS_LABELS,
  centsToInput,
  computeClosing,
  formatCents,
  getEntryTypeLabel,
  getParticipant,
  hasBillFields,
  normalizeParticipants,
  splitShares,
  summarizeSplitEntry,
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
// Pagamentos de partes de lançamentos divididos aparecem à parte (não são "pago por fora" do Isaque).
function PersonCards({ entries }) {
  const totals = useMemo(() => totalsByPayer(entries), [entries]);
  const splitPaid = useMemo(() => {
    const acc = {};
    entries.filter((entry) => entry.is_split).forEach((entry) => (entry.payments || []).forEach((payment) => {
      acc[payment.participant] = (acc[payment.participant] || 0) + (Number(payment.amount_cents) || 0);
    }));
    return acc;
  }, [entries]);
  return (
    <div className="mc-person-grid">
      {PARTICIPANTS.map((participant) => (
        <div key={participant.key} className={`card mc-person-card nt-kanban${participant.key === "isaque" ? " is-isaque" : ""}`} style={{ "--nt-tone": participant.color || "#64748b" }}>
          <PersonAvatar participantKey={participant.key} />
          <div className="mc-person-info">
            <small>{participant.name}</small>
            <strong>{formatCents(totals[participant.key])}</strong>
            {participant.key === "isaque" ? <em>paga por fora</em> : null}
            {splitPaid[participant.key] ? <em>+ {formatCents(splitPaid[participant.key])} em partes divididas</em> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const SPLIT_PILL_CLASS = { pendente: "pending", parcial: "pending mc-partial-pill", quitado: "paid", pago: "paid" };

function SplitPayerCell({ entry }) {
  const participants = normalizeParticipants((entry.shares || []).map((share) => share.participant));
  return (
    <div className="mc-payer mc-split-payer">
      <span className="mc-split-avatars" aria-hidden="true">
        {participants.map((key) => <PersonAvatar key={key} participantKey={key} size={22} />)}
      </span>
      Dividido ({participants.length})
    </div>
  );
}

function EntriesTable({ entries, onEdit, onDelete, onMarkPaid, onOpenSplit, busyId, emptyText }) {
  const withActions = Boolean(onEdit || onDelete || onOpenSplit);
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
            const split = entry.is_split ? summarizeSplitEntry(entry) : null;
            const isPending = split ? split.status !== "quitado" : entry.payment_status === "pendente";
            return (
              <tr key={entry.id} className={isPending ? "is-pending" : ""}>
                <td data-label="Data">{formatDate(entry.entry_date)}</td>
                <td data-label="Descrição">
                  <strong className="mc-entry-title">{entry.description}</strong>
                  {split ? (
                    <small className={`status-pill mc-pending-pill ${SPLIT_PILL_CLASS[split.status]}`}>
                      {SPLIT_STATUS_LABELS[split.status]}
                      {split.status !== "quitado" ? ` · falta ${formatCents(split.remainingCents)}` : ""}
                      {split.status !== "quitado" && entry.due_date ? ` · vence ${formatDate(entry.due_date).slice(0, 5)}` : ""}
                    </small>
                  ) : isPending ? (
                    <small className="status-pill pending mc-pending-pill">
                      Pendente{entry.due_date ? ` · vence ${formatDate(entry.due_date).slice(0, 5)}` : ""}
                    </small>
                  ) : null}
                  {entry.notes ? <small className="mc-entry-notes">{entry.notes}</small> : null}
                </td>
                <td data-label="Quem pagou">
                  {split ? <SplitPayerCell entry={entry} /> : (
                    <div className="mc-payer"><PersonAvatar participantKey={entry.payer} size={24} />{participant?.name}</div>
                  )}
                </td>
                <td data-label="Tipo">{getEntryTypeLabel(entry.entry_type)}</td>
                <td data-label="Valor" className="is-money"><strong>{formatCents(entry.amount_cents)}</strong></td>
                {withActions ? (
                  <td data-label="Ações" className="is-actions">
                    <div className="mc-actions">
                      {split && onOpenSplit ? (
                        <button type="button" className="password-btn icon-action-btn" onClick={() => onOpenSplit(entry)} disabled={busyId === entry.id} title="Ver partes e pagamentos" aria-label={`Ver partes e pagamentos de ${entry.description}`}>👥</button>
                      ) : null}
                      {!split && isPending && onMarkPaid ? (
                        <button type="button" className="password-btn icon-action-btn" onClick={() => onMarkPaid(entry)} disabled={busyId === entry.id} title="Marcar como pago" aria-label={`Marcar ${entry.description} como pago`}>✅</button>
                      ) : null}
                      {onEdit ? <button type="button" className="password-btn icon-action-btn" onClick={() => onEdit(entry)} disabled={busyId === entry.id} title="Editar" aria-label={`Editar ${entry.description}`}>✏️</button> : null}
                      {onDelete ? <button type="button" className="logout-btn icon-action-btn" onClick={() => onDelete(entry)} disabled={busyId === entry.id} title="Excluir" aria-label={`Excluir ${entry.description}`}>🗑️</button> : null}
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
  const hasSplit = closing.split.count > 0;
  const splitPeople = closing.split.people.filter((person) => person.shareCents > 0 || person.paidCents > 0);
  return (
    <div className="mc-closing">
      <div className="mc-closing-summary" aria-label="Como o cálculo foi feito">
        <span>Total de despesas <strong>{formatCents(closing.totalCents)}</strong></span>
        <span>− Pago pelo Isaque <strong>{formatCents(closing.isaqueCents)}</strong></span>
        <span>= Valor a dividir <strong>{formatCents(closing.toSplitCents)}</strong></span>
      </div>
      {closing.pendingCount ? (
        <p className="dashboard-source-warning">
          {closing.pendingCount} conta{plural ? "s" : ""} pendente{plural ? "s" : ""} sem divisão ({formatCents(closing.pendingCents)}) fora do fechamento até ser{plural ? "em" : ""} marcada{plural ? "s" : ""} como paga{plural ? "s" : ""}.
        </p>
      ) : null}
      <div className="mc-closing-grid">
        {closing.people.map((person) => (
          <div key={person.key} className={`card mc-closing-card nt-kanban is-${person.status} ${person.status === "receber" ? "nt-tone-green" : person.status === "pagar" ? "nt-tone-red" : "nt-tone-blue"}`}>
            <div className="mc-closing-head">
              <PersonAvatar participantKey={person.key} />
              <strong>{person.name}</strong>
              <small className={`mc-status-pill is-${person.status}`}>{STATUS_LABELS[person.status]}</small>
            </div>
            <dl>
              <div><dt>Total pago</dt><dd>{formatCents(person.paidCents)}</dd></div>
              <div><dt>Cota individual</dt><dd>{formatCents(person.quotaCents)}</dd></div>
              {hasSplit ? (
                <>
                  <div><dt>Saldo dos lançamentos comuns</dt><dd>{signedCents(person.commonBalanceCents)}</dd></div>
                  <div><dt>Partes divididas (falta pagar)</dt><dd>{person.splitRemainingCents ? `−${formatCents(person.splitRemainingCents)}` : formatCents(0)}</dd></div>
                </>
              ) : null}
            </dl>
            <div className="mc-closing-result">
              <small>Resultado final</small>
              <strong>{signedCents(person.balanceCents)}</strong>
            </div>
          </div>
        ))}
      </div>
      {hasSplit ? (
        <section className="card nt-shell mc-split-closing">
          <div className="nt-shell-head">
            <div>
              <strong>Lançamentos divididos</strong>
              <small>
                {closing.split.count} lançamento{closing.split.count === 1 ? "" : "s"} · {formatCents(closing.split.totalCents)} — entram no fechamento mesmo pendentes
              </small>
            </div>
          </div>
          <div className="nt-shell-body">
            <div className="mc-table-wrap">
              <table className="personal-table mc-table responsive-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th className="is-money">Deve nas partes</th>
                    <th className="is-money">Já pagou</th>
                    <th className="is-money">Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {splitPeople.map((person) => (
                    <tr key={person.key}>
                      <td data-label="Pessoa"><div className="mc-payer"><PersonAvatar participantKey={person.key} size={24} />{person.name}</div></td>
                      <td data-label="Deve nas partes" className="is-money">{formatCents(person.shareCents)}</td>
                      <td data-label="Já pagou" className="is-money">{formatCents(person.paidCents)}</td>
                      <td data-label="Falta" className="is-money"><strong>{formatCents(person.remainingCents)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mc-creditors-pending">
              Ainda pendente com credores (faturas e contas não pagas): <strong>{formatCents(closing.creditorsPendingCents)}</strong>
            </p>
            <small className="mc-hint">
              Resultado final = saldo dos lançamentos comuns + (pago nas partes − partes). As partes do Isaque não entram no abatimento do "pago por fora".
            </small>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// Partes e pagamentos de um lançamento dividido: responsabilidade, pago, restante e histórico.
function SplitModal({ entry, onClose, onUpdated }) {
  const summary = useMemo(() => summarizeSplitEntry(entry), [entry]);
  const firstOpen = summary.rows.find((row) => row.remainingCents > 0);
  const emptyPayment = (participant) => {
    const row = summary.rows.find((item) => item.participant === participant);
    return { id: null, participant: participant || "", amount: row && row.remainingCents ? centsToInput(row.remainingCents) : "", paid_on: getToday(), notes: "" };
  };
  const [form, setForm] = useState(null); // { id, participant, amount, paid_on, notes }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (request) => {
    if (busyRef.current) return; // proteção contra clique repetido
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await request();
      onUpdated(updated);
      setForm(null);
      setConfirmDelete(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const savePayment = (event) => {
    event.preventDefault();
    const amountCents = toCents(form.amount);
    if (!form.participant) {
      setError("Selecione quem pagou.");
      return;
    }
    if (!amountCents || amountCents <= 0) {
      setError("Informe um valor maior que zero (ex.: 120,50).");
      return;
    }
    const row = summary.rows.find((item) => item.participant === form.participant);
    // Ao corrigir, o valor antigo do próprio pagamento volta a ficar disponível (se for da mesma pessoa).
    const original = form.id ? entry.payments.find((item) => item.id === form.id) : null;
    const max = (row ? row.remainingCents : 0)
      +(original && original.participant === form.participant ? original.amount_cents : 0);
    if (amountCents > max) {
      setError(`O valor é maior que o restante da parte de ${getParticipant(form.participant)?.name}. Máximo permitido: ${formatCents(max)}.`);
      return;
    }
    const body = JSON.stringify({ participant: form.participant, amount_cents: amountCents, paid_on: form.paid_on, notes: form.notes });
    run(() => (form.id
      ? apiFetch(`/api/month-control/${entry.id}/payments/${form.id}`, { method: "PUT", body })
      : apiFetch(`/api/month-control/${entry.id}/payments`, { method: "POST", body })));
  };

  return (
    <ModalShell wide title={entry.description} onClose={onClose} busy={busy} labelId="mc-split-title">
      <div className="mc-split-modal">
        <div className="mc-split-head">
          <span>Valor da obrigação <strong>{formatCents(summary.totalCents)}</strong></span>
          <span>Pago <strong>{formatCents(summary.paidCents)}</strong></span>
          <span>Saldo pendente <strong>{formatCents(summary.remainingCents)}</strong></span>
          <small className={`status-pill ${SPLIT_PILL_CLASS[summary.status]}`}>{SPLIT_STATUS_LABELS[summary.status]}</small>
        </div>

        <div className="mc-table-wrap">
          <table className="personal-table mc-table responsive-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th className="is-money">Responsabilidade</th>
                <th className="is-money">Pago</th>
                <th className="is-money">Restante</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.participant}>
                  <td data-label="Pessoa"><div className="mc-payer"><PersonAvatar participantKey={row.participant} size={24} />{getParticipant(row.participant)?.name}</div></td>
                  <td data-label="Responsabilidade" className="is-money">{formatCents(row.shareCents)}</td>
                  <td data-label="Pago" className="is-money">{formatCents(row.paidCents)}</td>
                  <td data-label="Restante" className="is-money"><strong>{formatCents(row.remainingCents)}</strong></td>
                  <td data-label="Situação">
                    <small className={`status-pill ${SPLIT_PILL_CLASS[row.status]}`}>{SHARE_STATUS_LABELS[row.status]}</small>
                    {row.remainingCents > 0 && !form ? (
                      <button type="button" className="ghost-button mc-pay-share-btn" onClick={() => { setError(""); setForm(emptyPayment(row.participant)); }} disabled={busy}>Pagar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {form ? (
          <form className="debt-payment-form" onSubmit={savePayment}>
            <strong>{form.id ? "Corrigir pagamento" : "Registrar pagamento"}</strong>
            <div className="mc-payer-picker" role="radiogroup" aria-label="Quem pagou">
              {summary.rows.map((row) => (
                <button key={row.participant} type="button" role="radio" aria-checked={form.participant === row.participant} className={form.participant === row.participant ? "is-active" : ""} onClick={() => setForm((current) => ({ ...current, participant: row.participant }))}>
                  <PersonAvatar participantKey={row.participant} size={22} />
                  {getParticipant(row.participant)?.name}
                </button>
              ))}
            </div>
            <div className="debt-payment-fields">
              <div className="area-field">
                <label htmlFor="mc-pay-amount">Valor pago</label>
                <input id="mc-pay-amount" inputMode="decimal" placeholder="0,00" style={areaFieldStyle} value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required />
              </div>
              <div className="area-field">
                <label htmlFor="mc-pay-date">Data</label>
                <input id="mc-pay-date" type="date" style={areaFieldStyle} value={form.paid_on} onChange={(event) => setForm((current) => ({ ...current, paid_on: event.target.value }))} required />
              </div>
              <div className="area-field area-field-wide">
                <label htmlFor="mc-pay-notes">Observação (opcional)</label>
                <input id="mc-pay-notes" maxLength={500} style={areaFieldStyle} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </div>
            </div>
            <div className="goal-dialog-buttons">
              <button type="button" className="auth-outline-button" onClick={() => { setForm(null); setError(""); }} disabled={busy}>Cancelar</button>
              <button type="submit" className="auth-submit auth-submit-blue" disabled={busy}>{busy ? "Salvando..." : form.id ? "Salvar correção" : "Registrar pagamento"}</button>
            </div>
          </form>
        ) : firstOpen ? (
          <button type="button" className="auth-submit auth-submit-blue debt-pay-btn" onClick={() => { setError(""); setForm(emptyPayment(firstOpen.participant)); }}>+ Registrar pagamento</button>
        ) : (
          <p className="mc-hint">Todas as partes foram pagas — lançamento quitado.</p>
        )}

        {error ? <p className="goal-redistribution-error" role="alert">{error}</p> : null}

        <div className="mc-split-history">
          <strong>Histórico de pagamentos</strong>
          {entry.payments.length ? (
            <ul className="debt-payments-list">
              {entry.payments.map((payment) => (
                <li key={payment.id}>
                  <div>
                    <span className="mc-payer"><PersonAvatar participantKey={payment.participant} size={20} />{getParticipant(payment.participant)?.name}</span>
                    <small>{formatDate(payment.paid_on)}{payment.notes ? ` · ${payment.notes}` : ""}</small>
                  </div>
                  <div className="mc-split-payment-actions">
                    <strong>{formatCents(payment.amount_cents)}</strong>
                    {confirmDelete === payment.id ? (
                      <>
                        <button type="button" className="auth-outline-button" onClick={() => setConfirmDelete(null)} disabled={busy}>Manter</button>
                        <button type="button" className="logout-btn" onClick={() => run(() => apiFetch(`/api/month-control/${entry.id}/payments/${payment.id}`, { method: "DELETE" }))} disabled={busy}>Confirmar exclusão</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="password-btn icon-action-btn" title="Corrigir" aria-label="Corrigir pagamento" onClick={() => { setError(""); setForm({ id: payment.id, participant: payment.participant, amount: centsToInput(payment.amount_cents), paid_on: payment.paid_on, notes: payment.notes || "" }); }} disabled={busy}>✏️</button>
                        <button type="button" className="logout-btn icon-action-btn" title="Excluir" aria-label="Excluir pagamento" onClick={() => setConfirmDelete(payment.id)} disabled={busy}>🗑️</button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mc-hint">Nenhum pagamento registrado ainda.</p>
          )}
        </div>
      </div>
    </ModalShell>
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
    is_split: false,
    participants: [],
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
    is_split: Boolean(editing.is_split),
    participants: normalizeParticipants((editing.shares || []).map((share) => share.participant)),
  } : createEmptyForm(month)));
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(null);
  const [sharesConfirm, setSharesConfirm] = useState(null); // partes mudam com pagamentos já registrados
  const editingPayments = editing?.payments?.length || 0;
  const previewShares = useMemo(
    () => (form.is_split ? splitShares(toCents(form.amount) || 0, form.participants) : []),
    [form.is_split, form.amount, form.participants]
  );
  const toggleParticipant = (key) => setForm((current) => ({
    ...current,
    participants: current.participants.includes(key)
      ? current.participants.filter((item) => item !== key)
      : normalizeParticipants([...current.participants, key]),
  }));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const isBill = hasBillFields(form.entry_type);

  const save = async (force = false, confirmShares = false) => {
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
    if (form.is_split && !form.participants.length) {
      setError("Selecione pelo menos uma pessoa para dividir.");
      return;
    }
    if (editing?.is_split && !form.is_split && editingPayments) {
      setError("Este lançamento já tem pagamentos registrados. Exclua os pagamentos antes de desligar a divisão.");
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
        payment_status: isBill && !form.is_split ? form.payment_status : "pago",
        notes: form.notes,
        is_split: form.is_split,
        participants: form.is_split ? form.participants : [],
        force,
        confirm_shares: confirmShares,
      };
      const saved = editing
        ? await apiFetch(`/api/month-control/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch("/api/month-control", { method: "POST", body: JSON.stringify(payload) });
      onSaved(saved, Boolean(editing));
    } catch (requestError) {
      if (requestError.status === 409 && requestError.payload?.code === "possible_duplicate") {
        setDuplicate(requestError.payload.duplicate);
      } else if (requestError.status === 409 && requestError.payload?.code === "shares_change_confirm") {
        setSharesConfirm({ force, oldShares: requestError.payload.old_shares || [], newShares: requestError.payload.new_shares || [] });
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
      footer={sharesConfirm ? (
        <div className="mc-duplicate-box">
          <p>As partes vão mudar e este lançamento já tem pagamentos registrados. Os pagamentos continuam salvos e os saldos serão recalculados:</p>
          <ul className="mc-shares-diff">
            {normalizeParticipants([...sharesConfirm.oldShares, ...sharesConfirm.newShares].map((share) => share.participant)).map((key) => {
              const before = sharesConfirm.oldShares.find((share) => share.participant === key)?.share_cents || 0;
              const after = sharesConfirm.newShares.find((share) => share.participant === key)?.share_cents || 0;
              return <li key={key}>{getParticipant(key)?.name}: {formatCents(before)} → <strong>{formatCents(after)}</strong></li>;
            })}
          </ul>
          <div className="goal-dialog-buttons">
            <button type="button" className="auth-outline-button" onClick={() => setSharesConfirm(null)} disabled={saving}>Voltar e revisar</button>
            <button type="button" className="auth-submit auth-submit-blue" onClick={() => { const wasForced = sharesConfirm.force; setSharesConfirm(null); save(wasForced, true); }} disabled={saving}>{saving ? "Salvando..." : "Recalcular partes"}</button>
          </div>
        </div>
      ) : duplicate ? (
        <div className="mc-duplicate-box">
          <p>
            Possível duplicidade: já existe <strong>{duplicate.description}</strong> de {formatCents(duplicate.amount_cents)} {duplicate.is_split ? "dividido entre pessoas" : `pago por ${getParticipant(duplicate.payer)?.name}`} em {formatDate(duplicate.entry_date)}.
            Deseja salvar mesmo assim?
          </p>
          <div className="goal-dialog-buttons">
            <button type="button" className="auth-outline-button" onClick={() => setDuplicate(null)} disabled={saving}>Voltar e revisar</button>
            <button type="button" className="auth-submit auth-submit-blue" onClick={() => save(true)} disabled={saving}>{saving ? "Salvando..." : "Salvar mesmo assim"}</button>
          </div>
        </div>
      ) : (
        <div className="goal-dialog-buttons">
          <button type="button" className="auth-outline-button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" form="mc-entry-form" className="auth-submit auth-submit-blue" disabled={saving}>{saving ? "Salvando..." : editing ? "Salvar alterações" : "Salvar lançamento"}</button>
        </div>
      )}
    >
      <form
        id="mc-entry-form"
        className="nt-form"
        onSubmit={(event) => {
          event.preventDefault();
          save(false);
        }}
      >
        <div className="nt-panel">
        <strong className="nt-panel-title">Lançamento</strong>
        <div className="nt-panel-grid">
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
        </div>
        </div>
        <div className="nt-panel nt-tone-green">
        <strong className="nt-panel-title">Pagamento</strong>
        <div className="nt-panel-grid">
        <div className="area-field area-field-wide">
          <label className="mc-split-switch">
            <input
              type="checkbox"
              checked={form.is_split}
              onChange={(event) => update("is_split", event.target.checked)}
            />
            <span className="mc-split-switch-track" aria-hidden="true" />
            <span>Dividir entre pessoas</span>
          </label>
          {form.is_split ? <small className="mc-hint">Dívida ou fatura que será dividida: cada pessoa registra o pagamento da própria parte. Entra no fechamento mesmo pendente.</small> : null}
        </div>
        {form.is_split ? (
        <div className="area-field area-field-wide">
          <label id="mc-split-label">Participantes</label>
          <div className="mc-payer-picker mc-split-picker" role="group" aria-labelledby="mc-split-label">
            {PARTICIPANTS.map((participant) => {
              const selected = form.participants.includes(participant.key);
              const share = previewShares.find((item) => item.participant === participant.key);
              return (
                <button
                  key={participant.key}
                  type="button"
                  aria-pressed={selected}
                  className={selected ? "is-active" : ""}
                  onClick={() => toggleParticipant(participant.key)}
                >
                  <PersonAvatar participantKey={participant.key} size={22} />
                  <span className="mc-split-chip-text">
                    {participant.name}
                    {selected ? <small>{formatCents(share?.share_cents || 0)}</small> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {form.participants.length ? (
            <small className="mc-hint">
              {formatCents(toCents(form.amount) || 0)} ÷ {form.participants.length} — os centavos que sobram ficam com o último selecionado (ordem Nathan → Mauricio → Lene → Isaque).
            </small>
          ) : <small className="mc-hint">Selecione pelo menos uma pessoa.</small>}
          {editingPayments ? <small className="mc-hint">Este lançamento já tem {editingPayments} pagamento{editingPayments === 1 ? "" : "s"}. A parte de ninguém pode ficar menor do que já foi pago.</small> : null}
        </div>
        ) : (
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
        )}
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
            {form.is_split ? (
              form.entry_type === "cartao" ? (
                <div className="area-field area-field-wide">
                  <small className="mc-hint">Registre só o valor total da fatura (as compras do cartão não são lançadas separadamente).</small>
                </div>
              ) : null
            ) : (
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
            )}
          </>
        ) : null}
        </div>
        </div>
        <div className="area-field">
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
  const [splitView, setSplitView] = useState(null); // { id, source: "main" | "history" }
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [historyMonths, setHistoryMonths] = useState([]);
  const [historyMonth, setHistoryMonth] = useState("");
  const [toast, showToast] = useToast();
  const { entries, isLoading, error, setEntries, reload } = useMonthEntries(month);
  const selectedHistoryMonth = historyMonth || month;
  const history = useMonthEntries(selectedHistoryMonth, tab === "historico");

  const filteredEntries = useMemo(
    () => (personFilter === "todos" ? entries : entries.filter((entry) => (
      entry.is_split
        ? (entry.shares || []).some((share) => share.participant === personFilter)
        : entry.payer === personFilter
    ))),
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
    const paymentsCount = entry.payments?.length || 0;
    setConfirm({
      title: "Excluir lançamento",
      message: entry.is_split ? (
        <>
          <p><strong>{entry.description}</strong> · {formatCents(entry.amount_cents)} · dividido entre {entry.shares.length} pessoa{entry.shares.length === 1 ? "" : "s"} · {formatDate(entry.entry_date)}</p>
          <p>As partes de cada pessoa{paymentsCount ? ` e os ${paymentsCount} pagamento${paymentsCount === 1 ? "" : "s"} registrado${paymentsCount === 1 ? "" : "s"}` : ""} deste lançamento também serão excluídos.</p>
        </>
      ) : <p><strong>{entry.description}</strong> · {formatCents(entry.amount_cents)} · {getParticipant(entry.payer)?.name} · {formatDate(entry.entry_date)}</p>,
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

  const handleSplitUpdated = (updated) => {
    const replace = (current) => current.map((item) => (item.id === updated.id ? updated : item));
    if (splitView?.source === "history") history.setEntries(replace);
    else setEntries(replace);
    showToast("Pagamento atualizado.");
  };
  const splitEntry = splitView
    ? (splitView.source === "history" ? history.entries : entries).find((item) => item.id === splitView.id) || null
    : null;

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
        title="Controle do Mês"
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
          <section className="card nt-shell">
            <div className="nt-shell-head">
              <div>
                <strong>Lançamentos de {getMonthLabel(month)}</strong>
                <small>{filteredEntries.length === entries.length ? `${entries.length} lançamento${entries.length === 1 ? "" : "s"}` : `${filteredEntries.length} de ${entries.length} exibidos`}</small>
              </div>
              <button type="button" className="auth-submit auth-submit-blue nt-shell-btn" onClick={() => setModal({ editing: null })}>+ Novo lançamento</button>
            </div>
            <div className="nt-shell-body">
            <div className="nt-toolbar">
              <div className="expense-segmented mc-person-filter" role="radiogroup" aria-label="Filtrar por pessoa">
                {[{ key: "todos", name: "Todos" }, ...PARTICIPANTS].map((option) => (
                  <button key={option.key} type="button" role="radio" aria-checked={personFilter === option.key} className={personFilter === option.key ? "is-active" : ""} onClick={() => setPersonFilter(option.key)}>
                    {option.name}
                  </button>
                ))}
              </div>
            </div>
            {isLoading && !entries.length ? (
              <p className="expense-list-empty">Carregando lançamentos...</p>
            ) : (
              <EntriesTable
                entries={filteredEntries}
                onEdit={(entry) => setModal({ editing: entry })}
                onDelete={handleDelete}
                onMarkPaid={handleMarkPaid}
                onOpenSplit={(entry) => setSplitView({ id: entry.id, source: "main" })}
                busyId={busyId}
                emptyText={entries.length ? "Nenhum lançamento desta pessoa no mês." : `Nenhum lançamento em ${getMonthLabel(month)}.`}
              />
            )}
            </div>
          </section>
        </>
      ) : null}

      {tab === "fechamento" ? <ClosingView entries={entries} /> : null}

      {tab === "historico" ? (
        <>
          <section className="card nt-shell">
            <div className="nt-shell-head">
              <div>
                <strong>Meses anteriores</strong>
                <small>Escolha um mês para ver o fechamento e os lançamentos</small>
              </div>
              <div className="area-field area-history-filter">
                <label htmlFor="mc-history-month">Mês e ano</label>
                <input id="mc-history-month" type="month" style={areaFieldStyle} value={selectedHistoryMonth} onChange={(event) => event.target.value && setHistoryMonth(event.target.value)} />
              </div>
            </div>
            <div className="nt-shell-body">
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
          </section>
          <h2 className="mc-section-title area-month-cell">{getMonthLabel(selectedHistoryMonth)}</h2>
          <PersonCards entries={history.entries} />
          <ClosingView entries={history.entries} />
          <section className="card nt-shell">
            <div className="nt-shell-head">
              <div>
                <strong>Lançamentos</strong>
                <small>{history.entries.length} lançamento{history.entries.length === 1 ? "" : "s"} em {getMonthLabel(selectedHistoryMonth)}</small>
              </div>
            </div>
            <div className="nt-shell-body">
              <EntriesTable entries={history.entries} onOpenSplit={(entry) => setSplitView({ id: entry.id, source: "history" })} emptyText="Nenhum lançamento neste mês." />
            </div>
          </section>
        </>
      ) : null}

      {modal ? <EntryModal month={month} editing={modal.editing} onClose={() => setModal(null)} onSaved={handleSaved} /> : null}
      {splitEntry ? <SplitModal entry={splitEntry} onClose={() => setSplitView(null)} onUpdated={handleSplitUpdated} /> : null}
      {confirm ? <ConfirmDialog {...confirm} busy={Boolean(busyId)} onClose={() => setConfirm(null)} /> : null}
    </>
  );
}
