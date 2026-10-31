import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaCircleArrowUp } from "react-icons/fa6";
import { currency, formatDate, getMonthLabel } from "./driver-data";
import { apiFetch } from "./http";
import SummaryCards from "./SummaryCards";
import { AreaToast, areaFieldStyle, useToast } from "./SalaryTab";
import { formatMoneyInput, getDaysInMonth, getTikTokSalesTotal, parseMoneyInput, roundMoney, shiftMonth, sumAmounts } from "./finance-areas";

const AUTOSAVE_DELAY_MS = 800;
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const TIKTOK_EXPENSE_CATEGORIES = ["Anúncios", "Amostras", "Embalagens", "Frete", "Comissões", "Ferramentas", "Outros"];

const cellKey = (sellerId, date) => `${sellerId}|${date}`;

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function createEmptyExpenseForm(month) {
  const today = getTodayKey();
  return { description: "", amount: "", date: today.startsWith(month) ? today : `${month}-01`, category: "" };
}

// Atualiza (ou remove) uma célula na lista de vendas do mês carregado.
function applySale(data, sellerId, date, amount) {
  if (!data.month || !date.startsWith(data.month)) return data;
  const others = data.sales.filter((sale) => !(sale.seller_id === sellerId && sale.date === date));
  return { ...data, sales: amount === null ? others : [...others, { seller_id: sellerId, date, amount }] };
}

function SellerHeader({ seller, onRename, onArchive, onRestore, disabled }) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(seller.name);

  useEffect(() => setName(seller.name), [seller.name]);

  const finish = async (shouldSave) => {
    setIsEditing(false);
    const trimmed = name.trim();
    if (!shouldSave || !trimmed || trimmed === seller.name) {
      setName(seller.name);
      return;
    }
    const ok = await onRename(seller, trimmed);
    if (!ok) setName(seller.name);
  };

  if (isEditing) {
    return (
      <input
        className="tiktok-seller-rename"
        value={name}
        maxLength={60}
        autoFocus
        aria-label={`Novo nome para ${seller.name}`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") finish(false);
        }}
      />
    );
  }

  return (
    <div className="tiktok-seller-head">
      <button type="button" className="tiktok-seller-name" title="Clique para renomear" onClick={() => setIsEditing(true)} disabled={disabled}>
        {seller.name}
      </button>
      {seller.archived ? (
        <>
          <span className="tiktok-seller-badge">removido</span>
          <button type="button" className="tiktok-seller-action" title="Restaurar vendedor" aria-label={`Restaurar ${seller.name}`} onClick={() => onRestore(seller)} disabled={disabled}>
            ↺
          </button>
        </>
      ) : (
        <button
          type="button"
          className="tiktok-seller-action is-danger"
          title="Remover vendedor (os lançamentos são preservados)"
          aria-label={`Remover ${seller.name}`}
          onClick={() => onArchive(seller)}
          disabled={disabled}
        >
          ×
        </button>
      )}
    </div>
  );
}

