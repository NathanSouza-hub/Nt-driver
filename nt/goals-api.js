import { apiFetch } from "./http";
import { DEFAULT_MONTHLY_GOAL_VALUE, getStoredMonthlyGoal } from "./driver-data";

// Carrega as metas do mês. Se a meta mensal ainda só existir neste navegador (versão antiga),
// ela é enviada uma única vez para o banco, para valer em qualquer dispositivo.
export async function fetchGoalsMonth(month) {
  const payload = await apiFetch(`/api/summary-goals/${encodeURIComponent(month)}`);
  if (payload?.monthly) return payload;
  const stored = getStoredMonthlyGoal(month);
  if (!stored) return payload;
  try {
    return await apiFetch(`/api/summary-goals/${encodeURIComponent(month)}/monthly`, {
      method: "PUT",
      body: JSON.stringify({ goal: stored }),
    });
  } catch (error) {
    return { ...payload, monthly: { goal: stored, confirmedAt: null, confirmedTotal: null } };
  }
}

export const resolveMonthlyGoal = (payload) => {
  const goal = Number(payload?.monthly?.goal);
  return Number.isFinite(goal) && goal > 0 ? goal : DEFAULT_MONTHLY_GOAL_VALUE;
};

export const goalsRequest = (month, path, body, method = "POST") => apiFetch(`/api/summary-goals/${encodeURIComponent(month)}${path}`, {
  method,
  body: JSON.stringify(body || {}),
});
