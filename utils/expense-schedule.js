// Cálculo das ocorrências mensais de despesas.
//
// Modelo:
//  - personal_expenses (série) = PROGRAMAÇÃO da despesa: valor/vencimento padrão, recorrência, início e fim.
//  - expense_occurrences       = OCORRÊNCIAS individualizadas (uma por série + mês de origem). São criadas quando
//    o usuário altera, paga, congela ou exclui um mês específico. Cada uma tem valor, vencimento, situação e
//    histórico próprios, então alterar um mês nunca modifica outro.
//  - Meses sem ocorrência materializada são calculados a partir da programação ("virtuais").
//
// A competência de uma ocorrência é sempre o mês do seu vencimento. Congelar move o vencimento um mês para frente.

const RECURRENCES = ['unica', 'mensal', 'anual', 'parcelada'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isMonthKey = (value) => MONTH_RE.test(String(value || ''));
const isDateKey = (value) => DATE_RE.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

const monthDiff = (fromMonth, toMonth) => {
  const [fy, fm] = String(fromMonth).split('-').map(Number);
  const [ty, tm] = String(toMonth).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

const shiftMonth = (monthKey, delta) => {
  const [year, month] = String(monthKey).split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const daysInMonth = (monthKey) => {
  const [year, month] = String(monthKey).split('-').map(Number);
  return new Date(year, month, 0).getDate();
};

const dateInMonth = (monthKey, day) => `${monthKey}-${String(Math.min(Math.max(Number(day) || 1, 1), daysInMonth(monthKey))).padStart(2, '0')}`;

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseJson = (value, fallback) => {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
};

const parseInstallments = (raw) => {
  const match = String(raw || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return { current, total };
};

// Situação mensal legada (status_months), usada nos meses ainda não individualizados.
const getLegacyMonthStatus = (series, monthKey) => {
  const map = parseJson(series.status_months, {});
  if (map && map[monthKey] === 'pago') return 'pago';
  const baseMonth = String(series.date || '').slice(0, 7);
  return series.status === 'pago' && baseMonth === monthKey ? 'pago' : 'pendente';
};

// Recorrência da série. Registros antigos (sem a coluna) são deduzidos dos campos legados.
const getRecurrence = (series) => {
  const explicit = String(series.recurrence || '').trim().toLowerCase();
  if (RECURRENCES.includes(explicit)) return explicit;
  if (parseInstallments(series.installments)) return 'parcelada';
  const fixed = series.is_fixed;
  if (fixed === true || fixed === 1 || fixed === '1' || fixed === 'true') return 'mensal';
  return 'unica';
};

const getStartMonth = (series) => {
  const baseMonth = String(series.date || '').slice(0, 7);
  if (getRecurrence(series) === 'parcelada') {
    const start = String(series.installments_start_month || '').slice(0, 7);
    return isMonthKey(start) ? start : baseMonth;
  }
  return baseMonth;
};

const getInstallmentNumber = (series, monthKey) => {
  const parsed = parseInstallments(series.installments);
  if (!parsed) return null;
  return parsed.current + monthDiff(getStartMonth(series), monthKey);
};

const getInstallmentLabel = (series, monthKey) => {
  if (getRecurrence(series) !== 'parcelada') return '';
  const parsed = parseInstallments(series.installments);
  const number = getInstallmentNumber(series, monthKey);
  return parsed && number ? `${number}/${parsed.total}` : '';
};

// A programação gera ocorrência neste mês?
const isScheduledInMonth = (series, monthKey) => {
  const startMonth = getStartMonth(series);
  if (!isMonthKey(startMonth) || !isMonthKey(monthKey)) return false;
  const diff = monthDiff(startMonth, monthKey);
  if (diff < 0) return false;
  const endMonth = String(series.end_month || '').slice(0, 7);
  if (isMonthKey(endMonth) && monthKey > endMonth) return false;

  switch (getRecurrence(series)) {
    case 'mensal':
      return true;
    case 'anual':
      return diff % 12 === 0;
    case 'parcelada': {
      const parsed = parseInstallments(series.installments);
      const number = getInstallmentNumber(series, monthKey);
      return Boolean(parsed) && number >= 1 && number <= parsed.total;
    }
    default:
      return diff === 0;
  }
};

const getSeriesDueDay = (series) => Number(series.due_day) || Number(String(series.date || '').slice(8, 10)) || 1;

// Dados iniciais de uma ocorrência copiados da programação (usado para virtuais e para materializar).
const buildOccurrenceFromSeries = (series, originMonth) => ({
  series_key: series.entry_key,
  origin_month: originMonth,
  competence_month: originMonth,
  description: String(series.description || '').trim(),
  category: String(series.category || 'Outros'),
  amount: roundMoney(series.amount),
  due_date: dateInMonth(originMonth, getSeriesDueDay(series)),
  status: getLegacyMonthStatus(series, originMonth),
  paid_at: null,
  notes: series.notes || '',
  installment_label: getInstallmentLabel(series, originMonth),
  recurrence: getRecurrence(series),
  is_deleted: false,
  transfer_history: []
});

const toView = ({ occurrence, series, isVirtual }) => {
  const history = Array.isArray(occurrence.transfer_history)
    ? occurrence.transfer_history
    : parseJson(occurrence.transfer_history, []);
  return {
    key: `${occurrence.series_key}|${occurrence.origin_month}`,
    occurrence_id: isVirtual ? null : Number(occurrence.id),
    series_key: occurrence.series_key,
    origin_month: occurrence.origin_month,
    competence_month: occurrence.competence_month,
    description: occurrence.description || series?.description || 'Sem descrição',
    category: occurrence.category || series?.category || 'Outros',
    amount: roundMoney(occurrence.amount),
    due_date: String(occurrence.due_date).slice(0, 10),
    status: occurrence.status === 'pago' ? 'pago' : 'pendente',
    paid_at: occurrence.paid_at || null,
    notes: occurrence.notes || '',
    recurrence: series ? getRecurrence(series) : (occurrence.recurrence || 'unica'),
    installment_label: occurrence.installment_label || '',
    series_end_month: series?.end_month || null,
    series_exists: Boolean(series),
    frozen: occurrence.competence_month !== occurrence.origin_month,
    transfer_history: Array.isArray(history) ? history : [],
    is_virtual: isVirtual
  };
};

// Ocorrências de despesa (tipo "saida") que pertencem à competência informada.
const buildMonthView = (seriesList = [], occurrenceRows = [], monthKey) => {
  const expenseSeries = seriesList.filter((series) => (series.type || 'saida') === 'saida' && series.entry_key);
  const seriesByKey = new Map(expenseSeries.map((series) => [series.entry_key, series]));
  const incomeKeys = new Set(seriesList.filter((series) => series.type === 'entrada').map((series) => series.entry_key));
  const rowKeys = new Set(occurrenceRows.map((row) => `${row.series_key}|${row.origin_month}`));
  const items = [];

  expenseSeries.forEach((series) => {
    if (!isScheduledInMonth(series, monthKey)) return;
    if (rowKeys.has(`${series.entry_key}|${monthKey}`)) return; // já individualizada (pode ter sido movida/excluída)
    items.push(toView({ occurrence: buildOccurrenceFromSeries(series, monthKey), series, isVirtual: true }));
  });

  occurrenceRows.forEach((row) => {
    const deleted = row.is_deleted === true || row.is_deleted === 1 || row.is_deleted === '1';
    if (deleted || row.competence_month !== monthKey || incomeKeys.has(row.series_key)) return;
    // Ocorrências individualizadas continuam visíveis mesmo se a programação for encerrada ou removida (histórico).
    items.push(toView({ occurrence: row, series: seriesByKey.get(row.series_key) || null, isVirtual: false }));
  });

  return items.sort((left, right) => left.due_date.localeCompare(right.due_date) || left.description.localeCompare(right.description, 'pt-BR'));
};

const summarize = (items = []) => {
  const total = roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
  const paid = roundMoney(items.filter((item) => item.status === 'pago').reduce((sum, item) => sum + item.amount, 0));
  return { total, paid, pending: roundMoney(total - paid), count: items.length };
};

module.exports = {
  RECURRENCES,
  isMonthKey,
  isDateKey,
  monthDiff,
  shiftMonth,
  daysInMonth,
  dateInMonth,
  roundMoney,
  parseJson,
  parseInstallments,
  getRecurrence,
  getStartMonth,
  getInstallmentLabel,
  isScheduledInMonth,
  buildOccurrenceFromSeries,
  buildMonthView,
  summarize
};
