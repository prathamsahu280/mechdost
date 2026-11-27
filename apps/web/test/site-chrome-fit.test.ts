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

describe('header at 1024-1439 px (v4, 2026-11-23; labels moved to 1440 px: they wrapped at 1280 with a scrollbar)', () => {
  it('shows the nav and the search pill as icons only until 1440 px (labels stay the accessible names)', () => {
    expect(src('components/site/nav-links.tsx')).toContain('sr-only min-[1440px]:not-sr-only');
    expect(src('components/site/search-trigger.tsx')).toContain('sr-only min-[1440px]:not-sr-only');
  });

  it('gives the icon-only controls a hover title (sighted users still get the word)', () => {
    expect(src('components/site/nav-links.tsx')).toMatch(/title=\{item\.label\}/);
    expect(src('components/commerce/cart-pill.tsx')).toMatch(/title=\{label\}/);
    expect(src('components/auth/account-menu.tsx')).toMatch(/title=\{copy\.signIn\}/);
  });

  it('has no tagline under the logo any more (the v4 logo stands alone)', () => {
    expect(src('components/site/header.tsx')).not.toMatch(/tagline/);
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

  it('on phones also hides while a field in main is focused, and on the roadside request form', () => {
    // Every phone block (the partner kit added its own phone block earlier in the file, 2026-11-28).
    const phone = [...css.matchAll(/@media \(max-width: 1023\.98px\)\s*\{([^@]*?)\n\}/g)]
      .map((m) => m[1] ?? '')
      .join('\n');
    expect(phone).toMatch(
      /html:has\(main :is\(input, select, textarea\):focus-visible\) \.assistant-launcher/,
    );
    expect(phone).toMatch(/html:has\(\[data-launcher-avoid-phone\]\) \.assistant-launcher/);
    expect(phone).toMatch(/visibility:\s*hidden/);
    expect(src('components/roadside/roadside-request.tsx')).toMatch(/<form\s+data-launcher-avoid-phone/);
  });

  it('adds nothing to the launcher (it is in the first load of every page)', () => {
    expect(src('components/assistant/assistant-launcher.tsx')).not.toMatch(
      /data-launcher-avoid|IntersectionObserver/,
    );
  });
});
