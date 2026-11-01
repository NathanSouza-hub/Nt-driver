// Controle do Mês — regras do fechamento (sem React, sem rede; testável com node:test).
// Todos os valores em CENTAVOS inteiros, para não haver erro de ponto flutuante.

export const PARTICIPANTS = [
  { key: "nathan", name: "Nathan", color: "#2563eb" },
  { key: "mauricio", name: "Mauricio", color: "#16a34a" },
  { key: "lene", name: "Lene", color: "#d97706" },
  { key: "isaque", name: "Isaque", color: "#7c3aed" },
];

// Ordem fixa de quem recebe os centavos que sobram da divisão.
export const SPLIT_KEYS = ["nathan", "mauricio", "lene"];

export const ENTRY_TYPES = [
  { value: "individual", label: "Gasto individual" },
  { value: "geral", label: "Conta geral" },
  { value: "cartao", label: "Cartão" },
];

export const getParticipant = (key) => PARTICIPANTS.find((item) => item.key === key) || null;
export const getEntryTypeLabel = (value) => ENTRY_TYPES.find((item) => item.value === value)?.label || "Gasto individual";
export const hasBillFields = (entryType) => entryType === "geral" || entryType === "cartao";

// "1.234,56" / "1234.56" / 1234.56 -> 123456 centavos. Retorna null se inválido.
export function toCents(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  const text = String(value ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!text) return null;
  let normalized = text;
  if (text.includes(",")) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) normalized = text.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export const formatCents = (cents) => (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const centsToInput = (cents) => (Number(cents || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Totais por pessoa considerando somente lançamentos comuns (sem divisão) com situação "pago".
export function totalsByPayer(entries = []) {
  const totals = Object.fromEntries(PARTICIPANTS.map((item) => [item.key, 0]));
  entries.forEach((entry) => {
    if (entry.is_split) return;
    if (entry.payment_status === "pendente") return;
    if (totals[entry.payer] === undefined) return;
    totals[entry.payer] += Number(entry.amount_cents) || 0;
  });
  return totals;
}

// ---------------------------------------------------------------------------------------------
// Lançamentos divididos ("Dividir entre pessoas").
// Ordem fixa dos participantes; o ÚLTIMO selecionado nessa ordem fica com os centavos que sobram.
export const SPLIT_ORDER = ["nathan", "mauricio", "lene", "isaque"];

export function normalizeParticipants(list = []) {
  const chosen = new Set((Array.isArray(list) ? list : []).map(String));
  return SPLIT_ORDER.filter((key) => chosen.has(key));
}

// Divide o valor (centavos) entre os participantes: cada um recebe o valor arredondado para baixo e
// o último selecionado recebe a diferença. A soma das partes é sempre igual ao valor original.
export function splitShares(totalCents, participants = []) {
  const keys = normalizeParticipants(participants);
  const total = Number(totalCents);
  if (!keys.length || !Number.isInteger(total) || total < 0) return [];
  const base = Math.floor(total / keys.length);
  return keys.map((participant, index) => ({
    participant,
    share_cents: index === keys.length - 1 ? total - base * (keys.length - 1) : base,
  }));
}

export const SHARE_STATUS_LABELS = { pendente: "Pendente", parcial: "Parcial", pago: "Pago" };
export const SPLIT_STATUS_LABELS = { pendente: "Pendente", parcial: "Parcial", quitado: "Quitado" };

export function shareStatus(shareCents, paidCents) {
  if (paidCents >= shareCents) return "pago";
  return paidCents > 0 ? "parcial" : "pendente";
}

// Responsabilidade, pago e restante de cada participante de um lançamento dividido.
export function summarizeSplitEntry(entry = {}) {
  const payments = Array.isArray(entry.payments) ? entry.payments : [];
  const rows = (Array.isArray(entry.shares) ? entry.shares : [])
    .slice()
    .sort((left, right) => SPLIT_ORDER.indexOf(left.participant) - SPLIT_ORDER.indexOf(right.participant))
    .map((share) => {
      const shareCents = Number(share.share_cents) || 0;
      const paidCents = payments
        .filter((payment) => payment.participant === share.participant)
        .reduce((sum, payment) => sum + (Number(payment.amount_cents) || 0), 0);
      return {
        participant: share.participant,
        shareCents,
        paidCents,
        remainingCents: Math.max(shareCents - paidCents, 0),
        status: shareStatus(shareCents, paidCents),
      };
    });
  const totalCents = Number(entry.amount_cents) || 0;
  const paidCents = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const remainingCents = rows.reduce((sum, row) => sum + row.remainingCents, 0);
  const status = remainingCents === 0 ? "quitado" : paidCents > 0 ? "parcial" : "pendente";
  return { rows, totalCents, paidCents, remainingCents, status };
}

// Fechamento (simulação). Lançamentos comuns: cada um conta uma vez, no nome de quem pagou, e só
// quando pago. Valor a dividir = total - Isaque; cota = valor / 3 (centavos que sobram: Nathan,
// Mauricio, Lene); saldo comum = pago pela pessoa - cota.
// Lançamentos divididos entram mesmo pendentes e NÃO entram na divisão por três: cada participante
// assume só a parte dele. Resultado final = saldo comum + (pago nas partes - partes).
// Os pagamentos da parte do Isaque não contam como "pago por fora".
export function computeClosing(entries = []) {
  const commonEntries = entries.filter((entry) => !entry.is_split);
  const splitEntries = entries.filter((entry) => entry.is_split);

  const totals = totalsByPayer(commonEntries);
  const totalCents = PARTICIPANTS.reduce((sum, item) => sum + totals[item.key], 0);
  const isaqueCents = totals.isaque;
  const toSplitCents = totalCents - isaqueCents;
  const baseQuota = Math.floor(toSplitCents / SPLIT_KEYS.length);
  const leftover = toSplitCents - baseQuota * SPLIT_KEYS.length;

  const splitByPerson = Object.fromEntries(PARTICIPANTS.map((item) => [item.key, { shareCents: 0, paidCents: 0, remainingCents: 0 }]));
  let splitTotalCents = 0;
  splitEntries.forEach((entry) => {
    const summary = summarizeSplitEntry(entry);
    splitTotalCents += summary.totalCents;
    summary.rows.forEach((row) => {
      const target = splitByPerson[row.participant];
      if (!target) return;
      target.shareCents += row.shareCents;
      target.paidCents += row.paidCents;
      target.remainingCents += row.remainingCents;
    });
  });

  const people = SPLIT_KEYS.map((key, index) => {
    const quotaCents = baseQuota + (index < leftover ? 1 : 0);
    const paidCents = totals[key];
    const commonBalanceCents = paidCents - quotaCents;
    const split = splitByPerson[key];
    const balanceCents = commonBalanceCents + split.paidCents - split.shareCents;
    return {
      key,
      name: getParticipant(key).name,
      paidCents,
      quotaCents,
      commonBalanceCents,
      splitShareCents: split.shareCents,
      splitPaidCents: split.paidCents,
      splitRemainingCents: split.remainingCents,
      balanceCents,
      status: balanceCents > 0 ? "receber" : balanceCents < 0 ? "pagar" : "equilibrado",
    };
  });

  const pending = commonEntries.filter((entry) => entry.payment_status === "pendente");
  const pendingCents = pending.reduce((sum, entry) => sum + (Number(entry.amount_cents) || 0), 0);
  const splitPaidCents = PARTICIPANTS.reduce((sum, item) => sum + splitByPerson[item.key].paidCents, 0);
  const splitRemainingCents = PARTICIPANTS.reduce((sum, item) => sum + splitByPerson[item.key].remainingCents, 0);
  return {
    totalCents,
    isaqueCents,
    toSplitCents,
    people,
    pendingCount: pending.length,
    pendingCents,
    split: {
      count: splitEntries.length,
      totalCents: splitTotalCents,
      paidCents: splitPaidCents,
      remainingCents: splitRemainingCents,
      people: PARTICIPANTS.map((item) => ({ key: item.key, name: item.name, ...splitByPerson[item.key] })),
    },
    // Ainda devido a credores (faturas/contas): comuns pendentes + o que falta nas partes divididas.
    creditorsPendingCents: pendingCents + splitRemainingCents,
  };
}

const normalizeText = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Possível duplicidade: mesmo mês, mesma descrição (sem acentos/maiúsculas), mesmo valor e mesma pessoa.
export function findPossibleDuplicate(entries = [], candidate) {
  return entries.find((entry) => (
    entry.id !== candidate.id
    && String(entry.entry_date || "").slice(0, 7) === String(candidate.entry_date || "").slice(0, 7)
    && normalizeText(entry.description) === normalizeText(candidate.description)
    && Number(entry.amount_cents) === Number(candidate.amount_cents)
    && Boolean(entry.is_split) === Boolean(candidate.is_split)
    && (candidate.is_split || entry.payer === candidate.payer)
  )) || null;
}
