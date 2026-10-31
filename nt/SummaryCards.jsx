import React from "react";
import { currency } from "./driver-data";

// Mesmo padrão visual dos cards de Receitas / Despesas / Saldo que já existiam no Dashboard.
export const summaryCardStyles = {
  "card-green": {
    background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)",
    color: "#ffffff",
    border: "none",
  },
  "card-red": {
    background: "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
    color: "#ffffff",
    border: "none",
  },
  "card-blue": {
    background: "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
    color: "#ffffff",
    border: "none",
  },
};

export default function SummaryCards({ cards, className = "" }) {
  return (
    <div className={`summary-grid dashboard-summary-cards${className ? ` ${className}` : ""}`}>
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="card" style={summaryCardStyles[card.tone]}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "rgba(255,255,255,0.82)" }}>{card.label}</span>
                <strong>{currency(card.value)}</strong>
                {card.hint ? <small style={{ color: "rgba(255,255,255,0.78)" }}>{card.hint}</small> : null}
              </div>
              {Icon ? (
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 42,
                    height: 42,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.16)",
                    color: "#ffffff",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={20} />
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
