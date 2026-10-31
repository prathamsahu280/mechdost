'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

/**
 * Light/dark switch (decision 2026-11-01). A toggle button (`aria-pressed` = dark mode on); the icon swap is pure
 * CSS so server HTML and hydration always match. The choice is saved per device.
 */
export function ThemeToggle({ label, className = '' }: { label: string; className?: string }) {
  const theme = useSyncExternalStore<Theme | null>(subscribe, currentTheme, () => null);

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage blocked: the theme still applies for this page view.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === null ? undefined : theme === 'dark'}
      data-track="theme_toggle"
      className={`press inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-pill ${className}`}
    >
      <Moon aria-hidden="true" className="theme-icon-moon size-5" />
      <Sun aria-hidden="true" className="theme-icon-sun size-5" />
    </button>
  );
}
