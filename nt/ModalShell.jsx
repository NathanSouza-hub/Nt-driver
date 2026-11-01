import React, { useEffect } from "react";

// Modal no padrão visual já usado no Nt Driver (password-modal / password-card).
export default function ModalShell({ title, children, footer, onClose, busy = false, wide = false, labelId = "modal-shell-title" }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="password-modal expense-dialog goal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className={`password-card${wide ? " goal-dialog-wide" : ""}`}>
        <div className="password-card-header">
          <h2 id={labelId}>{title}</h2>
          <button type="button" className="password-close-btn" aria-label="Fechar" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="goal-dialog-body">{children}</div>
        {footer ? <div className="goal-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
