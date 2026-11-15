/**
 * Signed-in header fit (audit 2026-11-16, coordinator ruling): with the bell present the page scrolled sideways by
 * 19 px (390 hi), 15/31 px (480 en/hi) and 23 px (1024 en). The header is built so it fits by construction: the
 * account name and cart label are text only where there is room (icons with names and titles before that), the
 * brand and the tap targets are a little smaller on phones, and the 1024-1279 px row uses the page gutter sparingly.
 * Real geometry: `e2e/chrome-fit.spec.ts` (signed-in cases at 320/390/480/768/1024/1280 px).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('signed-in header fits at every width', () => {
  const header = src('components/site/header.tsx');
  const account = src('components/auth/account-link.tsx');
  const bell = src('components/notices/bell-controller.tsx');
  const bellSlot = src('components/notices/bell.tsx');
  const pill = src('components/commerce/cart-pill.tsx');
  const lang = src('components/site/language-switcher.tsx');
  const nav = src('components/site/nav-links.tsx');

  it('the row uses a narrower gutter between 1024 and 1279 px', () => {
    expect(header).toMatch(/px-\[5%\] py-3 nav:px-6 xl:px-\[5%\]/);
  });

  it('the logo is narrower until 460 px and the tagline waits for the tablet width', () => {
    expect(header).toContain('w-[132px] max-w-full min-[460px]:w-[152px] tab:w-[176px]');
    expect(header).toMatch(/tab:block nav:hidden xl:block/);
  });

  it('the signed-in name shows as text only from xl and keeps a title and an accessible name', () => {
    expect(account).toMatch(/className="sr-only max-w-\[9ch\] truncate xl:not-sr-only"/);
    expect(account).toMatch(/data-track="header_account"\s+title=\{first\}/);
    expect(account).toContain('<span className="sr-only">, {account}</span>');
  });

  it('phone tap targets shrink to 40 px below 440 px (still above the 24 px minimum)', () => {
    expect(account).toContain('min-w-10');
    expect(account).toContain('min-[440px]:min-w-11');
    expect(bell).toContain('size-10 min-[440px]:size-11');
    expect(bellSlot).toContain('size-10 min-[440px]:size-11');
    expect(pill).toMatch(/px-2\.5 [^"]*min-\[440px\]:px-4/);
    expect(lang).toMatch(/px-1\.5 [^"]*min-\[440px\]:px-3/);
  });

  it('the primary nav is tighter between 1024 and 1279 px', () => {
    expect(nav).toMatch(/px-2 text-\[13px\] xl:px-3\.5/);
  });
});

describe('account section menu scrolls itself, never the page (API-NAV-ACCOUNT)', () => {
  const area = src('components/account/account-area.tsx');
  const bar = /<nav\s+ref=\{bar\}[\s\S]*?>/.exec(area)?.[0] ?? '';
  it('the strip is its own scroll box and may shrink inside the page grid', () => {
    expect(bar).toContain('overflow-x-auto');
    expect(bar).toContain('min-w-0');
  });
  it('its items never wrap, so the strip scrolls instead of breaking the row', () => {
    expect(area).toMatch(/rounded-pill px-4 text-sm font-bold whitespace-nowrap/);
  });
});
