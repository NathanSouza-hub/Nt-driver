import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { MONTH_NAMES, getCurrentMonthKey, getYearOptions } from "./driver-data";
import { apiFetch } from "./http";
import { isPessoalProfile } from "./profile-type";
import AuthScreen from "./AuthScreen";
import SubscriptionGate from "./Subscription";
import DriverSidebar from "./DriverSidebar";

const PERSONAL_ALLOWED_PATHS = new Set(["/driver", "/driver/receitas", "/driver/expenses", "/driver/resumo", "/driver/profile"]);
const PERSONAL_HOME_PATH = "/driver";

export default function DriverLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [records, setRecords] = useState([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [canRegister, setCanRegister] = useState(false);
  const [dashboardMonth, setDashboardMonth] = useState(getCurrentMonthKey());
  const [historyMonth, setHistoryMonth] = useState(getCurrentMonthKey());
  const [performanceMonth, setPerformanceMonth] = useState(getCurrentMonthKey());
  const [summaryMonth, setSummaryMonth] = useState(getCurrentMonthKey());
  const [expensesMonth, setExpensesMonth] = useState(getCurrentMonthKey());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth > 1000;
  });
  const profileMenuRef = useRef(null);
  const isDashboardPage = location.pathname === "/driver";
  const isHistoryPage = location.pathname === "/driver/history";
  const isPerformancePage = location.pathname === "/driver/performance";
  const isSummaryPage = location.pathname === "/driver/summary";
  const isExpensesPage = location.pathname === "/driver/expenses";
  const isReceitasPage = location.pathname === "/driver/receitas";
  const isResumoPage = location.pathname === "/driver/resumo";
  const isPersonalProfile = isPessoalProfile(user?.profileType);
  const topbarYearOptions = useMemo(() => getYearOptions(records), [records]);
  const isDashboardMonth = isDashboardPage && !isPersonalProfile;
  const selectedMonthKey = isDashboardMonth
    ? dashboardMonth
    : isHistoryPage
      ? historyMonth
      : isPerformancePage
        ? performanceMonth
        : isSummaryPage
          ? summaryMonth
          : expensesMonth;
  const [selectedYear, selectedMonth] = String(selectedMonthKey || getCurrentMonthKey()).split("-").map(Number);
  const topbarPeriodLabel = isDashboardMonth
    ? "do dashboard"
    : isHistoryPage
      ? "do histórico"
      : isPerformancePage
        ? "do desempenho"
        : isSummaryPage
          ? "das metas"
          : isReceitasPage
            ? "das receitas"
            : isResumoPage
              ? "do resumo"
              : "das despesas";

  const setSelectedPeriod = (year, month) => {
    const nextMonth = `${year}-${String(month).padStart(2, "0")}`;
    if (isDashboardMonth) setDashboardMonth(nextMonth);
    else if (isHistoryPage) setHistoryMonth(nextMonth);
    else if (isPerformancePage) setPerformanceMonth(nextMonth);
    else if (isSummaryPage) setSummaryMonth(nextMonth);
    else setExpensesMonth(nextMonth);
  };

  const userInitial = useMemo(() => {
    const initial = String(user?.name || "U").trim().charAt(0);
    return initial ? initial.toUpperCase() : "U";
  }, [user?.name]);

  const loadRegisterStatus = useCallback(async () => {
    try {
      const payload = await apiFetch("/api/auth/register-status");
      setCanRegister(Boolean(payload?.publicRegisterEnabled));
    } catch (error) {
      setCanRegister(false);
    }
  }, []);

  const refreshRecords = useCallback(async () => {
    const payload = await apiFetch("/api/records");
    setRecords(Array.isArray(payload) ? payload : []);
  }, []);

  const refreshSession = useCallback(async () => {
    let nextUser = null;
    try {
      const payload = await apiFetch("/api/auth/me");
      nextUser = payload?.user || null;
      setUser(nextUser);
    } catch (error) {
      setUser(null);
      setRecords([]);
      setAuthChecked(true);
      return;
    }

    if (nextUser?.subscriptionActive) {
      try {
        await refreshRecords();
      } catch (error) {
        setRecords([]);
      }
    } else {
      setRecords([]);
    }

    setAuthChecked(true);
  }, [refreshRecords]);

  useEffect(() => {
    loadRegisterStatus();
    refreshSession();
  }, [loadRegisterStatus, refreshSession]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 1000) {
        setSidebarOpen(true);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (window.innerWidth <= 1000) {
      setSidebarOpen(false);
    }
    setProfileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const handleLogin = async (credentials) => {
    await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    await refreshSession();
    navigate("/driver", { replace: true });
  };

  const handleRegister = async (payload) => {
    const result = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result?.user) {
      await refreshSession();
      navigate("/driver", { replace: true });
    }
    return result;
  };

  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    await refreshSession();
  };

  if (!authChecked) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <p className="auth-message" style={{ color: "var(--text)" }}>
            Carregando...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen canRegister={canRegister} onLogin={handleLogin} onRegister={handleRegister} />;
  }

  if (!user.isAdmin && !user.subscriptionActive) {
    return <SubscriptionGate user={user} onLogout={handleLogout} onRefresh={refreshSession} />;
  }

  if (isPessoalProfile(user.profileType) && !PERSONAL_ALLOWED_PATHS.has(location.pathname)) {
    return <Navigate to={PERSONAL_HOME_PATH} replace />;
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <DriverSidebar user={user} />
      <main className="content">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <button
              type="button"
              className="app-topbar-menu"
              aria-label={sidebarOpen ? "Fechar menu lateral" : "Abrir menu lateral"}
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              ☰
            </button>
            {isDashboardPage || isHistoryPage || isPerformancePage || isSummaryPage || isExpensesPage || isReceitasPage || isResumoPage ? (
              <>
                <select
                  className="app-topbar-month-select app-topbar-year-select"
                  aria-label={`Selecionar ano ${topbarPeriodLabel}`}
                  value={selectedYear}
                  onChange={(event) => setSelectedPeriod(Number(event.target.value), selectedMonth)}
                >
                  {topbarYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <select
                  className="app-topbar-month-select"
                  aria-label={`Selecionar mês ${topbarPeriodLabel}`}
                  value={selectedMonth}
                  onChange={(event) => setSelectedPeriod(selectedYear, Number(event.target.value))}
                >
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>

          <div className="app-topbar-spacer" aria-hidden="true" />

          <div className="app-topbar-profile-wrap" ref={profileMenuRef}>
            <button
              type="button"
              className="app-topbar-profile"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
              onClick={() => setProfileMenuOpen((current) => !current)}
            >
              <span className="app-topbar-avatar" aria-hidden="true">{userInitial}</span>
              <span className="app-topbar-name">{user?.name || "Perfil"}</span>
            </button>
            {profileMenuOpen ? (
              <div className="app-topbar-profile-menu" role="menu">
                <button
                  type="button"
                  className="app-topbar-profile-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    navigate("/driver/profile");
                  }}
                >
                  Meu Perfil
                </button>
                <button
                  type="button"
                  className="app-topbar-profile-menu-item app-topbar-profile-menu-item-danger"
                  role="menuitem"
                  onClick={async () => {
                    setProfileMenuOpen(false);
                    await handleLogout();
                  }}
                >
                  Sair
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="content-body">
          <Outlet
            context={{
              user,
              records,
              refreshRecords,
              refreshSession,
              onLogout: handleLogout,
              dashboardMonth,
              setDashboardMonth,
              historyMonth,
              setHistoryMonth,
              performanceMonth,
              setPerformanceMonth,
              summaryMonth,
              setSummaryMonth,
              expensesMonth,
              setExpensesMonth,
            }}
          />
        </div>
      </main>
    </div>
  );
}
