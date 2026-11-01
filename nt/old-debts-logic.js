// Dívidas Antigas — regras de cálculo (sem React, sem rede; testável com node:test).
// Valores em CENTAVOS inteiros. Total pago, saldo e situação são sempre derivados dos pagamentos.

export const DEBT_CATEGORIES = [
  { value: "faculdade", label: "Faculdade" },
  { value: "veiculo", label: "Veículo" },
  { value: "negativada", label: "Negativada" },
  { value: "emprestimo", label: "Empréstimo" },
  { value: "pessoal", label: "Pessoal" },
  { value: "outras", label: "Outras" },
];

export const getCategoryLabel = (value) => DEBT_CATEGORIES.find((item) => item.value === value)?.label || "Outras";

export function summarizeDebt(debt) {
  const payments = Array.isArray(debt.payments) ? debt.payments : [];
  const originalCents = Number(debt.original_cents) || 0;
  const paidCents = payments.reduce((sum, payment) => sum + (Number(payment.amount_cents) || 0), 0);
  const remainingCents = Math.max(0, originalCents - paidCents);
  return {
    ...debt,
    payments: [...payments].sort((left, right) => String(right.paid_on).localeCompare(String(left.paid_on)) || Number(right.id) - Number(left.id)),
    originalCents,
    paidCents,
    remainingCents,
    status: remainingCents === 0 ? "quitada" : "aberto",
  };
}

// Cards do topo: consideram todas as dívidas (não dependem de filtro/pesquisa).
export function summarizeDebts(debts = []) {
  const summarized = debts.map(summarizeDebt);
  const totalCents = summarized.reduce((sum, debt) => sum + debt.originalCents, 0);
  const paidCents = summarized.reduce((sum, debt) => sum + debt.paidCents, 0);
  return { totalCents, paidCents, remainingCents: totalCents - paidCents, count: summarized.length };
}

// Pagamento novo (ou edição: informe o valor antigo em replacingCents) não pode passar do saldo.
export function validatePayment(debt, amountCents, replacingCents = 0) {
  const { remainingCents } = summarizeDebt(debt);
  const maxCents = remainingCents + (Number(replacingCents) || 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, maxCents, error: "Informe um valor maior que zero." };
  if (amountCents > maxCents) return { ok: false, maxCents, error: "O valor é maior que o saldo restante." };
  return { ok: true, maxCents };
}

// Correção do valor original: nunca abaixo do total já pago.
export function validateOriginal(debt, originalCents) {
  const { paidCents } = summarizeDebt(debt);
  if (!Number.isInteger(originalCents) || originalCents <= 0) return { ok: false, minCents: Math.max(paidCents, 1), error: "Informe um valor maior que zero." };
  if (originalCents < paidCents) return { ok: false, minCents: paidCents, error: "O valor original não pode ser menor que o total já pago." };
  return { ok: true, minCents: paidCents };
}

const normalizeText = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Lista: filtro (todas | aberto | quitada) + pesquisa por descrição/credor (sem acentos e maiúsculas).
// Ordem: em aberto primeiro, depois quitadas; dentro de cada grupo, as mais recentes primeiro.
export function filterDebts(debts = [], { status = "todas", search = "" } = {}) {
  const term = normalizeText(search);
  return debts
    .map(summarizeDebt)
    .filter((debt) => status === "todas" || debt.status === status)
    .filter((debt) => !term || normalizeText(debt.description).includes(term) || normalizeText(debt.creditor).includes(term))
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "aberto" ? -1 : 1;
      return String(right.created_at || "").localeCompare(String(left.created_at || "")) || Number(right.id) - Number(left.id);
    });
}
