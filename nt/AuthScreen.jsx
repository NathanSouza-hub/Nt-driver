import React, { useEffect, useMemo, useState } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa6";
import { useLocation } from "react-router-dom";

const AUTH_QUERY_MESSAGES = {
  email_verified: {
    text: "Email confirmado com sucesso. Agora você já pode entrar.",
    tone: "success",
  },
  verification_expired: {
    text: "O link de verificação expirou. Peça um novo email de confirmação.",
    tone: "error",
  },
  verification_invalid: {
    text: "O link de verificação é inválido ou já foi usado.",
    tone: "error",
  },
};

const PASSWORD_HINT = "Use pelo menos 8 caracteres com letra maiúscula, minúscula, número e símbolo.";

function getPasswordValidationMessage(password) {
  const rawPassword = String(password || "");
  if (rawPassword.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
  if (!/[a-z]/.test(rawPassword)) return "A senha deve ter ao menos uma letra minúscula.";
  if (!/[A-Z]/.test(rawPassword)) return "A senha deve ter ao menos uma letra maiúscula.";
  if (!/\d/.test(rawPassword)) return "A senha deve ter ao menos um número.";
  if (!/[^A-Za-z0-9]/.test(rawPassword)) return "A senha deve ter ao menos um caractere especial.";
  return "";
}


function AuthBrandLogo() {
  // Logo maior, centralizado, com sombra
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
      <img
        src="/nt-driver-logo.svg"
        alt="Nt driver logo"
        style={{ width: 180, height: 180, boxShadow: '0 8px 32px rgba(34,197,94,0.10), 0 2px 8px rgba(59,130,246,0.10)', borderRadius: 32, background: '#fff' }}
      />
    </div>
  );
}

