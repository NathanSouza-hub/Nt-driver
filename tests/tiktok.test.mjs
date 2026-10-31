// Totais da planilha do TikTok (node:test, sem dependências externas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTikTokSheet, getTikTokSalesTotal, getTikTokSummary, parseMoneyInput } from "../nt/finance-areas.js";

const sellers = [{ id: 1, name: "Isabela" }, { id: 2, name: "Amanda" }, { id: 3, name: "Carlos" }];
// Exemplo do enunciado (novembro) + uma venda de outubro que não pode entrar em novembro.
const sales = [
  { seller_id: 1, date: "2026-11-01", amount: 55.1 }, { seller_id: 2, date: "2026-11-01", amount: 120 }, { seller_id: 3, date: "2026-11-01", amount: 98 },
  { seller_id: 1, date: "2026-11-02", amount: 23.1 }, { seller_id: 2, date: "2026-11-02", amount: 101.7 }, { seller_id: 3, date: "2026-11-02", amount: 22 },
  { seller_id: 1, date: "2026-11-03", amount: 55.55 },
  { seller_id: 1, date: "2026-10-31", amount: 999 },
];

test("total diário, total por vendedor e total geral (exemplo do enunciado)", () => {
  const sheet = buildTikTokSheet(sellers, sales, "2026-11");
  assert.equal(sheet.days.length, 30);
  assert.deepEqual(sheet.days.slice(0, 4).map((day) => day.total), [273.1, 146.8, 55.55, 0]);
  assert.deepEqual(sheet.sellerTotals.map((item) => item.total), [133.75, 221.7, 120]);
  assert.equal(sheet.grandTotal, 475.45);
});

test("soma das colunas = soma das linhas = total geral", () => {
  const sheet = buildTikTokSheet(sellers, sales, "2026-11");
  const byRows = Math.round(sheet.days.reduce((sum, day) => sum + day.total, 0) * 100) / 100;
  const byColumns = Math.round(sheet.sellerTotals.reduce((sum, item) => sum + item.total, 0) * 100) / 100;
  assert.equal(byRows, sheet.grandTotal);
  assert.equal(byColumns, sheet.grandTotal);
});

test("datas compactas com dia da semana", () => {
  const sheet = buildTikTokSheet(sellers, sales, "2026-10");
  assert.deepEqual([sheet.days[0].label, sheet.days[0].weekday], ["01/10", "qui"]);
  assert.equal(sheet.days.length, 31);
  assert.equal(sheet.grandTotal, 999, "outubro só tem a venda de 31/10");
  assert.equal(buildTikTokSheet(sellers, [], "2028-02").days.length, 29);
});

test("vendedor removido (fora da lista visível) continua no total geral do mês", () => {
  const sheet = buildTikTokSheet(sellers.slice(0, 2), sales, "2026-11");
  assert.equal(sheet.grandTotal, getTikTokSalesTotal(sales, "2026-11"));
});

test("resumo: receitas, despesas próprias e resultado líquido do mês selecionado", () => {
  const expenses = [
    { id: 1, amount: 80, date: "2026-11-10" },
    { id: 2, amount: 45.45, date: "2026-11-20" },
    { id: 3, amount: 500, date: "2026-12-01" },
  ];
  assert.deepEqual(getTikTokSummary(sales, expenses, "2026-11"), { revenue: 475.45, expenses: 125.45, net: 350 });
  assert.deepEqual(getTikTokSummary(sales, expenses, "2026-12"), { revenue: 0, expenses: 500, net: -500 });
});

test("valores digitados nas células", () => {
  assert.equal(parseMoneyInput("55,10"), 55.1);
  assert.equal(parseMoneyInput("1.234,56"), 1234.56);
  assert.equal(parseMoneyInput(""), null);
  assert.ok(Number.isNaN(parseMoneyInput("abc")));
});
