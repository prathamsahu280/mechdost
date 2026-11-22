'use client';

import { useEffect, type ReactNode } from 'react';
import { applySavedTheme, toggleTheme, useTheme } from '@/lib/theme-client';

/**
 * Footer dark-mode button (v4 footer, decision 2026-11-23): icon + the words "Dark mode", `aria-pressed` = on. The
 * moon/sun pair is server-rendered and swapped by CSS only (`.theme-icon-*`), so markup and hydration always match.
 * The header's own switch lives in the account menu (`account-menu-panel.tsx`).
 */
export function ThemeToggle({
  label,
  icon,
  className = '',
}: {
  label: string;
  /** The moon and sun icons (classes `theme-icon-moon` / `theme-icon-sun`), rendered by the server. */
  icon: ReactNode;
  className?: string;
}) {
  const theme = useTheme();
  useEffect(() => {
    applySavedTheme();
  }, []);
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={theme === null ? undefined : theme === 'dark'}
      data-track="theme_toggle"
      className={`press inline-flex min-h-11 items-center gap-2 rounded-xl bg-pill px-3.5 text-[13.5px] font-bold text-ink hover:bg-line ${className}`}
    >
      <span aria-hidden="true" className="inline-grid size-[18px] place-items-center">
        {icon}
      </span>
      {label}
    </button>
  );
}