export default function AuthScreen({ canRegister, onLogin, onRegister }) {
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [toast, setToast] = useState({ text: "", tone: "success" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [isLoginPasswordVisible, setIsLoginPasswordVisible] = useState(false);
  const [isRegisterPasswordVisible, setIsRegisterPasswordVisible] = useState(false);
  const [isResetPasswordVisible, setIsResetPasswordVisible] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [loginForm, setLoginForm] = useState({ name: "", email: "", password: "" });
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [resetForm, setResetForm] = useState({ email: "", token: "", newPassword: "" });
  const [registerForm, setRegisterForm] = useState({
    name: "",
    celular: "",
    email: "",
    password: "",
    profileType: "driver",
  });
  const passwordValidationMessage = useMemo(() => getPasswordValidationMessage(registerForm.password), [registerForm.password]);

  const showToast = (text, tone = "success") => {
    setToast({ text: String(text || ""), tone });
  };

  useEffect(() => {
    if (!toast.text) return undefined;
    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current.text === toast.text ? { text: "", tone: "success" } : current));
    }, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authMessage = params.get("authMessage");
    const authMode = params.get("authMode");
    const authEmail = params.get("authEmail") || "";
    const resetEmail = params.get("email") || "";
    const resetToken = params.get("resetToken") || "";

    if (!authMessage && !authMode && !authEmail && !resetEmail && !resetToken) return;

    if (resetEmail && resetToken) {
      setMode("reset");
      setResetForm({ email: resetEmail, token: resetToken, newPassword: "" });
      setLoginForm((current) => ({ ...current, email: resetEmail }));
    }

    if (authMode === "login" || authMessage) {
      setMode("login");
    }
    if (authEmail) {
      setPendingVerificationEmail(authEmail);
      setLoginForm((current) => ({ ...current, email: authEmail }));
      setForgotPasswordEmail(authEmail);
    }
    if (AUTH_QUERY_MESSAGES[authMessage]) {
      showToast(AUTH_QUERY_MESSAGES[authMessage].text, AUTH_QUERY_MESSAGES[authMessage].tone);
    }

    const nextUrl = `${window.location.origin}${location.pathname}`;
    window.history.replaceState({}, document.title, nextUrl);
  }, [location.pathname, location.search]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setToast({ text: "", tone: "success" });
    setIsSubmitting(true);
    try {
      await onLogin(loginForm);
    } catch (error) {
      if (error?.payload?.code === "EMAIL_NOT_VERIFIED") {
        setPendingVerificationEmail(error.payload.email || loginForm.email);
      }
      showToast(error.message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setToast({ text: "", tone: "success" });
    const passwordError = getPasswordValidationMessage(registerForm.password);
    if (passwordError) {
      showToast(passwordError, "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = await onRegister(registerForm);
      if (payload?.requiresEmailVerification) {
        setPendingVerificationEmail(payload.email || registerForm.email);
        setLoginForm((current) => ({ ...current, email: payload.email || registerForm.email }));
        setRegisterForm((current) => ({ ...current, password: "" }));
        setMode("login");
      }
      showToast(payload?.message || "Cadastro enviado.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    const email = pendingVerificationEmail || loginForm.email;
    if (!email) {
      showToast("Informe o email para reenviar a verificação.", "error");
      return;
    }

    setIsResendingVerification(true);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      showToast(payload?.message || "Se o email existir, enviaremos um novo link de verificação.");
    } catch (error) {
      showToast("Não foi possível reenviar o email agora.", "error");
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    const email = String(forgotPasswordEmail || loginForm.email || "").trim();
    if (!email) {
      showToast("Informe o email para recuperar a senha.", "error");
      return;
    }

    setToast({ text: "", tone: "success" });
    setIsSubmitting(true);
    try {
      const payload = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      }).then((response) => response.json().catch(() => ({})));
      setForgotPasswordEmail(email);
      showToast(payload?.message || "Se o email existir, enviaremos instruções de recuperação.");
      setMode("login");
      setLoginForm((current) => ({ ...current, email }));
    } catch (error) {
      showToast("Não foi possível enviar a recuperação agora.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    setToast({ text: "", tone: "success" });
    const passwordError = getPasswordValidationMessage(resetForm.newPassword);
    if (passwordError) {
      showToast(passwordError, "error");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: resetForm.email,
          token: resetForm.token,
          newPassword: resetForm.newPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível redefinir a senha.");
      }

      setResetForm({ email: "", token: "", newPassword: "" });
      setMode("login");
      setLoginForm((current) => ({ ...current, email: resetForm.email, password: "" }));
      showToast("Senha redefinida com sucesso. Agora você já pode entrar.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-gate" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
      <div
        className={`app-toast auth-toast${toast.text ? " visible" : ""}${toast.tone === "error" ? " error" : ""}`}
        role={toast.tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {toast.text}
      </div>
      <div className="auth-card" style={{ boxShadow: '0 8px 32px rgba(34,197,94,0.10), 0 2px 8px rgba(59,130,246,0.10)', borderRadius: 32, padding: 40, maxWidth: 420, width: '100%' }}>
        <div className="auth-brand-panel" style={{ marginBottom: 18 }}>
          <AuthBrandLogo />
          <div className="auth-brand-copy" style={{ marginTop: 8 }}>
            <strong className="brand auth-panel-brand" style={{ fontSize: 32, color: '#2563eb', letterSpacing: '-1px' }}>NT Driver</strong>
            <p className="auth-panel-subtitle" style={{ color: '#3e5472', fontSize: 18, margin: 0 }}>Controle financeiro</p>
          </div>
        </div>

        <div className="auth-form-panel" style={{ marginTop: 18 }}>
          {mode === "login" ? (
            <form className="auth-login-form" onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label htmlFor="login-email" style={{ fontWeight: 600, color: '#0f172a' }}>Email</label>
              <input
                id="login-email"
                type="email"
                className="auth-main-input"
                placeholder="Email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                required
                style={{ padding: '12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16, marginBottom: 4 }}
              />
              <label htmlFor="login-password" style={{ fontWeight: 600, color: '#0f172a' }}>Senha</label>
              <div className="auth-password-field">
                <input
                  id="login-password"
                  type={isLoginPasswordVisible ? "text" : "password"}
                  className="auth-main-input auth-password-input"
                  placeholder="Senha"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  style={{ padding: '12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16, marginBottom: 4 }}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setIsLoginPasswordVisible((current) => !current)}
                  aria-label={isLoginPasswordVisible ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={isLoginPasswordVisible}
                >
                  {isLoginPasswordVisible ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
                </button>
              </div>
              <div style={{ textAlign: 'right', marginBottom: 10 }}>
                <button
                  type="button"
                  className="auth-link-button"
                  style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, fontSize: 15 }}
                  onClick={() => {
                    setForgotPasswordEmail(loginForm.email);
                    setMode("forgot");
                  }}
                >
                  Esqueci a senha
                </button>
              </div>
              <div className="auth-main-actions" style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="submit" className="auth-submit auth-main-button" disabled={isSubmitting} style={{ flex: 1 }}>
                  {isSubmitting ? "Entrando..." : "Entrar"}
                </button>
                <button type="button" className="auth-outline-button auth-main-button" onClick={() => setMode("register")}> 
                  Cadastrar
                </button>
              </div>
              {pendingVerificationEmail ? (
                <button
                  type="button"
                  className="auth-link-button"
                  onClick={handleResendVerification}
                  disabled={isResendingVerification}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: 15, textAlign: "left" }}
                >
                  {isResendingVerification ? "Reenviando verificação..." : `Reenviar verificação para ${pendingVerificationEmail}`}
                </button>
              ) : null}
            </form>
          ) : mode === "forgot" ? (
            <form className="auth-login-form" onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <strong className="auth-form-title" style={{ fontSize: 22, color: '#2563eb', marginBottom: 8 }}>Recuperar senha</strong>
              <label htmlFor="forgot-password-email" style={{ fontWeight: 600, color: '#0f172a' }}>Email</label>
              <input
                id="forgot-password-email"
                type="email"
                className="auth-main-input"
                placeholder="Email"
                value={forgotPasswordEmail}
                onChange={(event) => setForgotPasswordEmail(event.target.value)}
                required
              />
              <div className="auth-main-actions" style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="submit" className="auth-submit auth-main-button" disabled={isSubmitting} style={{ flex: 1 }}>
                  {isSubmitting ? "Enviando..." : "Enviar link"}
                </button>
                <button type="button" className="auth-outline-button auth-main-button" onClick={() => setMode("login")}>
                  Voltar
                </button>
              </div>
            </form>
          ) : mode === "reset" ? (
            <form className="auth-register-form" onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <strong className="auth-form-title" style={{ fontSize: 22, color: '#2563eb', marginBottom: 8 }}>Redefinir senha</strong>
              <label htmlFor="reset-password-email" style={{ fontWeight: 600, color: '#0f172a' }}>Email</label>
              <input id="reset-password-email" type="email" value={resetForm.email} disabled />
              <label htmlFor="reset-password-new" style={{ fontWeight: 600, color: '#0f172a' }}>Nova senha</label>
              <div className="auth-password-field">
                <input
                  id="reset-password-new"
                  type={isResetPasswordVisible ? "text" : "password"}
                  className="auth-password-input"
                  value={resetForm.newPassword}
                  onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setIsResetPasswordVisible((current) => !current)}
                  aria-label={isResetPasswordVisible ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={isResetPasswordVisible}
                >
                  {isResetPasswordVisible ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
                </button>
              </div>
              <p style={{ margin: "-8px 0 0", color: passwordValidationMessage ? "#475569" : "#475569", fontSize: 13 }}>
                {PASSWORD_HINT}
              </p>
              <div className="auth-main-actions" style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="submit" className="auth-submit auth-main-button" disabled={isSubmitting} style={{ flex: 1 }}>
                  {isSubmitting ? "Salvando..." : "Salvar nova senha"}
                </button>
                <button type="button" className="auth-outline-button auth-main-button" onClick={() => setMode("login")}>
                  Voltar
                </button>
              </div>
            </form>
          ) : canRegister ? (
            <form className="auth-register-form" onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <strong className="auth-form-title" style={{ fontSize: 22, color: '#2563eb', marginBottom: 8 }}>Cadastrar</strong>
              <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Tipo de perfil">
                <button
                  type="button"
                  className={registerForm.profileType === "driver" ? "auth-submit" : "auth-outline-button"}
                  style={{ flex: 1 }}
                  aria-pressed={registerForm.profileType === "driver"}
                  onClick={() => setRegisterForm((current) => ({ ...current, profileType: "driver" }))}
                >
                  Motorista
                </button>
                <button
                  type="button"
                  className={registerForm.profileType === "pessoal" ? "auth-submit" : "auth-outline-button"}
                  style={{ flex: 1 }}
                  aria-pressed={registerForm.profileType === "pessoal"}
                  onClick={() => setRegisterForm((current) => ({ ...current, profileType: "pessoal" }))}
                >
                  Perfil pessoal
                </button>
              </div>
              <label htmlFor="register-name" style={{ fontWeight: 600, color: '#0f172a' }}>Nome</label>
              <input
                id="register-name"
                type="text"
                value={registerForm.name}
                onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
              <label htmlFor="register-email" style={{ fontWeight: 600, color: '#0f172a' }}>Email</label>
              <input
                id="register-email"
                type="email"
                value={registerForm.email}
                onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
              <label htmlFor="register-celular" style={{ fontWeight: 600, color: '#0f172a' }}>Celular</label>
              <input
                id="register-celular"
                type="tel"
                value={registerForm.celular}
                onChange={(event) => setRegisterForm((current) => ({ ...current, celular: event.target.value }))}
                required
              />
              <label htmlFor="register-password" style={{ fontWeight: 600, color: '#0f172a' }}>Senha</label>
              <div className="auth-password-field">
                <input
                  id="register-password"
                  type={isRegisterPasswordVisible ? "text" : "password"}
                  className="auth-password-input"
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setIsRegisterPasswordVisible((current) => !current)}
                  aria-label={isRegisterPasswordVisible ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={isRegisterPasswordVisible}
                >
                  {isRegisterPasswordVisible ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
                </button>
              </div>
              <p style={{ margin: "-8px 0 0", color: passwordValidationMessage ? "#b91c1c" : "#475569", fontSize: 13 }}>
                {passwordValidationMessage || PASSWORD_HINT}
              </p>
              <div className="auth-main-actions" style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="submit" className="auth-submit auth-main-button" disabled={isSubmitting} style={{ flex: 1 }}>
                  {isSubmitting ? "Criando..." : "Criar conta"}
                </button>
                <button type="button" className="auth-outline-button auth-main-button" onClick={() => setMode("login")}> 
                  Voltar
                </button>
              </div>
            </form>
          ) : (
            <div className="auth-closed-card">
              <strong className="auth-form-title">Cadastro indisponível</strong>
              <p>No momento, o cadastro público está desativado.</p>
              <button type="button" className="auth-outline-button auth-main-button" onClick={() => setMode("login")}>
                Voltar para entrar
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

