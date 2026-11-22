/**
 * Site chrome fit (audit 2026-11-15 bugs 2 and 8). Real geometry is checked in e2e/shell.spec.ts; these guards keep the
 * CSS-only fixes from being undone: the 1024 px header drops its labels until `xl`, and the open privacy banner
 * reserves its own height at the end of the page and lifts the assistant launcher above it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const css = src('app/[locale]/globals.css');

describe('header at 1024-1279 px', () => {
  it('shows the cart and account as icons only until xl', () => {
    expect(src('components/commerce/cart-pill.tsx')).toMatch(/nav:sr-only xl:not-sr-only/);
    const account = src('components/auth/account-link.tsx');
    expect(account.match(/nav:sr-only xl:not-sr-only/g)?.length).toBe(1);
    expect(account).toContain('truncate xl:not-sr-only');
  });

  it('gives the icon-only cart and sign-in a hover title (sighted users still get the word)', () => {
    expect(src('components/commerce/cart-pill.tsx')).toMatch(/title=\{label\}/);
    expect(src('components/auth/account-link.tsx')).toMatch(/title=\{signIn\}/);
  });

  it('shows the brand tagline from the tablet width, not at 1024-1279 px', () => {
    expect(src('components/site/header.tsx')).toMatch(/tab:block nav:hidden min-\[1440px\]:block/);
  });
});

describe('privacy banner never covers controls', () => {
  it('reserves the banner height (plus tab bar and compare tray) as bottom space on the page', () => {
    expect(css).toMatch(/html\[data-consent-open\] body\s*\{[^}]*padding-bottom:[^;]*var\(--consent-h/);
    expect(css).toMatch(/html\[data-consent-open\]:has\(\[data-compare-tray\]\[data-prompt\]\) body/);
  });

  it('lifts the assistant launcher above the banner instead of hiding it under', () => {
    expect(css).toMatch(
      /html\[data-consent-open\] \.assistant-launcher\s*\{[^}]*bottom:[^;]*var\(--consent-h/,
    );
    expect(css).not.toMatch(/html\[data-consent-open\] \.assistant-launcher,/);
  });
});

describe('assistant launcher never covers a booking form', () => {
  it('hides while a page carries a form marked data-launcher-avoid', () => {
    expect(css).toMatch(
      /html:has\(\[data-launcher-avoid\]\) \.assistant-launcher\s*\{[^}]*visibility:\s*hidden/,
    );
  });

  it('marks both booking forms (demo and API)', () => {
    for (const f of ['booking-form.tsx', 'booking-form-api.tsx'])
      expect(src(`components/workshops/${f}`)).toMatch(/<form\s+data-launcher-avoid/);
  });

  it('adds nothing to the launcher (it is in the first load of every page)', () => {
    expect(src('components/assistant/assistant-launcher.tsx')).not.toMatch(
      /data-launcher-avoid|IntersectionObserver/,
    );
  });
});
