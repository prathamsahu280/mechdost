'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { UI_EMOJI } from '@/lib/emoji';
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
  // Pages Next renders on the client (the 404 error shell) never run the inline theme script: apply the saved
  // choice here, since this toggle is on every page (QA 2026-11-14).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if ((saved === 'dark' || saved === 'light') && !document.documentElement.dataset.theme)
        document.documentElement.dataset.theme = saved;
    } catch {
      // Storage blocked: the system theme applies.
    }
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage full: the theme still applies for this page view. Drop the old saved value, or the
      // inline guard (`THEME_INIT_SCRIPT`) would put it straight back (review 2026-11-14).
      try {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } catch {
        // Storage blocked entirely: nothing saved, nothing to restore.
      }
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
      <span aria-hidden="true" className="theme-icon-moon text-[18px] leading-none">
        {UI_EMOJI.dark}
      </span>
      <span aria-hidden="true" className="theme-icon-sun text-[18px] leading-none">
        {UI_EMOJI.light}
      </span>
    </button>
  );
}
