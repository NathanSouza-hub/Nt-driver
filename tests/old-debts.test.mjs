// Dívidas Antigas — regras de cálculo (node:test, sem dependências externas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDebts, summarizeDebt, summarizeDebts, validateOriginal, validatePayment } from "../nt/old-debts-logic.js";

const debt = (id, originalCents, payments = [], extra = {}) => ({ id, original_cents: originalCents, payments, description: `Dívida ${id}`, creditor: null, created_at: `2026-10-${String(id).padStart(2, "0")} 10:00:00`, ...extra });
const pay = (id, cents, paidOn = "2026-10-20") => ({ id, amount_cents: cents, paid_on: paidOn });

test("exemplo do item 8: 5.000 - 500 = 4.500 e continua em aberto", () => {
  const summary = summarizeDebt(debt(1, 500000, [pay(1, 50000)]));
  assert.deepEqual([summary.paidCents, summary.remainingCents, summary.status], [50000, 450000, "aberto"]);
});

test("vários pagamentos atualizam total pago e saldo; histórico do mais recente para o mais antigo", () => {
  const summary = summarizeDebt(debt(1, 100000, [pay(1, 10000, "2026-09-01"), pay(2, 25050, "2026-10-15"), pay(3, 4950, "2026-08-10")]));
  assert.deepEqual([summary.paidCents, summary.remainingCents], [40000, 60000]);
  assert.deepEqual(summary.payments.map((item) => item.id), [2, 1, 3]);
});

test("saldo zero = Quitada; aumentar o valor ou excluir pagamento volta para Em aberto", () => {
  const paid = debt(1, 30000, [pay(1, 10000), pay(2, 20000)]);
  assert.equal(summarizeDebt(paid).status, "quitada");
  assert.equal(summarizeDebt({ ...paid, original_cents: 35000 }).status, "aberto");
  assert.equal(summarizeDebt({ ...paid, payments: [pay(1, 10000)] }).status, "aberto");
});

test("bloqueio de pagamento acima do saldo (informa o máximo)", () => {
  const item = debt(1, 500000, [pay(1, 50000)]);
  const tooMuch = validatePayment(item, 450001);
  assert.deepEqual([tooMuch.ok, tooMuch.maxCents], [false, 450000]);
  assert.equal(validatePayment(item, 450000).ok, true);
  assert.equal(validatePayment(item, 0).ok, false);
  // edição do pagamento de 500: pode ir até 500 + saldo
  assert.deepEqual([validatePayment(item, 500000, 50000).ok, validatePayment(item, 500001, 50000).ok], [true, false]);
});

test("correção do valor original não pode ficar abaixo do total pago", () => {
  const item = debt(1, 500000, [pay(1, 120000)]);
  const low = validateOriginal(item, 119999);
  assert.deepEqual([low.ok, low.minCents], [false, 120000]);
  assert.equal(validateOriginal(item, 120000).ok, true);
  assert.equal(validateOriginal(item, 0).ok, false);
});

test("cards do topo consideram todas as dívidas", () => {
  const all = [debt(1, 500000, [pay(1, 50000)]), debt(2, 20000, [pay(2, 20000)]), debt(3, 7550)];
  assert.deepEqual(summarizeDebts(all), { totalCents: 527550, paidCents: 70000, remainingCents: 457550, count: 3 });
});

test("filtros, pesquisa sem acento/maiúsculas e ordenação", () => {
  const all = [
    debt(1, 1000, [pay(1, 1000)], { description: "Faculdade Anhanguera", creditor: "Anhanguera" }),
    debt(2, 5000, [], { description: "Empréstimo do João", creditor: null }),
    debt(3, 9000, [pay(2, 100)], { description: "Carro", creditor: "Banco Itaú" }),
    debt(4, 300, [pay(3, 300)], { description: "Celular", creditor: "Loja" }),
  ];
  assert.deepEqual(filterDebts(all).map((item) => item.id), [3, 2, 4, 1], "abertas primeiro, recentes primeiro");
  assert.deepEqual(filterDebts(all, { status: "aberto" }).map((item) => item.id), [3, 2]);
  assert.deepEqual(filterDebts(all, { status: "quitada" }).map((item) => item.id), [4, 1]);
  assert.deepEqual(filterDebts(all, { search: "emprestimo" }).map((item) => item.id), [2]);
  assert.deepEqual(filterDebts(all, { search: "ITAU" }).map((item) => item.id), [3]);
  assert.deepEqual(filterDebts(all, { status: "aberto", search: "anhanguera" }), []);
});
