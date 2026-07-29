import React from "react";

export default function CardResumo({ label, value, color = "blue", icon }) {
  const colorMap = {
    green: "#22c55e",
    red: "#ef4444",
    blue: "#3b82f6",
  };
  return (
    <div
      className="card-resumo"
      style={{
        background: "var(--panel)",
        borderRadius: 18,
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
        padding: 18,
        minWidth: 120,
        minHeight: 70,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        borderLeft: `6px solid ${colorMap[color]}`,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ color: colorMap[color], marginRight: 6 }}>{icon}</span>}
        <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>
      </div>
      <span style={{ color: colorMap[color], fontWeight: 700, fontSize: 20 }}>
        R$ {value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}
