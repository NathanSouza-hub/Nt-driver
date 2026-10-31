import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { currency, formatDate, getCurrentMonthKey, getMonthLabel } from "./driver-data";
import { apiFetch } from "./http";
import { PageHeader, PageTabs } from "./Pages";
import { AreaToast, areaFieldStyle, useToast } from "./SalaryTab";
import { formatMoneyInput, parseMoneyInput, shiftMonth } from "./finance-areas";
import {
  ConfirmDialog,
  ExpenseCompactList,
  RECURRENCE_OPTIONS,
  getCategoryLabel,
  getRecurrenceLabel,
  getTodayKey,
  isOverdue,
  useExpenseMonth,
} from "./expenses-shared";

const EXPENSE_TABS = [
  { key: "list", label: "Lista" },
  { key: "create", label: "Cadastrar" },
  { key: "summary", label: "Resumo" },
];

const STATUS_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "A pagar" },
  { key: "paid", label: "Pagos" },
];

const CHART_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#0f766e"];

function createEmptyForm(month) {
  const today = getTodayKey();
  const day = Math.min(Number(today.slice(8, 10)), 28);
  return {
    description: "",
    amount: "",
    due_date: today.startsWith(month) ? today : `${month}-${String(day).padStart(2, "0")}`,
    category: "",
    recurrence: "unica",
    installments_total: "",
    installment_current: "1",
    status: "pendente",
    notes: "",
  };
}

