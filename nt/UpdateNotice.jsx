import React, { useCallback, useEffect, useState } from "react";

// Build carregado nesta aba (definido no vite.config.mjs). Em desenvolvimento não há version.json.
const CURRENT_BUILD_ID = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function fetchDeployedBuildId() {
  const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return "";
  const payload = await response.json();
  return typeof payload?.buildId === "string" ? payload.buildId : "";
}

// Há um modal com formulário aberto? Recarregar perderia o que ainda não foi salvo.
const hasOpenForm = () => Boolean(document.querySelector(".password-modal:not(.hidden) input, .password-modal:not(.hidden) textarea"));

// Aviso de versão nova: procura um deploy novo a cada 5 minutos, ao voltar para a aba e ao
// reconectar. Só recarrega quando a pessoa confirma em "Atualizar".
export default function UpdateNotice() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const check = useCallback(async () => {
    if (!CURRENT_BUILD_ID || document.visibilityState !== "visible" || !navigator.onLine) return;
    try {
      const deployed = await fetchDeployedBuildId();
      if (deployed && deployed !== CURRENT_BUILD_ID) setHasUpdate(true);
    } catch {
      // Sem rede ou servidor reiniciando: tenta de novo na próxima verificação.
    }
  }, []);

  useEffect(() => {
    if (!CURRENT_BUILD_ID) return undefined;
    // Ao voltar para o app: procura versão nova e reexibe o aviso adiado com "Depois".
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setDismissed(false);
      check();
    };
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [check]);

  if (!hasUpdate || dismissed) return null;

  const reload = () => window.location.reload();
  const requestUpdate = () => (hasOpenForm() ? setConfirming(true) : reload());

  return (
    <section className="update-notice" role="status" aria-live="polite" aria-label="Nova versão do app">
      <div className="update-notice-text">
        <span className="update-notice-icon" aria-hidden="true">⟳</span>
        <div>
          <strong>Nova atualização disponível</strong>
          {confirming ? (
            <p>Há um formulário aberto. Ao atualizar, o que foi digitado e não salvo será perdido.</p>
          ) : (
            <p>Toque em Atualizar para usar a versão mais recente do Nt Driver.</p>
          )}
        </div>
      </div>
      <div className="update-notice-actions">
        {confirming ? (
          <>
            <button type="button" className="auth-outline-button" onClick={() => setConfirming(false)}>Continuar editando</button>
            <button type="button" className="auth-submit" onClick={reload}>Atualizar mesmo assim</button>
          </>
        ) : (
          <>
            <button type="button" className="auth-outline-button" onClick={() => setDismissed(true)}>Depois</button>
            <button type="button" className="auth-submit" onClick={requestUpdate}>Atualizar</button>
          </>
        )}
      </div>
    </section>
  );
}
