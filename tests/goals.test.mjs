// Regras da página Metas (node:test, sem dependências externas).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoDistribution,
  buildGoalRows,
  buildRedistributionPreview,
  getDistributionStatus,
  getPendingDifferences,
} from "../nt/goals-logic.js";

const MONTH = "2026-11"; // 30 dias
const TODAY = "2026-11-02";

// Exemplo do item 3.3: 01/11 meta 600, realizado 500; 28/11 e 29/11 com 550 cada.
const exampleDays = {
  1: { goal: 600, origin: "manual" },
  28: { goal: 550, origin: "manual" },
  29: { goal: 550, origin: "manual" },
};

test("cada dia tem meta própria; dias sem meta ficam sem meta (sem distribuição automática)", () => {
  const rows = buildGoalRows({ month: MONTH, today: TODAY, days: exampleDays, doneByDay: { 1: 500 } });
  assert.equal(rows.length, 30);
  assert.equal(rows[0].goal, 600);
  assert.equal(rows[1].goal, null, "dia 02 continua sem meta");
  assert.equal(rows[27].goal, 550);
  assert.equal(rows.filter((row) => row.goal !== null).length, 3);
});

test("status: vermelho (não atingida), verde (atingida), amarelo (folga), neutro (não preenchido)", () => {
  const rows = buildGoalRows({
    month: MONTH,
    today: "2026-11-10",
    days: { 1: { goal: 600 }, 2: { goal: 300 }, 3: { goal: 300, dayOff: true } },
    doneByDay: { 1: 500, 2: 300 },
  });
  assert.deepEqual(rows.slice(0, 5).map((row) => row.status), ["missed", "hit", "dayoff", "empty", "empty"]);
});

test("validação da meta mensal: menor bloqueia e informa quanto falta; igual e maior permitem", () => {
  const rows = (goals) => buildGoalRows({ month: MONTH, today: TODAY, days: goals });
  const lower = getDistributionStatus(rows({ 1: { goal: 4000 }, 2: { goal: 5000 } }), 10000);
  assert.deepEqual([lower.canConfirm, lower.missing, lower.distributed], [false, 1000, 9000]);
  const equal = getDistributionStatus(rows({ 1: { goal: 4000 }, 2: { goal: 6000 } }), 10000);
  assert.deepEqual([equal.canConfirm, equal.missing], [true, 0]);
  const higher = getDistributionStatus(rows({ 1: { goal: 7000 }, 2: { goal: 6000 } }), 10000);
  assert.deepEqual([higher.canConfirm, higher.excess], [true, 3000]);
  const withDayOff = getDistributionStatus(rows({ 1: { goal: 10000, dayOff: true } }), 10000);
  assert.equal(withDayOff.canConfirm, false, "meta de dia de folga não conta");
});

test("resultado abaixo da meta gera pergunta de redistribuição (falta)", () => {
  const rows = buildGoalRows({ month: MONTH, today: TODAY, days: exampleDays, doneByDay: { 1: 500 } });
  assert.deepEqual(getPendingDifferences(rows), [{ day: 1, date: "2026-11-01", goal: 600, done: 500, amount: 100, type: "falta" }]);
});

test("resultado acima da meta gera pergunta de redistribuição (excedente)", () => {
  const rows = buildGoalRows({ month: MONTH, today: TODAY, days: exampleDays, doneByDay: { 1: 700 } });
  assert.deepEqual(getPendingDifferences(rows).map((item) => [item.type, item.amount]), [["excedente", 100]]);
});

test("exemplo 3.3: +50 em 28/11 e +50 em 29/11 → 600 e 600, restante 0", () => {
  const rows = buildGoalRows({ month: MONTH, today: TODAY, days: exampleDays, doneByDay: { 1: 500 } });
  const [difference] = getPendingDifferences(rows);
  const preview = buildRedistributionPreview(rows, difference, { 28: "50", 29: "50" });
  assert.deepEqual(preview.changes.map(({ day, from, to }) => [day, from, to]), [[28, 550, 600], [29, 550, 600]]);
  assert.equal(preview.distributed, 100);
  assert.equal(preview.remaining, 0);
  assert.equal(preview.canApply, true);
});

