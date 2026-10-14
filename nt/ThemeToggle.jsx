import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

const OPTIONS = [
  { value: "light", label: "Tema claro", Icon: Sun },
  { value: "dark", label: "Tema escuro", Icon: Moon },
  { value: "system", label: "Tema do sistema", Icon: Monitor },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Antes de montar o tema salvo ainda não é conhecido; reserva o espaço para não mexer o layout.
  if (!mounted) return <div className="theme-toggle-placeholder" aria-hidden="true" />;

  return (
    <div className="theme-toggle" role="group" aria-label="Tema">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="theme-toggle-btn"
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          onClick={() => setTheme(value)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
