// Regras da página Metas (sem React, sem rede — testáveis com node:test).
//
// Princípios:
//  - Cada dia tem a sua própria meta, definida pelo usuário. Não há distribuição automática implícita.
//  - A meta mensal é o MÍNIMO a ser distribuído (soma das metas diárias >= meta mensal para confirmar).
//  - Diferença entre realizado e meta gera uma PERGUNTA; nada é redistribuído sem escolha e confirmação.
//  - Dias passados nunca são alterados. Dias disponíveis = depois de hoje, ou hoje ainda sem resultado lançado,
//    e sem folga.
//  - "Voltar ao automático" é a única distribuição automática e só roda por ação explícita (com prévia).

export const GOAL_ORIGINS = { manual: "manual", redistribution: "redistribuicao", automatic: "automatico" };

export const roundCents = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function getDaysInMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Monta as linhas do calendário com status, disponibilidade e diferença pendente de cada dia.
//  days: { "1": { goal, dayOff, origin, settledDone, settledGoal }, ... }
//  doneByDay: { "1": 500, ... } (realizado vindo dos registros do Uber)
//  today: "YYYY-MM-DD"
export function buildGoalRows({ month, today, days = {}, doneByDay = {} }) {
  const total = getDaysInMonth(month);
  const rows = [];
  for (let day = 1; day <= total; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const saved = days[String(day)] || {};
    const goal = toNumberOrNull(saved.goal);
    const dayOff = Boolean(saved.dayOff);
    const done = roundCents(doneByDay[String(day)] || 0);
    const hasResult = !dayOff && done > 0;
    const isPast = date < today;
    const isToday = date === today;
    // Disponível = hoje ou futuro, sem folga e ainda sem resultado lançado.
    const isAvailable = !dayOff && !hasResult && date >= today;

    let status = "empty";
    if (dayOff) status = "dayoff";
    else if (hasResult) status = done >= (goal || 0) ? "hit" : "missed";

    let pendingDifference = null;
    if (hasResult && goal !== null && goal > 0 && done !== roundCents(goal)) {
      const alreadyHandled = toNumberOrNull(saved.settledDone) === done && toNumberOrNull(saved.settledGoal) === goal;
      if (!alreadyHandled) {
        const amount = roundCents(goal - done);
        pendingDifference = { day, date, goal, done, amount: Math.abs(amount), type: amount > 0 ? "falta" : "excedente" };
      }
    }

    rows.push({
      day,
      date,
      goal,
      origin: goal === null ? null : (saved.origin || GOAL_ORIGINS.manual),
      dayOff,
      done,
      hasResult,
      isPast,
      isToday,
      isAvailable,
      status,
      pendingDifference,
    });
  }
  return rows;
}

// Validação da meta mensal: menor = bloqueia (informa quanto falta); igual ou maior = permite.
export function getDistributionStatus(rows, monthlyGoal) {
  const distributed = roundCents(rows.filter((row) => !row.dayOff).reduce((sum, row) => sum + (row.goal || 0), 0));
  const goal = roundCents(monthlyGoal);
  return {
    distributed,
    monthlyGoal: goal,
    missing: roundCents(Math.max(0, goal - distributed)),
    excess: roundCents(Math.max(0, distributed - goal)),
    canConfirm: goal > 0 && distributed >= goal,
  };
}

export const getPendingDifferences = (rows) => rows.filter((row) => row.pendingDifference).map((row) => row.pendingDifference);

// Prévia da redistribuição manual.
//  difference: { amount (positivo), type: "falta" (acrescentar) | "excedente" (retirar) }
//  adjustments: { [day]: valor digitado (sempre positivo; o tipo define se soma ou subtrai) }
export function buildRedistributionPreview(rows, difference, adjustments = {}) {
  const sign = difference.type === "excedente" ? -1 : 1;
  const errors = [];
  const changes = [];
  let distributed = 0;

  Object.entries(adjustments).forEach(([dayKey, rawValue]) => {
    if (rawValue === "" || rawValue === null || rawValue === undefined) return;
    const row = rows.find((candidate) => candidate.day === Number(dayKey));
    if (!row) return;
    const number = Number(rawValue);
    if (!Number.isFinite(number) || number < 0) {
      errors.push({ day: row.day, message: "Informe um valor positivo." });
      return;
    }
    const value = roundCents(number);
    if (value === 0) return;
    if (!row.isAvailable) {
      errors.push({ day: row.day, message: "Somente dias futuros sem folga podem ser alterados." });
      return;
    }
    const from = roundCents(row.goal || 0);
    const to = roundCents(from + sign * value);
    if (to < 0) {
      errors.push({ day: row.day, message: `A meta não pode ficar negativa (máximo para retirar: R$ ${from.toFixed(2).replace(".", ",")}).` });
      return;
    }
    distributed = roundCents(distributed + value);
    changes.push({ day: row.day, date: row.date, from, to, delta: roundCents(sign * value) });
  });

  const remaining = roundCents(difference.amount - distributed);
  if (remaining < 0) errors.push({ day: null, message: "O total informado é maior que o valor a redistribuir." });

  return {
    changes: changes.sort((left, right) => left.day - right.day),
    distributed,
    remaining,
    errors,
    canApply: !errors.length && changes.length > 0,
  };
}

// Prévia do "Voltar ao automático": divide igualmente o que falta da meta mensal entre os dias disponíveis.
//  O que falta = meta mensal - realizado nos dias que já não estão disponíveis.
//  Dias disponíveis com meta individual/redistribuída são "protegidos": só entram se overwriteProtected = true;
//  caso contrário mantêm o valor, que é descontado do que falta.
export function buildAutoDistribution(rows, monthlyGoal, { overwriteProtected = false } = {}) {
  const available = rows.filter((row) => row.isAvailable);
  const protectedRows = available.filter((row) => row.goal !== null && row.origin !== GOAL_ORIGINS.automatic);
  const kept = overwriteProtected ? [] : protectedRows;
  const targets = available.filter((row) => !kept.includes(row));

  const realized = rows.filter((row) => !row.isAvailable && !row.dayOff).reduce((sum, row) => sum + row.done, 0);
  const keptTotal = kept.reduce((sum, row) => sum + (row.goal || 0), 0);
  const remaining = roundCents(Math.max(0, roundCents(monthlyGoal) - realized - keptTotal));

  const assignments = [];
  if (targets.length) {
    const base = Math.floor((remaining / targets.length) * 100) / 100;
    let assigned = 0;
    targets.forEach((row, index) => {
      const value = index === targets.length - 1 ? roundCents(remaining - assigned) : base;
      assigned = roundCents(assigned + value);
      assignments.push({ day: row.day, date: row.date, from: row.goal, to: value, origin: row.origin });
    });
  }

  return {
    remaining,
    realized: roundCents(realized),
    perDay: targets.length ? Math.floor((remaining / targets.length) * 100) / 100 : 0,
    assignments,
    protectedDays: protectedRows.map((row) => ({ day: row.day, date: row.date, goal: row.goal, origin: row.origin })),
    keptDays: kept.map((row) => row.day),
  };
}
