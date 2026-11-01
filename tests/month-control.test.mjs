// Controle do Mês — fechamento (node:test, sem dependências externas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeClosing, findPossibleDuplicate, splitShares, summarizeSplitEntry, toCents, totalsByPayer } from "../nt/month-control-logic.js";

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

// ---------------------------------------------------------------------------------------------
// Lançamentos divididos entre pessoas
const splitEntry = (amount, participants, payments = [], extra = {}) => ({
  id: extra.id || 1,
  is_split: true,
  amount_cents: amount,
  payer: participants[0],
  payment_status: "pendente",
  entry_type: "cartao",
  entry_date: "2026-11-05",
  shares: splitShares(amount, participants),
  payments: payments.map(([participant, cents]) => ({ participant, amount_cents: cents })),
  ...extra,
});
const shareMap = (shares) => Object.fromEntries(shares.map((share) => [share.participant, share.share_cents]));

test("divisão: 1.600 entre três = 533,33 / 533,33 / 533,34", () => {
  assert.deepEqual(shareMap(splitShares(160000, ["nathan", "mauricio", "lene"])), { nathan: 53333, mauricio: 53333, lene: 53334 });
});

test("divisão: quatro pessoas, duas pessoas e uma pessoa", () => {
  assert.deepEqual(shareMap(splitShares(100001, ["isaque", "lene", "mauricio", "nathan"])), { nathan: 25000, mauricio: 25000, lene: 25000, isaque: 25001 });
  assert.deepEqual(shareMap(splitShares(10001, ["lene", "nathan"])), { nathan: 5000, lene: 5001 });
  assert.deepEqual(shareMap(splitShares(777, ["mauricio"])), { mauricio: 777 });
});

test("divisão: o último na ordem fixa recebe os centavos, independente da ordem de seleção", () => {
  assert.deepEqual(splitShares(100, ["lene", "nathan", "mauricio"]).map((share) => share.participant), ["nathan", "mauricio", "lene"]);
  assert.deepEqual(shareMap(splitShares(200, ["mauricio", "isaque"])), { mauricio: 100, isaque: 100 });
  assert.deepEqual(shareMap(splitShares(201, ["mauricio", "isaque"])), { mauricio: 100, isaque: 101 });
});

test("divisão: a soma das partes é sempre o valor original", () => {
  const groups = [["nathan"], ["nathan", "lene"], ["nathan", "mauricio", "lene"], ["nathan", "mauricio", "lene", "isaque"], ["mauricio", "isaque"]];
  for (const amount of [1, 2, 3, 5, 99, 100, 101, 160000, 140000, 333333, 99999999]) {
    for (const group of groups) {
      const shares = splitShares(amount, group);
      assert.equal(sum(shares.map((share) => share.share_cents)), amount, `${amount} ${group}`);
      assert.ok(shares.every((share) => share.share_cents >= 0));
    }
  }
  assert.deepEqual(splitShares(1000, []), []);
  assert.deepEqual(splitShares(1000, ["fulano"]), []);
});

test("Isaque só participa quando selecionado", () => {
  assert.equal(splitShares(160000, ["nathan", "mauricio", "lene"]).some((share) => share.participant === "isaque"), false);
  const closing = computeClosing([splitEntry(160000, ["nathan", "mauricio", "lene"])]);
  assert.equal(closing.split.people.find((person) => person.key === "isaque").shareCents, 0);
});

test("saldos individuais: pagamento total, parcial e situação do lançamento", () => {
  const pending = summarizeSplitEntry(splitEntry(160000, ["nathan", "mauricio", "lene"]));
  assert.equal(pending.status, "pendente");
  assert.equal(pending.remainingCents, 160000);

  const item4 = summarizeSplitEntry(splitEntry(160000, ["nathan", "mauricio", "lene"], [["mauricio", 53333]]));
  assert.deepEqual(item4.rows.map((row) => [row.participant, row.shareCents, row.paidCents, row.remainingCents, row.status]), [
    ["nathan", 53333, 0, 53333, "pendente"],
    ["mauricio", 53333, 53333, 0, "pago"],
    ["lene", 53334, 0, 53334, "pendente"],
  ]);
  assert.equal(item4.status, "parcial");
  assert.equal(item4.remainingCents, 106667);

  const partial = summarizeSplitEntry(splitEntry(160000, ["nathan", "mauricio", "lene"], [["lene", 20000], ["lene", 10000]]));
  assert.equal(partial.rows[2].status, "parcial");
  assert.equal(partial.rows[2].remainingCents, 23334);

  const done = summarizeSplitEntry(splitEntry(160000, ["nathan", "mauricio", "lene"], [["nathan", 53333], ["mauricio", 53333], ["lene", 53334]]));
  assert.equal(done.status, "quitado");
  assert.equal(done.remainingCents, 0);
});

