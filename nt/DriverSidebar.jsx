import React from "react";
import { NavLink } from "react-router-dom";
import { getProfileTypeLabel, isPessoalProfile } from "./profile-type";

function SidebarBrandLogo({ homePath, homeLabel }) {
  return (
    <NavLink
      to={homePath}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textDecoration: "none" }}
      aria-label={homeLabel}
    >
      <img
        src="/nt-driver-logo.svg"
        alt="Nt driver logo"
        style={{ width: 30, height: 30, borderRadius: 7, background: "#fff" }}
      />
      <span style={{ fontWeight: 800, fontSize: 23, color: "#fff", letterSpacing: "-0.2px", fontFamily: "Inter, Arial, sans-serif" }}>Nt driver</span>
    </NavLink>
  );
}

function SidebarIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sidebar-svg-icon">
      {children}
    </svg>
  );
}

const icons = {
  dashboard: (
    <SidebarIcon>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </SidebarIcon>
  ),
  register: (
    <SidebarIcon>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </SidebarIcon>
  ),
  history: (
    <SidebarIcon>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 0 4 23V5.5A2.5 2.5 0 0 1 6.5 3Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </SidebarIcon>
  ),
  performance: (
    <SidebarIcon>
      <path d="M4 19V5" />
      <path d="M10 19v-8" />
      <path d="M16 19v-4" />
      <path d="M22 19V9" />
    </SidebarIcon>
  ),
  goals: (
    <SidebarIcon>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="m12 2 1.5 3.5L17 7l-3.5 1.5L12 12l-1.5-3.5L7 7l3.5-1.5Z" />
    </SidebarIcon>
  ),
  expenses: (
    <SidebarIcon>
      <path d="M3 7h18v10H3z" />
      <path d="M7 11h10" />
      <path d="M7 15h4" />
    </SidebarIcon>
  ),
  income: (
    <SidebarIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8" />
      <path d="M9 11l3-3 3 3" />
    </SidebarIcon>
  ),
  notes: (
    <SidebarIcon>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </SidebarIcon>
  ),
  users: (
    <SidebarIcon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </SidebarIcon>
  ),
  profile: (
    <SidebarIcon>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </SidebarIcon>
  ),
};

const driverPrimaryItems = [
  { to: "/driver", label: "Dashboard", icon: icons.dashboard, end: true },
  { to: "/driver/register", label: "Registrar", icon: icons.register },
  { to: "/driver/history", label: "Histórico", icon: icons.history },
  { to: "/driver/performance", label: "Desempenho", icon: icons.performance },
  { to: "/driver/summary", label: "Metas", icon: icons.goals },
  { to: "/driver/expenses", label: "Despesas", icon: icons.expenses },
];

const personalPrimaryItems = [
  { to: "/driver", label: "Dashboard", icon: icons.dashboard, end: true },
  { to: "/driver/receitas", label: "Receitas", icon: icons.income },
  { to: "/driver/expenses", label: "Despesas", icon: icons.expenses },
  { to: "/driver/resumo", label: "Resumo", icon: icons.performance },
];

export default function DriverSidebar({ user }) {
  const adminItems = user?.isAdmin
    ? [
        { to: "/driver/notes", label: "Bloco de notas", icon: icons.notes },
        { to: "/driver/users", label: "Usuários", icon: icons.users },
      ]
    : [];

  const primaryItems = isPessoalProfile(user?.profileType) ? personalPrimaryItems : driverPrimaryItems;
  const navItems = [...primaryItems, ...adminItems];

  return (
    <aside className="sidebar">

      <div className="sidebar-header">
        <SidebarBrandLogo homePath="/driver" homeLabel="Ir para o Dashboard" />
      </div>

      <nav className="sidebar-nav" aria-label="Navegação do motorista">
        {navItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-btn sidebar-link${isActive ? " active" : ""}`}
          >
            <span className="sidebar-link-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-card sidebar-profile-card">
        <div className="sidebar-profile-label">Meu Perfil</div>
        <strong style={{ display: "block", marginBottom: 8 }}>{user?.name || "Meu Perfil"}</strong>
        <p className="sidebar-profile-text">
          {user ? `${user.email} • ${getProfileTypeLabel(user.profileType)}` : "Layout React conectado ao visual novo."}
        </p>
      </div>
    </aside>
  );
}
