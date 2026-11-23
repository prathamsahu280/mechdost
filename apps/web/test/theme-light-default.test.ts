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