test("fechamento — exemplo do item 2: pendente entra no fechamento", () => {
  const closing = computeClosing([splitEntry(160000, ["nathan", "mauricio", "lene"])]);
  assert.deepEqual(closing.people.map((person) => person.balanceCents), [-53333, -53333, -53334]);
  assert.equal(closing.creditorsPendingCents, 160000);
  assert.equal(closing.totalCents, 0, "dividido não entra na divisão por três");
  assert.equal(closing.split.totalCents, 160000);
});

test("fechamento — exemplo do item 4: Mauricio pagou a parte dele", () => {
  const closing = computeClosing([splitEntry(160000, ["nathan", "mauricio", "lene"], [["mauricio", 53333]])]);
  assert.deepEqual(closing.people.map((person) => person.balanceCents), [-53333, 0, -53334]);
  assert.deepEqual(closing.people.map((person) => person.status), ["pagar", "equilibrado", "pagar"]);
  assert.equal(closing.creditorsPendingCents, 106667);
});

test("fechamento — exemplo do item 5 (a): 1.400 comum pago pelo Nathan + fatura dividida pendente", () => {
  const closing = computeClosing([entry("nathan", 140000, { entry_type: "geral" }), splitEntry(160000, ["nathan", "mauricio", "lene"])]);
  assert.deepEqual(closing.people.map((person) => person.quotaCents), [46667, 46667, 46666]);
  assert.deepEqual(closing.people.map((person) => person.commonBalanceCents), [93333, -46667, -46666]);
  assert.deepEqual(closing.people.map((person) => person.balanceCents), [40000, -100000, -100000]);
  assert.equal(closing.creditorsPendingCents, 160000);
  assert.equal(sum(closing.people.map((person) => person.balanceCents)), -closing.creditorsPendingCents);
});

test("fechamento — exemplo do item 5 (b): os dois lançamentos divididos e pendentes", () => {
  const closing = computeClosing([
    splitEntry(160000, ["nathan", "mauricio", "lene"], [], { id: 1 }),
    splitEntry(140000, ["nathan", "mauricio", "lene"], [], { id: 2 }),
  ]);
  assert.deepEqual(closing.people.map((person) => person.balanceCents), [-99999, -99999, -100002]);
  assert.equal(closing.split.totalCents, 300000);
  assert.equal(closing.creditorsPendingCents, 300000);
});

test("participantes diferentes por lançamento e Isaque com parte própria (não abate o pago por fora)", () => {
  const closing = computeClosing([
    entry("nathan", 30000),
    entry("isaque", 9000),
    splitEntry(40000, ["nathan", "mauricio", "lene", "isaque"], [["isaque", 10000]], { id: 7 }),
    splitEntry(10001, ["mauricio", "lene"], [], { id: 8 }),
  ]);
  assert.equal(closing.isaqueCents, 9000, "pagamento da parte do Isaque não entra no abatimento");
  assert.equal(closing.toSplitCents, 30000);
  assert.deepEqual(closing.people.map((person) => person.splitShareCents), [10000, 15000, 15001]);
  const isaque = closing.split.people.find((person) => person.key === "isaque");
  assert.deepEqual([isaque.shareCents, isaque.paidCents, isaque.remainingCents], [10000, 10000, 0]);
  assert.equal(closing.creditorsPendingCents, 40001);
});

test("lançamentos comuns: o fechamento continua igual com ou sem divididos no mês", () => {
  const common = entriesFrom([100000, 50000, 80000, 70000]);
  const before = computeClosing(common);
  const after = computeClosing([...common, splitEntry(30000, ["nathan", "mauricio", "lene"], [["nathan", 10000], ["mauricio", 10000], ["lene", 10000]])]);
  assert.deepEqual(after.people.map((person) => person.quotaCents), before.people.map((person) => person.quotaCents));
  assert.deepEqual(after.people.map((person) => person.commonBalanceCents), before.people.map((person) => person.balanceCents));
  assert.deepEqual(after.people.map((person) => person.balanceCents), before.people.map((person) => person.balanceCents), "dividido quitado não muda o resultado");
  assert.equal(after.totalCents, before.totalCents);
  assert.deepEqual(totalsByPayer([...common, splitEntry(30000, ["nathan"])]), totalsByPayer(common));
});

test("duplicidade: dividido só conflita com outro dividido", () => {
  const existing = [{ ...splitEntry(160000, ["nathan", "mauricio", "lene"]), description: "Fatura do cartão" }];
  assert.ok(findPossibleDuplicate(existing, { ...splitEntry(160000, ["lene"], [], { id: 9 }), description: "fatura do cartao" }));
  assert.equal(findPossibleDuplicate(existing, { ...entry("nathan", 160000), id: 9, description: "Fatura do cartão" }), null);
});
