import { useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme';

export type Theme = 'light' | 'dark';

/** The theme the page shows now: the explicit choice on `<html data-theme>`, else the system preference. */
export function currentTheme(): Theme {
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

/** The current theme as React state; `null` while server-rendering and hydrating (so markup always matches). */
export function useTheme(): Theme | null {
  return useSyncExternalStore<Theme | null>(subscribe, currentTheme, () => null);
}

/** Flips light/dark and saves the choice on this device (decision 2026-11-01). */
export function toggleTheme(): void {
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

/**
 * Pages Next renders on the client (the 404 error shell) never run the inline theme script: apply the saved choice
 * (QA 2026-11-14). Called from an effect of the footer's toggle, which is on every page.
 */
export function applySavedTheme(): void {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if ((saved === 'dark' || saved === 'light') && !document.documentElement.dataset.theme)
      document.documentElement.dataset.theme = saved;
  } catch {
    // Storage blocked: the system theme applies.
  }
}