function ExpenseForm({ month, editing, categories, onCategoriesChange, onSaved, onCancel, showToast }) {
  const [form, setForm] = useState(() => createEmptyForm(month));
  const [isSaving, setIsSaving] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm({
        description: editing.description,
        amount: formatMoneyInput(editing.amount),
        due_date: editing.due_date,
        category: editing.category,
        recurrence: editing.recurrence,
        installments_total: "",
        installment_current: "1",
        status: editing.status,
        notes: editing.notes || "",
      });
    } else {
      setForm(createEmptyForm(month));
    }
  }, [editing, month]);

  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  // Categoria criada na hora, sem sair do cadastro.
  const createCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const payload = await apiFetch("/api/expenses/categories", { method: "POST", body: JSON.stringify({ name }) });
      onCategoriesChange(payload.categories || []);
      update("category", payload.category.value);
      setNewCategory("");
      setIsAddingCategory(false);
      showToast(`Categoria "${payload.category.label}" disponível.`);
    } catch (error) {
      showToast(error.message, "error");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const amount = parseMoneyInput(form.amount);
    if (!amount || Number.isNaN(amount)) {
      showToast("Informe um valor maior que zero.", "error");
      return;
    }
    if (!form.category) {
      showToast("Selecione ou crie uma categoria.", "error");
      return;
    }

    setIsSaving(true);
    try {
      if (editing) {
        await apiFetch("/api/expenses/occurrence", {
          method: "PATCH",
          body: JSON.stringify({
            series_key: editing.series_key,
            origin_month: editing.origin_month,
            description: form.description,
            amount,
            due_date: form.due_date,
            category: form.category,
            status: form.status,
            notes: form.notes,
          }),
        });
        showToast("Lançamento atualizado. Os outros meses não foram alterados.");
      } else {
        await apiFetch("/api/expenses", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            amount,
            installments_total: Number(form.installments_total),
            installment_current: Number(form.installment_current || 1),
          }),
        });
        showToast("Despesa cadastrada.");
      }
      onSaved(form.due_date.slice(0, 7));
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const movesMonth = editing && form.due_date && form.due_date.slice(0, 7) !== editing.competence_month;

  return (
    <div className="card area-form-card">
      <div className="area-form-header">
        <strong>{editing ? "Editar lançamento" : "Cadastrar despesa"}</strong>
        <p>
          {editing
            ? `Alterações valem somente para este lançamento (${getMonthLabel(editing.competence_month)}).`
            : "A situação informada vale para o primeiro lançamento; os próximos nascem a pagar."}
        </p>
      </div>
      <form className="area-form-grid expense-form-grid" onSubmit={handleSubmit}>
        <div className="area-field area-field-wide">
          <label htmlFor="expense-description">Descrição</label>
          <input id="expense-description" style={areaFieldStyle} maxLength={120} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Ex.: Conta de luz" required />
        </div>
        <div className="area-field">
          <label htmlFor="expense-amount">Valor</label>
          <input id="expense-amount" style={areaFieldStyle} inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="0,00" required />
        </div>
        <div className="area-field">
          <label htmlFor="expense-due">Data de vencimento</label>
          <input id="expense-due" type="date" style={areaFieldStyle} value={form.due_date} onChange={(event) => update("due_date", event.target.value)} required />
        </div>
        <div className="area-field">
          <label htmlFor="expense-category">Categoria</label>
          {isAddingCategory ? (
            <div className="expense-inline-create">
              <input
                id="expense-category"
                style={areaFieldStyle}
                maxLength={40}
                autoFocus
                value={newCategory}
                placeholder="Nova categoria"
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createCategory();
                  }
                  if (event.key === "Escape") setIsAddingCategory(false);
                }}
              />
              <button type="button" className="password-btn" onClick={createCategory}>Criar</button>
              <button type="button" className="ghost-button" onClick={() => setIsAddingCategory(false)} aria-label="Cancelar nova categoria">×</button>
            </div>
          ) : (
            <div className="expense-inline-create">
              <select id="expense-category" style={areaFieldStyle} value={form.category} onChange={(event) => update("category", event.target.value)} required>
                <option value="">Selecione</option>
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
              <button type="button" className="password-btn" onClick={() => setIsAddingCategory(true)} title="Criar nova categoria">+ Nova</button>
            </div>
          )}
        </div>
        <div className="area-field">
          <label htmlFor="expense-recurrence">Recorrência</label>
          <select id="expense-recurrence" style={areaFieldStyle} value={form.recurrence} disabled={Boolean(editing)} onChange={(event) => update("recurrence", event.target.value)}>
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {!editing && form.recurrence === "parcelada" ? (
          <>
            <div className="area-field">
              <label htmlFor="expense-installments-total">Total de parcelas</label>
              <input id="expense-installments-total" type="number" min="2" max="360" style={areaFieldStyle} value={form.installments_total} onChange={(event) => update("installments_total", event.target.value)} required />
            </div>
            <div className="area-field">
              <label htmlFor="expense-installment-current">Parcela deste vencimento</label>
              <input id="expense-installment-current" type="number" min="1" style={areaFieldStyle} value={form.installment_current} onChange={(event) => update("installment_current", event.target.value)} required />
            </div>
          </>
        ) : null}
        <div className="area-field">
          <label id="expense-status-label">Situação de pagamento</label>
          <div className="expense-segmented" role="radiogroup" aria-labelledby="expense-status-label">
            {[{ value: "pendente", label: "A pagar" }, { value: "pago", label: "Pago" }].map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={form.status === option.value}
                className={form.status === option.value ? "is-active" : ""}
                onClick={() => update("status", option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="area-field area-field-wide">
          <label htmlFor="expense-notes">Observações (opcional)</label>
          <textarea id="expense-notes" rows={2} maxLength={500} style={{ ...areaFieldStyle, resize: "vertical" }} value={form.notes} onChange={(event) => update("notes", event.target.value)} />
        </div>
        {editing ? (
          <p className="area-form-note">
            Recorrência: {getRecurrenceLabel(editing.recurrence)}{editing.installment_label ? ` (parcela ${editing.installment_label})` : ""}.
            {movesMonth ? ` O lançamento será movido para ${getMonthLabel(form.due_date.slice(0, 7))}.` : ""}
          </p>
        ) : null}
        <div className="area-form-actions">
          <button type="submit" className="auth-submit" disabled={isSaving}>
            {isSaving ? "Salvando..." : editing ? "Salvar lançamento" : "Cadastrar despesa"}
          </button>
          {editing ? <button type="button" className="auth-outline-button" onClick={onCancel}>Cancelar</button> : null}
        </div>
      </form>
    </div>
  );
}

function ExpenseSummaryTab({ items, total }) {
  const categoryItems = useMemo(() => {
    const grouped = items.reduce((accumulator, item) => {
      const key = item.category || "Outros";
      accumulator[key] = (accumulator[key] || 0) + item.amount;
      return accumulator;
    }, {});
    return Object.entries(grouped).sort((left, right) => right[1] - left[1]);
  }, [items]);

  const segments = useMemo(() => {
    if (!categoryItems.length || total <= 0) return [];
    let cursor = 0;
    return categoryItems.map(([label, value], index) => {
      const start = cursor;
      cursor += (value / total) * 100;
      return { label, value, color: CHART_COLORS[index % CHART_COLORS.length], start, end: cursor };
    });
  }, [categoryItems, total]);

  const donutBackground = segments.length
    ? `conic-gradient(${segments.map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`).join(", ")})`
    : "conic-gradient(var(--panel-soft) 0 100%)";

  return (
    <div className="expenses-tab-content">
      <div className="card">
        <h2>Despesas por categoria</h2>
        <div className="area-table-wrap">
          <table className="personal-table area-table area-table-compact">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Total</th>
                <th>Participação</th>
              </tr>
            </thead>
            <tbody>
              {categoryItems.length ? (
                categoryItems.map(([label, value]) => (
                  <tr key={label}>
                    <td>{getCategoryLabel(label)}</td>
                    <td>{currency(value)}</td>
                    <td>{total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0.0%"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="3" style={{ textAlign: "center" }}>Nenhuma despesa encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Gráfico</h2>
        {segments.length ? (
          <div className="expenses-donut-layout">
            <div className="expenses-donut-card">
              <div className="expenses-donut-chart" style={{ background: donutBackground }}>
                <div className="expenses-donut-center">
                  <strong>{currency(total)}</strong>
                  <span>Total</span>
                </div>
              </div>
            </div>
            <div className="expenses-donut-legend">
              {segments.map((segment) => (
                <div key={segment.label} className="expenses-donut-legend-item">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="expenses-donut-dot" style={{ background: segment.color }} />
                    <strong>{getCategoryLabel(segment.label)}</strong>
                  </div>
                  <span>{currency(segment.value)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, color: "var(--muted)" }}>Nenhuma despesa encontrada para exibir o resumo.</p>
        )}
      </div>
    </div>
  );
}

export function ExpensesPage() {
  const { expensesMonth, setExpensesMonth } = useOutletContext();
  const location = useLocation();
  const navigate = useNavigate();
  const month = expensesMonth || getCurrentMonthKey();
  const { items, summary, isLoading, error, reload } = useExpenseMonth(month);
  const [toast, showToast] = useToast();
  const [activeTab, setActiveTab] = useState("list");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    apiFetch("/api/expenses/categories")
      .then((payload) => setCategories(Array.isArray(payload) ? payload : []))
      .catch(() => setCategories([]));
  }, []);

  // Edição solicitada por outra tela (ex.: Dashboard do perfil pessoal).
  useEffect(() => {
    const target = location.state?.editOccurrence;
    if (!target) return;
    setEditing(target);
    setActiveTab("create");
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  const monthCategories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category || "Outros")))
      .sort((left, right) => getCategoryLabel(left).localeCompare(getCategoryLabel(right), "pt-BR")),
    [items]
  );

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === "paid" && item.status !== "pago") return false;
      if (statusFilter === "pending" && item.status === "pago") return false;
      if (categoryFilter && (item.category || "Outros") !== categoryFilter) return false;
      if (term && !`${item.description} ${item.notes || ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, statusFilter, categoryFilter, search]);

  const overdueTotal = useMemo(() => items.filter(isOverdue).reduce((sum, item) => sum + item.amount, 0), [items]);

  const runAction = async (item, request, successText) => {
    setBusyKey(item.key);
    try {
      await request();
      await reload();
      showToast(successText);
      return true;
    } catch (requestError) {
      showToast(requestError.message, "error");
      return false;
    } finally {
      setBusyKey("");
    }
  };

  const ref = (item) => ({ series_key: item.series_key, origin_month: item.origin_month });
  const closeDialog = () => setDialog(null);

  const handleToggleStatus = (item) => runAction(
    item,
    () => apiFetch("/api/expenses/occurrence", { method: "PATCH", body: JSON.stringify({ ...ref(item), status: item.status === "pago" ? "pendente" : "pago" }) }),
    item.status === "pago" ? "Lançamento marcado como a pagar." : "Lançamento marcado como pago."
  );

  const handleEdit = (item) => {
    setEditing(item);
    setActiveTab("create");
  };

  const handleFreeze = (item) => {
    const nextMonth = shiftMonth(item.competence_month, 1);
    setDialog({
      title: "Congelar 🧊",
      message: (
        <p>
          Transferir <strong>{item.description}</strong> ({currency(item.amount)}) de {getMonthLabel(item.competence_month)} para{" "}
          <strong>{getMonthLabel(nextMonth)}</strong>? O lançamento sai deste mês, continua a pagar e fica separado de qualquer
          outro lançamento de {getMonthLabel(nextMonth)} (os valores não são somados em um só).
        </p>
      ),
      actions: [{
        label: "Congelar e transferir",
        tone: "primary",
        onClick: async () => {
          const ok = await runAction(
            item,
            () => apiFetch("/api/expenses/occurrence/freeze", { method: "POST", body: JSON.stringify(ref(item)) }),
            `${item.description} transferida para ${getMonthLabel(nextMonth)}.`
          );
          if (ok) closeDialog();
        },
      }],
    });
  };

  const handleDelete = (item) => {
    const deleteOne = {
      label: "Excluir somente esta ocorrência",
      description: "Remove apenas este lançamento. Outros meses e pagamentos não são alterados.",
      tone: "danger",
      onClick: async () => {
        const ok = await runAction(item, () => apiFetch("/api/expenses/occurrence/delete", { method: "POST", body: JSON.stringify(ref(item)) }), "Lançamento excluído.");
        if (ok) closeDialog();
      },
    };
    const isRecurring = item.recurrence !== "unica" && item.series_exists;
    const actions = isRecurring
      ? [
        deleteOne,
        {
          label: "Encerrar recorrência",
          description: `Não gera novos lançamentos depois de ${getMonthLabel(month)}. Todo o histórico é mantido.`,
          onClick: async () => {
            const ok = await runAction(
              item,
              () => apiFetch(`/api/expenses/series/${encodeURIComponent(item.series_key)}/end`, { method: "POST", body: JSON.stringify({ month }) }),
              "Recorrência encerrada."
            );
            if (ok) closeDialog();
          },
        },
        {
          label: "Excluir ocorrências futuras",
          description: `Remove os lançamentos não pagos depois de ${getMonthLabel(month)}. Pagos e anteriores são preservados.`,
          tone: "danger",
          onClick: async () => {
            const ok = await runAction(
              item,
              () => apiFetch(`/api/expenses/series/${encodeURIComponent(item.series_key)}/delete-future`, { method: "POST", body: JSON.stringify({ month }) }),
              "Ocorrências futuras excluídas."
            );
            if (ok) closeDialog();
          },
        },
      ]
      : [{ ...deleteOne, label: "Excluir lançamento", description: item.status === "pago" ? "Atenção: este lançamento já está pago." : "" }];

    setDialog({
      title: "Excluir despesa",
      message: (
        <p>
          <strong>{item.description}</strong> · {currency(item.amount)} · vence em {formatDate(item.due_date)}
          {isRecurring ? ` · ${getRecurrenceLabel(item.recurrence)}` : ""}
        </p>
      ),
      actions,
    });
  };

  const handleSaved = (savedMonth) => {
    setEditing(null);
    if (savedMonth && savedMonth !== month) setExpensesMonth(savedMonth);
    else reload();
    setActiveTab("list");
  };

  return (
    <>
      <AreaToast toast={toast} />
      <PageHeader title="Despesas" centered />
      <PageTabs
        tabs={EXPENSE_TABS}
        activeTab={activeTab}
        onChange={(tab) => {
          if (tab !== "create") setEditing(null);
          setActiveTab(tab);
        }}
      />

      {error ? <p className="dashboard-source-warning" role="alert">Não foi possível carregar as despesas: {error}</p> : null}

      {activeTab === "list" ? (
        <div className="card expense-list-card">
          <div className="expense-list-toolbar">
            <div className="tiktok-month-nav" aria-label="Navegação entre meses">
              <button type="button" className="tiktok-month-btn" onClick={() => setExpensesMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
              <strong className="tiktok-month-label">{getMonthLabel(month)}</strong>
              <button type="button" className="tiktok-month-btn" onClick={() => setExpensesMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
            </div>
            <div className="expense-totals" aria-label="Totais do mês">
              <div><small>Total</small><strong>{currency(summary.total)}</strong></div>
              <div className="is-paid"><small>Pagas</small><strong>{currency(summary.paid)}</strong></div>
              <div className="is-pending"><small>A pagar</small><strong>{currency(summary.pending)}</strong></div>
              {overdueTotal > 0 ? <div className="is-overdue"><small>Atrasadas</small><strong>{currency(overdueTotal)}</strong></div> : null}
            </div>
          </div>

          <div className="expense-filters">
            <div className="expense-segmented" role="radiogroup" aria-label="Filtrar por situação">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === filter.key}
                  className={statusFilter === filter.key ? "is-active" : ""}
                  onClick={() => setStatusFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <select style={areaFieldStyle} className="expense-filter-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filtrar por categoria">
              <option value="">Todas as categorias</option>
              {monthCategories.map((category) => (
                <option key={category} value={category}>{getCategoryLabel(category)}</option>
              ))}
            </select>
            <input style={areaFieldStyle} className="expense-filter-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar descrição" aria-label="Buscar despesa" />
            <button type="button" className="auth-submit expense-new-btn" onClick={() => { setEditing(null); setActiveTab("create"); }}>+ Cadastrar</button>
          </div>

          {isLoading && !items.length ? (
            <p className="expense-list-empty">Carregando despesas...</p>
          ) : (
            <ExpenseCompactList
              items={filteredItems}
              onToggleStatus={handleToggleStatus}
              onEdit={handleEdit}
              onFreeze={handleFreeze}
              onDelete={handleDelete}
              busyKey={busyKey}
              emptyText={items.length ? "Nenhuma despesa corresponde aos filtros." : `Nenhuma despesa em ${getMonthLabel(month)}.`}
            />
          )}
          {filteredItems.length && filteredItems.length !== items.length ? (
            <p className="expense-list-footnote">
              Exibindo {filteredItems.length} de {items.length} · {currency(filteredItems.reduce((sum, item) => sum + item.amount, 0))}
            </p>
          ) : null}
        </div>
      ) : null}

      {activeTab === "create" ? (
        <ExpenseForm
          month={month}
          editing={editing}
          categories={categories}
          onCategoriesChange={setCategories}
          onSaved={handleSaved}
          onCancel={() => {
            setEditing(null);
            setActiveTab("list");
          }}
          showToast={showToast}
        />
      ) : null}

      {activeTab === "summary" ? <ExpenseSummaryTab items={items} total={summary.total || 0} /> : null}

      {dialog ? <ConfirmDialog {...dialog} busy={Boolean(busyKey)} onClose={closeDialog} /> : null}
    </>
  );
}
