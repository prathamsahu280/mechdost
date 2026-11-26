/**
 * User 2026-11-23: "make the website open on light mode by default". Without a saved choice the site is light,
 * whatever the device's system theme; a saved dark choice still wins.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '../src/lib/theme';

function runInit(saved: string | null): string | undefined {
  const root = { dataset: {} as Record<string, string> };
  const noop = (): undefined => undefined;
  runInNewContext(THEME_INIT_SCRIPT, {
    document: { documentElement: root },
    localStorage: { getItem: () => saved },
    MutationObserver: class {
      observe = noop;
    },
    addEventListener: noop,
  });
  return root.dataset.theme;
}

/** Runs the script with a working observer; returns the root and a function that fires the observer callback. */
function withObserver(saved: () => string | null) {
  const root = { dataset: {} as Record<string, string | undefined> };
  let fire = (): void => undefined;
  const noop = (): undefined => undefined;
  runInNewContext(THEME_INIT_SCRIPT, {
    document: { documentElement: root },
    localStorage: { getItem: saved },
    MutationObserver: class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe = noop;
    },
    addEventListener: noop,
  });
  return {
    root,
    fire: () => {
      fire();
    },
  };
}

describe('the pre-paint guard keeps the choice made on this page', () => {
  // qa-regressions "theme toggle still works when the browser storage is full" (failing since 3b54a77c, 2026-11-23):
  // the toggle sets dark but cannot save it, the observer saw "nothing saved" and forced light back.
  it('a dark choice that could not be saved is not reverted by the observer', () => {
    const { root, fire } = withObserver(() => null);
    expect(root.dataset.theme).toBe('light');
    root.dataset.theme = 'dark'; // the toggle, storage full
    fire();
    expect(root.dataset.theme).toBe('dark');
  });
  it('a cleared attribute (React resetting <html>) is put back from the saved choice', () => {
    const { root, fire } = withObserver(() => 'dark');
    delete root.dataset.theme;
    fire();
    expect(root.dataset.theme).toBe('dark');
  });
  it('a cleared attribute with nothing saved is put back as light', () => {
    const { root, fire } = withObserver(() => null);
    delete root.dataset.theme;
    fire();
    expect(root.dataset.theme).toBe('light');
  });
});

describe('light mode by default', () => {
  it('no saved choice opens light', () => {
    expect(runInit(null)).toBe('light');
  });
  it('a saved dark choice still applies', () => {
    expect(runInit('dark')).toBe('dark');
  });
  it('a junk saved value falls back to light', () => {
    expect(runInit('purple')).toBe('light');
  });
  it('client and map fallbacks no longer follow the system theme', () => {
    for (const f of [
      'lib/theme-client.ts',
      'components/account/address-pin-map.tsx',
      'components/partners/location-map.tsx',
      'components/workshops/workshop-map.tsx',
    ]) {
      expect(readFileSync(join(__dirname, '..', 'src', f), 'utf8')).not.toMatch(
        /prefers-color-scheme: dark\)'\)\.matches \? 'dark'/,
      );
    }
  });
});
