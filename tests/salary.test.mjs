// Regras de cálculo da área Salário (node:test, sem dependências externas).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSalaryReceiptsForMonth,
  getSalaryTotalForMonth,
  getSalaryTotalsByType,
} from "../nt/finance-areas.js";

const receipts = [
  { id: 1, receipt_type: "salario", amount: 3000, date: "2026-09-05", recurrence: "mensal", recurrence_end_month: null },
  { id: 2, receipt_type: "vr", amount: 600, date: "2026-10-01", recurrence: "mensal", recurrence_end_month: "2026-11" },
  { id: 3, receipt_type: "va", amount: 400.5, date: "2026-10-01", recurrence: "unica" },
  { id: 4, receipt_type: "vt", amount: 220, date: "2026-10-02", recurrence: "unica" },
  { id: 5, receipt_type: "bonus", amount: 250.25, date: "2026-10-20", recurrence: "unica" },
  { id: 6, receipt_type: "horas_extras", amount: 180, date: "2026-11-15", recurrence: "unica" },
];

test("card verde soma todos os tipos, inclusive VR, VA e VT", () => {
  assert.equal(getSalaryTotalForMonth(receipts, "2026-10"), 3000 + 600 + 400.5 + 220 + 250.25);
});

test("soma por tipo é igual ao total do mês (Resumo)", () => {
  for (const month of ["2026-09", "2026-10", "2026-11", "2026-12"]) {
    const byType = getSalaryTotalsByType(receipts, month);
    const sum = Math.round(byType.reduce((total, type) => total + type.total, 0) * 100) / 100;
    assert.equal(sum, getSalaryTotalForMonth(receipts, month), month);
  }
  assert.deepEqual(
    getSalaryTotalsByType(receipts, "2026-10").map((type) => [type.value, type.total]),
    [["salario", 3000], ["vr", 600], ["va", 400.5], ["vt", 220], ["bonus", 250.25]]
  );
});

test("histórico por mês respeita a data e a recorrência", () => {
  assert.deepEqual(getSalaryReceiptsForMonth(receipts, "2026-08"), []);
  assert.deepEqual(getSalaryReceiptsForMonth(receipts, "2026-09").map((item) => item.id), [1]);
  assert.deepEqual(getSalaryReceiptsForMonth(receipts, "2026-11").map((item) => item.id).sort(), [1, 2, 6]);
  assert.deepEqual(getSalaryReceiptsForMonth(receipts, "2026-12").map((item) => item.id), [1], "VR encerrado em nov");
  assert.equal(getSalaryReceiptsForMonth(receipts, "2027-02")[0].month_date, "2027-02-05");
});
