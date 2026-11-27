/**
 * Founder, 2026-11-27 night ("all ranked improvements approved", replaces "light by default" of 2026-11-23): when the
 * visitor never chose a theme the site follows the device (`prefers-color-scheme`) and live-updates when the device
 * switches; an explicit choice saved under `mechdost-theme` still wins. The inline script applies it before paint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '../src/lib/theme';

type Listener = () => void;

/** Runs the pre-paint script against fakes; returns the root and hooks to fire the observer and the media change. */
function run(opts: { saved: () => string | null; systemDark: () => boolean }) {
  const root = { dataset: {} as Record<string, string | undefined> };
  let fireObserver: Listener = () => undefined;
  const mediaListeners: Listener[] = [];
  const noop = (): undefined => undefined;
  runInNewContext(THEME_INIT_SCRIPT, {
    document: { documentElement: root },
    localStorage: { getItem: opts.saved },
    matchMedia: () => ({
      get matches() {
        return opts.systemDark();
      },
      addEventListener: (_: string, cb: Listener) => mediaListeners.push(cb),
    }),
    MutationObserver: class {
      constructor(cb: Listener) {
        fireObserver = cb;
      }
      observe = noop;
    },
    addEventListener: noop,
  });
  return {
    root,
    fireObserver: () => {
      fireObserver();
    },
    fireMedia: () => {
      for (const cb of mediaListeners) cb();
    },
  };
}

describe('no saved choice follows the device', () => {
  it('a dark device opens dark', () => {
    expect(run({ saved: () => null, systemDark: () => true }).root.dataset.theme).toBe('dark');
  });
  it('a light device opens light', () => {
    expect(run({ saved: () => null, systemDark: () => false }).root.dataset.theme).toBe('light');
  });
  it('a junk saved value follows the device', () => {
    expect(run({ saved: () => 'purple', systemDark: () => true }).root.dataset.theme).toBe('dark');
  });
  it('the page live-updates when the device switches', () => {
    let dark = false;
    const page = run({ saved: () => null, systemDark: () => dark });
    expect(page.root.dataset.theme).toBe('light');
    dark = true;
    page.fireMedia();
    expect(page.root.dataset.theme).toBe('dark');
  });
  it('without matchMedia (old browsers) the page opens light', () => {
    const root = { dataset: {} as Record<string, string> };
    runInNewContext(THEME_INIT_SCRIPT, {
      document: { documentElement: root },
      localStorage: { getItem: () => null },
      MutationObserver: class {
        observe = (): undefined => undefined;
      },
      addEventListener: (): undefined => undefined,
    });
    expect(root.dataset.theme).toBe('light');
  });
});

describe('an explicit choice wins', () => {
  it('a saved light choice stays light on a dark device', () => {
    expect(run({ saved: () => 'light', systemDark: () => true }).root.dataset.theme).toBe('light');
  });
  it('a saved dark choice stays dark on a light device', () => {
    expect(run({ saved: () => 'dark', systemDark: () => false }).root.dataset.theme).toBe('dark');
  });
  it('a device switch does not override a saved choice', () => {
    let dark = false;
    const page = run({ saved: () => 'light', systemDark: () => dark });
    dark = true;
    page.fireMedia();
    expect(page.root.dataset.theme).toBe('light');
  });
});

describe('the pre-paint guard keeps the choice made on this page', () => {
  // qa-regressions "theme toggle still works when the browser storage is full" (2026-11-23): the toggle sets dark but
  // cannot save it; the observer must not revert it.
  it('a dark choice that could not be saved is not reverted by the observer', () => {
    const { root, fireObserver } = run({ saved: () => null, systemDark: () => false });
    expect(root.dataset.theme).toBe('light');
    root.dataset.theme = 'dark'; // the toggle, storage full
    fireObserver();
    expect(root.dataset.theme).toBe('dark');
  });
  it('a cleared attribute (React resetting <html>) is put back from the saved choice', () => {
    const { root, fireObserver } = run({ saved: () => 'dark', systemDark: () => false });
    delete root.dataset.theme;
    fireObserver();
    expect(root.dataset.theme).toBe('dark');
  });
  it('a cleared attribute with nothing saved is put back from the device', () => {
    const { root, fireObserver } = run({ saved: () => null, systemDark: () => true });
    delete root.dataset.theme;
    fireObserver();
    expect(root.dataset.theme).toBe('dark');
  });
});

describe('client fallbacks follow the device too', () => {
  it('theme-client resolves the fallback from prefers-color-scheme', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'theme-client.ts'), 'utf8');
    expect(src).toMatch(/prefers-color-scheme: dark/);
    expect(src).not.toMatch(/return 'light'; \/\/ light by default/);
  });
});
