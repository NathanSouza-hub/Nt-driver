// Controle do Mês — fechamento (node:test, sem dependências externas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeClosing, findPossibleDuplicate, toCents, totalsByPayer } from "../nt/month-control-logic.js";

const entry = (payer, cents, extra = {}) => ({ payer, amount_cents: cents, payment_status: "pago", entry_type: "individual", entry_date: "2026-11-05", ...extra });
const sum = (values) => values.reduce((total, value) => total + value, 0);
const entriesFrom = ([n, m, l, i]) => [["nathan", n], ["mauricio", m], ["lene", l], ["isaque", i]].filter(([, cents]) => cents > 0).map(([payer, cents]) => entry(payer, cents));

test("exemplo do item 7: 1000/500/800 + Isaque 700", () => {
  const closing = computeClosing(entriesFrom([100000, 50000, 80000, 70000]));
  assert.equal(closing.totalCents, 300000);
  assert.equal(closing.isaqueCents, 70000);
  assert.equal(closing.toSplitCents, 230000);
  assert.deepEqual(closing.people.map((person) => person.quotaCents), [76667, 76667, 76666]);
  assert.deepEqual(closing.people.map((person) => person.balanceCents), [23333, -26667, 3334]);
  assert.deepEqual(closing.people.map((person) => person.status), ["receber", "pagar", "receber"]);
});

test("arredondamento: soma das cotas = valor dividido e soma dos saldos = 0", () => {
  for (const values of [[1, 0, 0, 0], [2, 0, 0, 0], [100, 0, 0, 0], [33333, 1, 7, 5], [99999, 12345, 1, 0], [0, 0, 0, 500], [12345, 67890, 11111, 2222]]) {
    const closing = computeClosing(entriesFrom(values));
    assert.equal(sum(closing.people.map((person) => person.quotaCents)), closing.toSplitCents, String(values));
    assert.equal(sum(closing.people.map((person) => person.balanceCents)), 0, String(values));
  }
});

test("centavos que sobram vão para Nathan, depois Mauricio, depois Lene", () => {
  assert.deepEqual(computeClosing([entry("nathan", 1)]).people.map((person) => person.quotaCents), [1, 0, 0]);
  assert.deepEqual(computeClosing([entry("nathan", 2)]).people.map((person) => person.quotaCents), [1, 1, 0]);
  assert.deepEqual(computeClosing([entry("nathan", 3)]).people.map((person) => person.quotaCents), [1, 1, 1]);
});

test("pendentes não entram no fechamento até serem pagos", () => {
  const base = [entry("nathan", 30000), entry("lene", 15000, { entry_type: "geral", payment_status: "pendente" })];
  const closing = computeClosing(base);
  assert.equal(closing.totalCents, 30000);
  assert.equal(closing.pendingCount, 1);
  assert.equal(closing.pendingCents, 15000);
  assert.equal(computeClosing([base[0], { ...base[1], payment_status: "pago" }]).totalCents, 45000);
});

test("contas gerais e cartão contam uma vez, no nome de quem pagou", () => {
  const totals = totalsByPayer([entry("mauricio", 62700, { entry_type: "cartao" }), entry("mauricio", 12000, { entry_type: "geral" }), entry("lene", 5000)]);
  assert.deepEqual(totals, { nathan: 0, mauricio: 74700, lene: 5000, isaque: 0 });
});

test("equilibrado quando o saldo é zero; Isaque não recebe cota", () => {
  const closing = computeClosing(entriesFrom([10000, 10000, 10000, 9900]));
  assert.deepEqual(closing.people.map((person) => person.status), ["equilibrado", "equilibrado", "equilibrado"]);
  assert.equal(closing.people.length, 3);
});

test("valores em centavos e aviso de duplicidade", () => {
  assert.equal(toCents("1.234,56"), 123456);
  assert.equal(toCents("627"), 62700);
  assert.equal(toCents("0,1"), 10);
  assert.equal(toCents("abc"), null);
  assert.equal(toCents("1,234"), null);
  const existing = [{ id: 1, ...entry("nathan", 12000), description: "Internet" }];
  assert.ok(findPossibleDuplicate(existing, { ...entry("nathan", 12000), description: "  internet " }));
  assert.equal(findPossibleDuplicate(existing, { ...entry("lene", 12000), description: "Internet" }), null);
  assert.equal(findPossibleDuplicate(existing, { ...entry("nathan", 12000, { entry_date: "2026-12-01" }), description: "Internet" }), null);
  assert.equal(findPossibleDuplicate(existing, { id: 1, ...entry("nathan", 12000), description: "Internet" }), null, "o próprio lançamento em edição");
});
