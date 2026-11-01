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

// Totais por pessoa considerando somente lançamentos com situação "pago".
export function totalsByPayer(entries = []) {
  const totals = Object.fromEntries(PARTICIPANTS.map((item) => [item.key, 0]));
  entries.forEach((entry) => {
    if (entry.payment_status === "pendente") return;
    if (totals[entry.payer] === undefined) return;
    totals[entry.payer] += Number(entry.amount_cents) || 0;
  });
  return totals;
}

// Fechamento (simulação): cada lançamento conta uma vez, no nome de quem pagou.
//  Valor a dividir = total - Isaque; cota = valor / 3 (centavos que sobram: Nathan, Mauricio, Lene);
//  saldo = pago pela pessoa - cota (positivo = a receber, negativo = a pagar).
export function computeClosing(entries = []) {
  const totals = totalsByPayer(entries);
  const totalCents = PARTICIPANTS.reduce((sum, item) => sum + totals[item.key], 0);
  const isaqueCents = totals.isaque;
  const toSplitCents = totalCents - isaqueCents;
  const baseQuota = Math.floor(toSplitCents / SPLIT_KEYS.length);
  const leftover = toSplitCents - baseQuota * SPLIT_KEYS.length;

  const people = SPLIT_KEYS.map((key, index) => {
    const quotaCents = baseQuota + (index < leftover ? 1 : 0);
    const paidCents = totals[key];
    const balanceCents = paidCents - quotaCents;
    return {
      key,
      name: getParticipant(key).name,
      paidCents,
      quotaCents,
      balanceCents,
      status: balanceCents > 0 ? "receber" : balanceCents < 0 ? "pagar" : "equilibrado",
    };
  });

  const pending = entries.filter((entry) => entry.payment_status === "pendente");
  return {
    totalCents,
    isaqueCents,
    toSplitCents,
    people,
    pendingCount: pending.length,
    pendingCents: pending.reduce((sum, entry) => sum + (Number(entry.amount_cents) || 0), 0),
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
    && entry.payer === candidate.payer
  )) || null;
}
