export async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const raw = await response.text();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      payload = raw;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && payload.error) ||
      (payload && typeof payload === "object" && payload.message) ||
      `Falha na requisicao (${response.status}).`;
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.payload = payload;
    // Conta bloqueada pelo administrador: o servidor já encerrou a sessão; o layout volta ao login.
    if (response.status === 401 && payload && payload.code === "account_blocked" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nt:account-blocked", { detail: { message } }));
    }
    throw requestError;
  }

  return payload;
}