test("redistribuição: nunca em dias passados nem em folga; redução não pode deixar meta negativa", () => {
  const rows = buildGoalRows({
    month: MONTH,
    today: "2026-11-15",
    days: { ...exampleDays, 20: { goal: 30 }, 21: { goal: 200, dayOff: true } },
    doneByDay: { 1: 700 },
  });
  const [difference] = getPendingDifferences(rows); // excedente de 100
  const past = buildRedistributionPreview(rows, difference, { 10: "50" });
  assert.equal(past.canApply, false);
  assert.match(past.errors[0].message, /futuros/);
  const dayOff = buildRedistributionPreview(rows, difference, { 21: "50" });
  assert.equal(dayOff.canApply, false);
  const negative = buildRedistributionPreview(rows, difference, { 20: "50" });
  assert.equal(negative.canApply, false);
  assert.match(negative.errors[0].message, /negativa/);
  const ok = buildRedistributionPreview(rows, difference, { 20: "30", 28: "70" });
  assert.deepEqual(ok.changes.map(({ day, to }) => [day, to]), [[20, 0], [28, 480]]);
  assert.equal(ok.remaining, 0);
});

test("redistribuição não aceita mais que o valor da diferença; parcial deixa restante", () => {
  const rows = buildGoalRows({ month: MONTH, today: TODAY, days: exampleDays, doneByDay: { 1: 500 } });
  const [difference] = getPendingDifferences(rows);
  assert.equal(buildRedistributionPreview(rows, difference, { 28: "80", 29: "80" }).canApply, false);
  const partial = buildRedistributionPreview(rows, difference, { 28: "60" });
  assert.deepEqual([partial.canApply, partial.remaining], [true, 40]);
});

test("diferença já tratada não pergunta de novo; se o realizado for editado, pergunta novamente", () => {
  const settled = { ...exampleDays, 1: { goal: 600, settledDone: 500, settledGoal: 600 } };
  assert.equal(getPendingDifferences(buildGoalRows({ month: MONTH, today: TODAY, days: settled, doneByDay: { 1: 500 } })).length, 0);
  const edited = getPendingDifferences(buildGoalRows({ month: MONTH, today: TODAY, days: settled, doneByDay: { 1: 450 } }));
  assert.deepEqual(edited.map((item) => item.amount), [150]);
});

test("hoje sem resultado ainda é disponível; com resultado ou no passado não", () => {
  const rows = buildGoalRows({ month: MONTH, today: TODAY, days: {}, doneByDay: {} });
  assert.deepEqual([rows[0].isAvailable, rows[1].isAvailable, rows[2].isAvailable], [false, true, true]);
  const withResult = buildGoalRows({ month: MONTH, today: TODAY, days: {}, doneByDay: { 2: 120 } });
  assert.equal(withResult[1].isAvailable, false);
});

test("Voltar ao automático: divide o que falta entre dias futuros sem folga e protege metas individuais", () => {
  const rows = buildGoalRows({
    month: MONTH,
    today: "2026-11-21", // disponíveis: 21..30 (10 dias), um de folga
    days: { 1: { goal: 600 }, 25: { goal: 900, origin: "redistribuicao" }, 26: { goal: 400, origin: "automatico" }, 27: { dayOff: true } },
    doneByDay: { 1: 500, 2: 1500 },
  });
  // Sem sobrescrever: 10000 - 2000 realizados - 900 (dia 25 protegido) = 7100 em 8 dias (21..30 menos 25 e 27)
  const keep = buildAutoDistribution(rows, 10000);
  assert.equal(keep.remaining, 7100);
  assert.deepEqual(keep.protectedDays.map((item) => item.day), [25]);
  assert.equal(keep.assignments.length, 8);
  assert.ok(!keep.assignments.some((item) => item.day < 21 || item.day === 25 || item.day === 27));
  assert.equal(Math.round(keep.assignments.reduce((sum, item) => sum + item.to, 0) * 100) / 100, 7100);
  assert.equal(keep.assignments.find((item) => item.day === 26).from, 400, "automático anterior é substituído sem proteção");
  // Sobrescrevendo com autorização: 8000 em 9 dias, centavos fecham no último dia
  const overwrite = buildAutoDistribution(rows, 10000, { overwriteProtected: true });
  assert.equal(overwrite.assignments.length, 9);
  assert.equal(Math.round(overwrite.assignments.reduce((sum, item) => sum + item.to, 0) * 100) / 100, 8000);
  assert.equal(overwrite.assignments[0].to, 888.88);
  assert.equal(overwrite.assignments.at(-1).to, 888.96);
});
