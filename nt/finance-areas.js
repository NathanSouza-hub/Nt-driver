// Regras financeiras das abas Dashboard | Uber | Salário | TikTok.
//
// Integração com o Dashboard (obrigatória):
//   Receitas gerais = saldo da Uber (receitas − gastos dos registros diários) + Salário + TikTok (planilha de vendas)
//   Despesas gerais = somente a página geral de Despesas (personal_expenses do tipo "saida")
// Despesas do Uber e do TikTok ficam apenas nas respectivas abas.

export const SALARY_RECEIPT_TYPES = [
  { value: "salario", label: "Salário" },
  { value: "vr", label: "VR (Vale-refeição)" },
  { value: "va", label: "VA (Vale-alimentação)" },
  { value: "vt", label: "VT (Vale-transporte)" },
  { value: "bonus", label: "Bônus" },
  { value: "comissao", label: "Comissão" },
  { value: "horas_extras", label: "Horas extras" },
  { value: "outros", label: "Outros" },
];

export const SALARY_RECURRENCES = [
  { value: "unica", label: "Única" },
  { value: "mensal", label: "Mensal" },
];

export function getSalaryTypeLabel(value) {
  return SALARY_RECEIPT_TYPES.find((item) => item.value === value)?.label || "Outros";
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function getDaysInMonth(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

export function shiftMonth(monthKey, delta) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function normalizeSalaryReceipt(item = {}) {
  const date = String(item.date || "").slice(0, 10);
  return {
    id: Number(item.id),
    receipt_type: String(item.receipt_type || "outros"),
    amount: Number(item.amount) || 0,
    date,
    recurrence: item.recurrence === "mensal" ? "mensal" : "unica",
    recurrence_end_month: item.recurrence_end_month ? String(item.recurrence_end_month).slice(0, 7) : "",
    notes: String(item.notes || ""),
  };
}

// Recebimentos que valem para o mês: lançamentos únicos do mês + recorrências mensais ativas.
// Recorrências são projetadas (não duplicadas no banco), então cada valor conta uma única vez por mês.
export function getSalaryReceiptsForMonth(receipts = [], monthKey) {
  return receipts
    .map(normalizeSalaryReceipt)
    .filter((item) => {
      const startMonth = item.date.slice(0, 7);
      if (item.recurrence !== "mensal") return startMonth === monthKey;
      if (startMonth > monthKey) return false;
      return !item.recurrence_end_month || monthKey <= item.recurrence_end_month;
    })
    .map((item) => {
      const day = Math.min(Number(item.date.slice(8, 10)) || 1, getDaysInMonth(monthKey));
      return { ...item, month_date: `${monthKey}-${String(day).padStart(2, "0")}` };
    })
    .sort((left, right) => left.month_date.localeCompare(right.month_date) || left.id - right.id);
}

export function sumAmounts(items = [], key = "amount") {
  return roundMoney(items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0));
}

// Total do mês por tipo de recebimento (na ordem oficial dos tipos). A soma dos tipos é igual ao total do mês.
export function getSalaryTotalsByType(receipts, monthKey) {
  const grouped = getSalaryReceiptsForMonth(receipts, monthKey).reduce((accumulator, item) => {
    accumulator[item.receipt_type] = roundMoney((accumulator[item.receipt_type] || 0) + item.amount);
    return accumulator;
  }, {});
  return SALARY_RECEIPT_TYPES.filter((type) => grouped[type.value]).map((type) => ({ ...type, total: grouped[type.value] }));
}

export function getSalaryTotalForMonth(receipts, monthKey) {
  return sumAmounts(getSalaryReceiptsForMonth(receipts, monthKey));
}

// Total da planilha do TikTok no mês (soma de todas as células, inclusive de vendedores removidos).
export function getTikTokSalesTotal(sales = [], monthKey) {
  return sumAmounts(sales.filter((sale) => String(sale.date || "").startsWith(monthKey)));
}

const TIKTOK_WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Totais da planilha do TikTok: linhas = dias do mês, colunas = vendedores visíveis.
// Retorna o total de cada dia, de cada vendedor e o total geral do mês (soma de todas as células do mês).
export function buildTikTokSheet(sellers = [], sales = [], monthKey) {
  const totalDays = getDaysInMonth(monthKey);
  const cells = new Map();
  sales
    .filter((sale) => String(sale.date || "").startsWith(monthKey))
    .forEach((sale) => cells.set(`${sale.seller_id}|${sale.date}`, Number(sale.amount) || 0));

  const days = Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const weekdayIndex = new Date(`${date}T00:00:00`).getDay();
    const total = roundMoney(sellers.reduce((sum, seller) => sum + (cells.get(`${seller.id}|${date}`) || 0), 0));
    return {
      date,
      label: `${String(day).padStart(2, "0")}/${monthKey.slice(5, 7)}`,
      weekday: TIKTOK_WEEKDAYS[weekdayIndex],
      isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
      total,
    };
  });

  const sellerTotals = sellers.map((seller) => ({
    sellerId: seller.id,
    total: roundMoney(days.reduce((sum, day) => sum + (cells.get(`${seller.id}|${day.date}`) || 0), 0)),
  }));

  return { days, cells, sellerTotals, grandTotal: getTikTokSalesTotal(sales, monthKey) };
}

// Resumo do TikTok no mês: receitas (planilha), despesas próprias e resultado líquido.
export function getTikTokSummary(sales = [], expenses = [], monthKey) {
  const revenue = getTikTokSalesTotal(sales, monthKey);
  const expenseTotal = sumAmounts(expenses.filter((item) => String(item.date || "").startsWith(monthKey)));
  return { revenue, expenses: expenseTotal, net: roundMoney(revenue - expenseTotal) };
}

// Converte o texto digitado na célula para número. Aceita "55,10", "1.234,56" e "55.10".
export function parseMoneyInput(raw) {
  const text = String(raw ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!text) return null;
  let normalized = text;
  if (text.includes(",")) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) normalized = text.replace(/\./g, ""); // "1.234" = mil duzentos e trinta e quatro
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? roundMoney(value) : NaN;
}

export function formatMoneyInput(value) {
  if (value === null || value === undefined || value === "") return "";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
