/**
 * Audit 2026-11-16, batch 3c-1 (chrome, navigation, Hindi): each real finding class of the GitHub re-run has a test
 * here. Geometry itself is measured by `e2e/state-audit` and `e2e/chrome-fit.spec.ts`; these tests pin the rules
 * that make the geometry hold (and the pure logic) so a regression fails in seconds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { centerCurrentIn, type CenterBar } from '../src/lib/use-center-current';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const shared = (p: string) => readFileSync(join(__dirname, '..', '..', '..', 'packages', p), 'utf8');

/** A bar of `n` items, each `w` px wide, `view` px visible, scrolled to `scroll`; item `current` is current. */
function bar(n: number, w: number, view: number, scroll: number, current: number): CenterBar {
  const state = { scrollLeft: scroll };
  const left = (i: number) => i * w - state.scrollLeft;
  return {
    scrollWidth: n * w,
    clientWidth: view,
    get scrollLeft() {
      return state.scrollLeft;
    },
    set scrollLeft(v: number) {
      state.scrollLeft = Math.max(0, Math.min(n * w - view, v));
    },
    getBoundingClientRect: () => ({ left: 0 }),
    querySelector: () => ({ offsetWidth: w, getBoundingClientRect: () => ({ left: left(current) }) }),
  };
}

