import React, { useEffect, useState } from "react";
import { apiFetch } from "./http";

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getDaysLeft(trialEndsAt) {
  if (!trialEndsAt) return 0;
  const diffMs = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export default function SubscriptionGate({ user, onLogout, onRefresh }) {
  const [pixInfo, setPixInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isNotifying, setIsNotifying] = useState(false);
  const [notified, setNotified] = useState(user?.subscriptionStatus === "pending_review");

  const daysLeft = getDaysLeft(user?.subscriptionTrialEndsAt);
  const isTrialExpired = user?.subscriptionStatus === "trial" && daysLeft <= 0;

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/auth/subscription/pix-info")
      .then((payload) => {
        if (!cancelled) setPixInfo(payload);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    if (!pixInfo?.copyPasteCode) return;
    try {
      await navigator.clipboard.writeText(pixInfo.copyPasteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      setLoadError("Não foi possível copiar automaticamente. Selecione o código manualmente.");
    }
  };

  const handleNotifyPayment = async () => {
    setIsNotifying(true);
    try {
      await apiFetch("/api/auth/subscription/notify-payment", { method: "POST" });
      setNotified(true);
      if (onRefresh) await onRefresh();
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsNotifying(false);
    }
  };

  return (
    <div className="auth-gate" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", padding: 16 }}>
      <div className="auth-card" style={{ boxShadow: "0 8px 32px rgba(34,197,94,0.10), 0 2px 8px rgba(59,130,246,0.10)", borderRadius: 32, padding: 40, maxWidth: 440, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <strong style={{ fontSize: 26, color: "#2563eb", letterSpacing: "-1px" }}>NT Driver</strong>
          <p style={{ color: "#3e5472", fontSize: 16, margin: "8px 0 0" }}>
            {isTrialExpired ? "Seu período de teste acabou" : "Libere o acesso vitalício"}
          </p>
        </div>

        {!isTrialExpired && user?.subscriptionStatus === "trial" ? (
          <p style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 10, padding: "10px 14px", fontSize: 14, textAlign: "center" }}>
            Você ainda tem {daysLeft} dia{daysLeft === 1 ? "" : "s"} de teste grátis. Pode pagar a qualquer momento para não perder o acesso depois.
          </p>
        ) : null}

        {notified ? (
          <div style={{ background: "#f0fdf4", color: "#166534", borderRadius: 10, padding: "14px", fontSize: 14, textAlign: "center", marginTop: 12 }}>
            Recebemos seu aviso de pagamento. Assim que confirmarmos, seu acesso é liberado automaticamente.
          </div>
        ) : null}

        {loadError ? (
          <p style={{ color: "#b91c1c", fontSize: 14, textAlign: "center", marginTop: 12 }}>{loadError}</p>
        ) : null}

        {pixInfo ? (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <p style={{ margin: 0, fontSize: 15, color: "#0f172a", textAlign: "center" }}>
              {pixInfo.label} — pagamento único de <strong>{formatCurrency(pixInfo.amount)}</strong>
            </p>

            {pixInfo.qrDataUrl ? (
              <img
                src={pixInfo.qrDataUrl}
                alt="QR Code PIX"
                style={{ width: 220, height: 220, borderRadius: 12, border: "1px solid #d1d5db" }}
              />
            ) : null}

            <div style={{ width: "100%" }}>
              <label style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>Pix copia e cola</label>
              <textarea
                readOnly
                value={pixInfo.copyPasteCode}
                onFocus={(event) => event.target.select()}
                style={{ width: "100%", minHeight: 70, marginTop: 4, padding: 10, borderRadius: 8, border: "1px solid #d1d5db", fontSize: 12, fontFamily: "monospace", resize: "none" }}
              />
            </div>

            <button type="button" className="auth-outline-button auth-main-button" style={{ width: "100%" }} onClick={handleCopy}>
              {copied ? "Código copiado!" : "Copiar código Pix"}
            </button>

            <p style={{ margin: 0, fontSize: 13, color: "#64748b", textAlign: "center" }}>
              Recebedor: {pixInfo.recipientName} • {pixInfo.recipientCity}
            </p>

            <button
              type="button"
              className="auth-submit auth-main-button"
              style={{ width: "100%" }}
              disabled={isNotifying}
              onClick={handleNotifyPayment}
            >
              {isNotifying ? "Enviando..." : "Já paguei"}
            </button>
          </div>
        ) : !loadError ? (
          <p style={{ textAlign: "center", color: "#64748b", marginTop: 20 }}>Carregando dados de pagamento...</p>
        ) : null}

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button
            type="button"
            className="auth-link-button"
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: 14 }}
            onClick={onLogout}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