// Aba TikTok: planilha de vendas (linhas = dias, colunas = vendedores) com salvamento automático por célula
// e despesas próprias, que não entram nas despesas gerais nem nas do Uber.
export default function TikTokTab({ month, onMonthChange, data, setData, isLoading, loadError, onReload }) {
  const [toast, showToast] = useToast();
  const [drafts, setDrafts] = useState({});
  const [cellStatus, setCellStatus] = useState({});
  const [newSellerName, setNewSellerName] = useState("");
  const [isMutatingSellers, setIsMutatingSellers] = useState(false);
  const [expenseForm, setExpenseForm] = useState(() => createEmptyExpenseForm(month));
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const pendingRef = useRef(new Map());
  const saveChainRef = useRef(new Map());
  const tableRef = useRef(null);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const days = useMemo(() => {
    const total = getDaysInMonth(month);
    return Array.from({ length: total }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const weekday = new Date(`${date}T00:00:00`).getDay();
      return { date, label: `${String(day).padStart(2, "0")}/${month.slice(5, 7)}`, weekday: WEEKDAYS[weekday], isWeekend: weekday === 0 || weekday === 6 };
    });
  }, [month]);

  const salesMap = useMemo(() => {
    const map = new Map();
    data.sales.forEach((sale) => map.set(cellKey(sale.seller_id, sale.date), Number(sale.amount) || 0));
    return map;
  }, [data.sales]);

  const sellers = data.sellers;
  const sellerTotals = useMemo(
    () => sellers.map((seller) => roundMoney(days.reduce((sum, day) => sum + (salesMap.get(cellKey(seller.id, day.date)) || 0), 0))),
    [sellers, days, salesMap]
  );
  const dayTotals = useMemo(
    () => days.map((day) => roundMoney(sellers.reduce((sum, seller) => sum + (salesMap.get(cellKey(seller.id, day.date)) || 0), 0))),
    [sellers, days, salesMap]
  );
  const monthRevenue = useMemo(() => getTikTokSalesTotal(data.sales, month), [data.sales, month]);
  const expensesTotal = useMemo(() => sumAmounts(data.expenses), [data.expenses]);
  const todayKey = getTodayKey();

  // ---- Salvamento automático das células ----
  // `previous` é o valor salvo antes da edição começar (usado para evitar salvamentos inúteis e para reverter em caso de erro).
  const commitCell = useCallback((sellerId, date, rawText, previous) => {
    const key = cellKey(sellerId, date);
    const parsed = parseMoneyInput(rawText);
    if (Number.isNaN(parsed)) {
      setCellStatus((current) => ({ ...current, [key]: "error" }));
      showToastRef.current("Valor inválido. Use números, ex.: 55,10", "error");
      return;
    }

    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (parsed === previous) {
      setCellStatus((current) => ({ ...current, [key]: undefined }));
      return;
    }

    setData((current) => applySale(current, sellerId, date, parsed));
    setCellStatus((current) => ({ ...current, [key]: "saving" }));

    // Encadeia salvamentos da mesma célula para que a última edição sempre prevaleça.
    const chain = (saveChainRef.current.get(key) || Promise.resolve()).then(() =>
      apiFetch("/api/tiktok/sales", {
        method: "PUT",
        body: JSON.stringify({ seller_id: sellerId, date, amount: parsed }),
      })
        .then(() => {
          setCellStatus((current) => ({ ...current, [key]: "saved" }));
          window.setTimeout(() => {
            setCellStatus((current) => (current[key] === "saved" ? { ...current, [key]: undefined } : current));
          }, 1200);
        })
        .catch((error) => {
          setData((current) => applySale(current, sellerId, date, previous));
          setCellStatus((current) => ({ ...current, [key]: "error" }));
          showToastRef.current(`Não foi possível salvar: ${error.message}`, "error");
        })
    );
    saveChainRef.current.set(key, chain);
  }, [setData]);

  const flushPending = useCallback(() => {
    pendingRef.current.forEach((pending) => {
      window.clearTimeout(pending.timer);
      commitCell(pending.sellerId, pending.date, pending.raw, pending.previous);
    });
    pendingRef.current.clear();
  }, [commitCell]);

  // Garante que nada digitado se perca ao trocar de mês ou sair da aba/página.
  useEffect(() => {
    setDrafts({});
    setCellStatus({});
    setExpenseForm(createEmptyExpenseForm(month));
    setEditingExpenseId(null);
    return () => flushPending();
  }, [month, flushPending]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!pendingRef.current.size) return;
      flushPending();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPending]);

  const handleCellChange = (sellerId, date, raw) => {
    const key = cellKey(sellerId, date);
    setDrafts((current) => ({ ...current, [key]: raw }));
    setCellStatus((current) => ({ ...current, [key]: "editing" }));
    const existing = pendingRef.current.get(key);
    if (existing) window.clearTimeout(existing.timer);
    const previous = existing ? existing.previous : (salesMap.has(key) ? salesMap.get(key) : null);
    const timer = window.setTimeout(() => {
      pendingRef.current.delete(key);
      commitCell(sellerId, date, raw, previous);
    }, AUTOSAVE_DELAY_MS);
    pendingRef.current.set(key, { timer, sellerId, date, raw, previous });
  };

  const handleCellBlur = (sellerId, date) => {
    const key = cellKey(sellerId, date);
    const pending = pendingRef.current.get(key);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRef.current.delete(key);
    commitCell(sellerId, date, pending.raw, pending.previous);
  };

  const focusCell = (rowIndex, colIndex) => {
    const target = tableRef.current?.querySelector(`input[data-row="${rowIndex}"][data-col="${colIndex}"]`);
    if (target) {
      target.focus();
      target.select();
    }
  };

  const handleCellKeyDown = (event, rowIndex, colIndex, sellerId, date) => {
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      focusCell(rowIndex + 1, colIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusCell(rowIndex - 1, colIndex);
    } else if (event.key === "Escape") {
      const key = cellKey(sellerId, date);
      const pending = pendingRef.current.get(key);
      if (pending) window.clearTimeout(pending.timer);
      pendingRef.current.delete(key);
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setCellStatus((current) => ({ ...current, [key]: undefined }));
    }
  };

  // ---- Vendedores (colunas) ----
  const handleAddSeller = async (event) => {
    event.preventDefault();
    const name = newSellerName.trim();
    if (!name) return;
    setIsMutatingSellers(true);
    try {
      const seller = await apiFetch("/api/tiktok/sellers", { method: "POST", body: JSON.stringify({ name }) });
      setData((current) => ({ ...current, sellers: [...current.sellers, seller] }));
      setNewSellerName("");
      showToast(`Vendedor ${seller.name} adicionado.`);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsMutatingSellers(false);
    }
  };

  const handleRenameSeller = async (seller, name) => {
    try {
      const updated = await apiFetch(`/api/tiktok/sellers/${seller.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setData((current) => ({
        ...current,
        sellers: current.sellers.map((item) => (item.id === seller.id ? { ...item, name: updated.name } : item)),
        archivedSellers: current.archivedSellers.map((item) => (item.id === seller.id ? { ...item, name: updated.name } : item)),
      }));
      showToast("Vendedor renomeado.");
      return true;
    } catch (error) {
      showToast(error.message, "error");
      return false;
    }
  };

  const handleArchiveSeller = async (seller) => {
    flushPending();
    setIsMutatingSellers(true);
    try {
      await apiFetch(`/api/tiktok/sellers/${seller.id}`, { method: "DELETE" });
      setData((current) => {
        const hasSalesThisMonth = current.sales.some((sale) => sale.seller_id === seller.id);
        const archived = { ...seller, archived: true };
        return {
          ...current,
          sellers: hasSalesThisMonth
            ? current.sellers.map((item) => (item.id === seller.id ? archived : item))
            : current.sellers.filter((item) => item.id !== seller.id),
          archivedSellers: [...current.archivedSellers.filter((item) => item.id !== seller.id), archived],
        };
      });
      showToast(`${seller.name} removido. Os lançamentos anteriores foram preservados.`);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsMutatingSellers(false);
    }
  };

  const handleRestoreSeller = async (seller) => {
    setIsMutatingSellers(true);
    try {
      const restored = await apiFetch(`/api/tiktok/sellers/${seller.id}/restore`, { method: "POST" });
      setData((current) => {
        const exists = current.sellers.some((item) => item.id === restored.id);
        const sellersList = exists
          ? current.sellers.map((item) => (item.id === restored.id ? restored : item))
          : [...current.sellers, restored].sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
        return {
          ...current,
          sellers: sellersList,
          archivedSellers: current.archivedSellers.filter((item) => item.id !== restored.id),
        };
      });
      showToast(`${restored.name} restaurado.`);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsMutatingSellers(false);
    }
  };

  // ---- Despesas do TikTok ----
  const updateExpenseField = (name, value) => setExpenseForm((current) => ({ ...current, [name]: value }));
  const resetExpenseForm = () => {
    setEditingExpenseId(null);
    setExpenseForm(createEmptyExpenseForm(month));
  };

  const handleExpenseSubmit = async (event) => {
    event.preventDefault();
    const amount = parseMoneyInput(expenseForm.amount);
    if (!amount || Number.isNaN(amount)) {
      showToast("Informe um valor maior que zero.", "error");
      return;
    }
    const payload = { ...expenseForm, amount };
    setIsSavingExpense(true);
    try {
      const saved = editingExpenseId
        ? await apiFetch(`/api/tiktok/expenses/${editingExpenseId}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch("/api/tiktok/expenses", { method: "POST", body: JSON.stringify(payload) });
      const normalized = { ...saved, id: Number(saved.id), amount: Number(saved.amount) || 0, date: String(saved.date).slice(0, 10), category: saved.category || "" };
      setData((current) => {
        const others = current.expenses.filter((item) => item.id !== normalized.id);
        const expenses = normalized.date.startsWith(current.month) ? [normalized, ...others] : others;
        return { ...current, expenses: expenses.sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id) };
      });
      showToast(editingExpenseId ? "Despesa do TikTok atualizada." : "Despesa do TikTok adicionada.");
      resetExpenseForm();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleEditExpense = (item) => {
    setEditingExpenseId(item.id);
    setExpenseForm({ description: item.description, amount: formatMoneyInput(item.amount), date: item.date, category: item.category || "" });
  };

  const handleDeleteExpense = async (item) => {
    setIsSavingExpense(true);
    try {
      await apiFetch(`/api/tiktok/expenses/${item.id}`, { method: "DELETE" });
      setData((current) => ({ ...current, expenses: current.expenses.filter((row) => row.id !== item.id) }));
      if (editingExpenseId === item.id) resetExpenseForm();
      showToast("Despesa do TikTok removida.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSavingExpense(false);
    }
  };

  const restorableSellers = data.archivedSellers.filter((seller) => !sellers.some((item) => item.id === seller.id));

  return (
    <>
      <AreaToast toast={toast} />

      <SummaryCards
        className="is-single"
        cards={[{
          label: "Receitas do mês",
          value: monthRevenue,
          tone: "card-green",
          icon: FaCircleArrowUp,
          hint: `${getMonthLabel(month)} · planilha de vendas`,
        }]}
      />

      {loadError ? (
        <p className="dashboard-source-warning" role="alert">
          Não foi possível carregar a planilha: {loadError}{" "}
          <button type="button" className="ghost-button" onClick={onReload}>Tentar novamente</button>
        </p>
      ) : null}

      <div className="card tiktok-sheet-card">
        <div className="tiktok-sheet-toolbar">
          <div className="tiktok-month-nav" aria-label="Navegação entre meses">
            <button type="button" className="tiktok-month-btn" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
            <strong className="tiktok-month-label">{getMonthLabel(month)}</strong>
            <button type="button" className="tiktok-month-btn" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
          </div>
          <form className="tiktok-add-seller" onSubmit={handleAddSeller}>
            <input
              style={areaFieldStyle}
              value={newSellerName}
              maxLength={60}
              placeholder="Nome do vendedor"
              aria-label="Nome do novo vendedor"
              onChange={(event) => setNewSellerName(event.target.value)}
            />
            <button type="submit" className="auth-submit" disabled={isMutatingSellers || !newSellerName.trim()}>
              + Vendedor
            </button>
          </form>
        </div>

        {isLoading ? (
          <p className="tiktok-sheet-empty">Carregando planilha...</p>
        ) : !sellers.length ? (
          <p className="tiktok-sheet-empty">Nenhum vendedor nesta planilha. Adicione um vendedor para criar a primeira coluna.</p>
        ) : (
          <div className="tiktok-sheet-scroll" ref={tableRef}>
            <table className="tiktok-sheet">
              <thead>
                <tr>
                  <th className="tiktok-col-date" scope="col">Data</th>
                  {sellers.map((seller) => (
                    <th key={seller.id} scope="col" className={seller.archived ? "is-archived" : ""}>
                      <SellerHeader
                        seller={seller}
                        onRename={handleRenameSeller}
                        onArchive={handleArchiveSeller}
                        onRestore={handleRestoreSeller}
                        disabled={isMutatingSellers}
                      />
                    </th>
                  ))}
                  <th className="tiktok-col-total" scope="col">Total diário</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day, rowIndex) => (
                  <tr key={day.date} className={`${day.isWeekend ? "is-weekend" : ""}${day.date === todayKey ? " is-today" : ""}`}>
                    <th scope="row" className="tiktok-col-date">
                      <span className="tiktok-day">{day.label}</span>
                      <span className="tiktok-weekday">{day.weekday}</span>
                    </th>
                    {sellers.map((seller, colIndex) => {
                      const key = cellKey(seller.id, day.date);
                      const value = drafts[key] ?? formatMoneyInput(salesMap.get(key));
                      const status = cellStatus[key];
                      return (
                        <td key={seller.id} className={`tiktok-cell${status ? ` is-${status}` : ""}`}>
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            data-row={rowIndex}
                            data-col={colIndex}
                            aria-label={`${seller.name} em ${formatDate(day.date)}`}
                            placeholder="–"
                            value={value}
                            onChange={(event) => handleCellChange(seller.id, day.date, event.target.value)}
                            onBlur={() => handleCellBlur(seller.id, day.date)}
                            onFocus={(event) => event.target.select()}
                            onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex, seller.id, day.date)}
                          />
                        </td>
                      );
                    })}
                    <td className={`tiktok-col-total${dayTotals[rowIndex] ? "" : " is-zero"}`}>{formatMoneyInput(dayTotals[rowIndex])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="tiktok-col-date">Total</th>
                  {sellers.map((seller, index) => (
                    <td key={seller.id}>{formatMoneyInput(sellerTotals[index])}</td>
                  ))}
                  <td className="tiktok-col-total tiktok-grand-total">{formatMoneyInput(monthRevenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="tiktok-sheet-footer">
          <span>Digite o valor direto na célula — salva automaticamente. Enter/↓ desce, ↑ sobe, Esc desfaz. Clique no nome para renomear.</span>
          {restorableSellers.length ? (
            <div className="tiktok-archived-list">
              <span>Removidos:</span>
              {restorableSellers.map((seller) => (
                <button key={seller.id} type="button" className="ghost-button" onClick={() => handleRestoreSeller(seller)} disabled={isMutatingSellers}>
                  ↺ {seller.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="tiktok-expenses-head">
          <h2>Despesas do TikTok</h2>
          <span className="tiktok-expenses-total">Total no mês: <strong>{currency(expensesTotal)}</strong></span>
        </div>
        <p className="area-form-note" style={{ marginTop: 0 }}>
          Controle próprio: não entra nas despesas gerais do Dashboard nem nas despesas do Uber.
        </p>
        <form onSubmit={handleExpenseSubmit} className="area-table-wrap">
          <table className="personal-table area-table">
            <thead>
              <tr>
                <th>Descrição</th>
                <th>Valor</th>
                <th>Data</th>
                <th>Categoria</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <input style={areaFieldStyle} value={expenseForm.description} maxLength={120} placeholder="Ex.: Impulsionamento" onChange={(event) => updateExpenseField("description", event.target.value)} required aria-label="Descrição da despesa" />
                </td>
                <td>
                  <input style={areaFieldStyle} inputMode="decimal" value={expenseForm.amount} placeholder="0,00" onChange={(event) => updateExpenseField("amount", event.target.value)} required aria-label="Valor da despesa" />
                </td>
                <td>
                  <input type="date" style={areaFieldStyle} value={expenseForm.date} onChange={(event) => updateExpenseField("date", event.target.value)} required aria-label="Data da despesa" />
                </td>
                <td>
                  <input list="tiktok-expense-categories" style={areaFieldStyle} value={expenseForm.category} maxLength={60} placeholder="Categoria" onChange={(event) => updateExpenseField("category", event.target.value)} aria-label="Categoria da despesa" />
                  <datalist id="tiktok-expense-categories">
                    {TIKTOK_EXPENSE_CATEGORIES.map((category) => <option key={category} value={category} />)}
                  </datalist>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="submit" className="auth-submit" disabled={isSavingExpense}>
                      {isSavingExpense ? "Salvando..." : editingExpenseId ? "Salvar" : "Adicionar"}
                    </button>
                    {editingExpenseId ? (
                      <button type="button" className="auth-outline-button" onClick={resetExpenseForm}>Cancelar</button>
                    ) : null}
                  </div>
                </td>
              </tr>
              {data.expenses.length ? (
                data.expenses.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{currency(item.amount)}</td>
                    <td>{formatDate(item.date)}</td>
                    <td>{item.category || "-"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="password-btn icon-action-btn" onClick={() => handleEditExpense(item)} title="Editar" aria-label="Editar">✏️</button>
                        <button type="button" className="logout-btn icon-action-btn" onClick={() => handleDeleteExpense(item)} disabled={isSavingExpense} title="Excluir" aria-label="Excluir">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center" }}>Nenhuma despesa do TikTok neste mês.</td>
                </tr>
              )}
            </tbody>
          </table>
        </form>
      </div>
    </>
  );
}