describe('NAV-ADMIN / NAV-ACCOUNT: the current item is brought into view', () => {
  it('centres an item that is scrolled out of sight', () => {
    const b = bar(15, 120, 320, 900, 2); // item 2 is at 240..360, the bar shows 900..1220
    centerCurrentIn(b);
    expect(b.scrollLeft).toBe(240 + 60 - 160); // the item's middle is the bar's middle
  });

  it('brings an item on the far right back after keyboard focus scrolled to the end', () => {
    const b = bar(15, 120, 320, 1480, 11);
    centerCurrentIn(b);
    expect(b.scrollLeft).toBe(11 * 120 + 60 - 160);
  });

  it('leaves a bar whose items all fit alone', () => {
    const b = bar(3, 100, 320, 0, 2);
    centerCurrentIn(b);
    expect(b.scrollLeft).toBe(0);
  });

  it('does nothing without a current item', () => {
    const b = { ...bar(15, 120, 320, 500, 2), querySelector: () => null };
    centerCurrentIn(b);
    expect(b.scrollLeft).toBe(500);
  });

  it('re-centres on load, section change, font arrival and when focus leaves the bar; never animates', () => {
    const hook = src('lib/use-center-current.ts');
    expect(hook).toContain('[key]');
    expect(hook).toContain('document.fonts.ready');
    expect(hook).toContain("addEventListener('focusout'");
    expect(hook).not.toMatch(/scrollTo\(|behavior:\s*'smooth'/);
  });
});

describe('CHR-ASSIST: the assistant button never lies invisible over the page', () => {
  const launcher = src('components/assistant/assistant-launcher.tsx');
  it('is hidden (not only transparent) while the panel is open, so it cannot be "under" content', () => {
    expect(launcher).toMatch(/open\s*\?\s*'invisible pointer-events-none/);
    // 3c-2: no transition on the way out (a fading, pointer-less ghost was "painted over"); see audit-batch-3c2.
  });
  it('gives focus back after it is visible again, not while still hidden', () => {
    expect(launcher).toMatch(/useEffect\(\(\) => \{[\s\S]*buttonRef\.current\?\.focus\(\)/);
    expect(launcher).not.toMatch(/onClose=\{\(\) => \{[^}]*focus\(\)/);
  });
  it('names the panel in aria-controls only once the panel exists (axe aria-valid-attr-value)', () => {
    expect(launcher).toContain("aria-controls={loaded ? 'assistant-panel' : undefined}");
  });
  it('stays above page content (z-40) and below the consent banner and the panel (z-50)', () => {
    expect(launcher).toContain('fixed right-4 z-40');
    expect(src('components/site/consent-banner.tsx')).toContain('z-50');
    expect(src('components/assistant/assistant-panel.tsx')).toContain('z-50');
  });
});

describe('WS-PROFILE: a sticky side card ends above the assistant button', () => {
  const css = src('app/[locale]/globals.css');
  it('the shared class caps the card above the button and lets it scroll inside', () => {
    const rule = /\.sticky-aside\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('position: sticky');
    expect(rule).toMatch(/max-height:\s*calc\(100dvh - 7rem - 6rem\)/);
    expect(rule).toContain('overflow-y: auto');
  });
  it.each([
    'app/[locale]/workshops/[slug]/page.tsx',
    'components/workshops/workshop-profile-api.tsx',
    'components/commerce/cart-view.tsx',
  ])('%s uses it for the booking / summary card', (file) => {
    const text = src(file);
    expect(text).toContain('sticky-aside');
    expect(text).not.toMatch(/shadow-card nav:sticky nav:top-28/);
  });
});

describe('CMP-TABLE: the sticky "Detail" column does not cover focused product links', () => {
  it('the head strip stops 11rem short of the left edge when focus scrolls it', () => {
    const table = src('components/catalogue/compare-table.tsx');
    expect(table).toMatch(/data-compare-scroll="head"[\s\S]*?tab:scroll-pl-44/);
    expect(src('app/[locale]/globals.css')).toMatch(/grid-template-columns:\s*11rem repeat/);
  });
});

describe('ORD-VIEW / SR-VIEW: text links use the AA accent text token', () => {
  it('the support links are accent-soft-text (#bf3c12 light / #ffb38f dark), not the brand accent', () => {
    const order = src('components/commerce/order-view.tsx');
    expect(order).not.toMatch(/font-bold text-accent underline-offset-4/);
    expect(order).toMatch(
      /data-track="order_cancel_via_support"\s+className="font-bold text-accent-soft-text/,
    );
  });
});

describe('4-31 px sideways scroll on signed-in pages: the header yields instead of overflowing', () => {
  const header = src('components/site/header.tsx');
  it('the logo link can shrink and the logo is capped to it', () => {
    expect(header).toContain('inline-flex min-h-11 min-w-0 shrink items-center');
    expect(header).toContain('w-auto max-w-full');
  });
});

describe('Hindi gate (hard rule 10) for the signed-in name, admin names, shop names, company, CSV help', () => {
  it('the header account link (title = the name) is user content', () => {
    expect(src('components/auth/account-menu.tsx')).toMatch(
      /data-user-content\s+title=\{first \|\| copy\.account\}/,
    );
  });
  it('person names in admin are marked user content', () => {
    expect(src('components/portal/admin-policies-api.tsx')).toContain(
      '<span data-user-content>{v.by}</span>',
    );
    expect(src('components/portal/admin-customer-view-api.tsx')).toMatch(
      /className="sr-only" data-user-content/,
    );
  });
  it('the admin coupon list names the funding shop in Hindi: DTO carries nameHi, repository selects it, UI uses it', () => {
    expect(shared('shared/src/coupon-api.ts')).toMatch(
      /shop: z\.object\(\{ id: z\.string\(\), name: z\.string\(\), nameHi: z\.string\(\)\.nullable\(\) \}\)/,
    );
    expect(shared('db/src/repo/coupons-admin.ts')).toContain('shopNameHi: shops.nameHi');
    const ui = src('components/portal/admin-coupons-api.tsx');
    expect(ui).toContain('localName(c.shop, locale)');
    expect(ui).toContain('localName(s, locale)');
  });
  it('the legal name and address (statutory, English on purpose) are declared lang="en" in the company editor', () => {
    const company = src('components/portal/admin-company-api.tsx');
    expect(company).toContain("lang: HI_FIELDS.includes(f) ? 'hi' : 'en'");
  });
  it.each([
    ['en', en],
    ['hi', hi],
  ] as const)(
    '%s: the stock-file header message marks column names as code and is rendered rich',
    (_n, locale) => {
      const text = locale.shopTier2.csvFile_HEADER;
      for (const name of ['sku', 'stock', 'active', 'requested_price'])
        expect(text).toContain(`<code>${name}</code>`);
      expect(src('components/portal/shop-csv-api.tsx')).toContain('t.rich(csvFileKey(error)');
    },
  );
  it('Hindi sentence around the column names holds no Latin letters', () => {
    expect(hi.shopTier2.csvFile_HEADER.replace(/<code>[^<]*<\/code>/g, '')).not.toMatch(/[A-Za-z]/);
  });
});

describe('admin catalogue editor shows the Hindi product name on /hi', () => {
  it('list rows, edit label and detail header use localName (nameHi, else name)', () => {
    const ui = src('components/portal/admin-catalogue-editor.tsx');
    expect(ui).toContain('{p.brand} {localName(p, locale)}');
    expect(ui).toContain('localName(p, locale) })');
    expect(ui).toContain('{detail.brand} {localName(detail, locale)}');
  });
});
