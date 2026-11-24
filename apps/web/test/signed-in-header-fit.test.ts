/**
 * Signed-in header fit (audit 2026-11-16, coordinator ruling; rebuilt for the v4 header 2026-11-23): with the bell
 * present the page scrolled sideways by 19 px (390 hi), 15/31 px (480 en/hi) and 23 px (1024 en). The header is built so
 * it fits by construction: the account entry is an avatar (name in the title), the cart label shows from 640 px, nav
 * and search labels from xl, the logo shrinks first, and the phone bar is a compact row.
 * Real geometry: `e2e/chrome-fit.spec.ts` (signed-in cases at 320/390/480/768/1024/1280 px).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('signed-in header fits at every width', () => {
  const header = src('components/site/header.tsx');
  const account = src('components/auth/account-menu.tsx');
  const bell = src('components/notices/bell-controller.tsx');
  const bellSlot = src('components/notices/bell.tsx');
  const pill = src('components/commerce/cart-pill.tsx');
  const nav = src('components/site/nav-links.tsx');
  const search = src('components/site/search-trigger.tsx');

  it('the bar is a flex row that can shrink: the logo gives way before anything sticks out', () => {
    expect(header).toContain('inline-flex min-h-11 min-w-0 shrink items-center');
    expect(header).toContain('w-auto max-w-full');
    expect(header).toMatch(/header-bar relative mx-auto flex h-14 max-w-\[1320px\] items-center gap-2/);
  });

  it('the logo is 26 px tall on phones and 30 px from 640 px', () => {
    expect(header).toContain('h-[26px] sm:h-[30px]');
  });

  it('the signed-in entry is an avatar button (name in the title and the accessible name), never a wide link', () => {
    expect(account).toMatch(/data-user-content\s+title=\{first \|\| copy\.account\}/);
    expect(account).toContain("aria-label={`${copy.account}${first ? `, ${first}` : ''}`}");
    expect(account).toContain('size-10');
  });

  it('phone tap targets are 40 px (above the 24 px minimum); the bell is hidden under 380 px', () => {
    expect(bell).toContain('size-10');
    expect(bellSlot).toContain('size-10');
    expect(bellSlot).toContain('hidden min-[380px]:contents');
    expect(pill).toContain('size-10');
  });

  it('the cart is an icon button under 640 px and the navy button from there', () => {
    expect(pill).toMatch(/sm:size-auto sm:h-10/);
    expect(pill).toContain('sm:bg-cart');
  });

  it('the desktop nav and search shrink to icons between 1024 and 1279 px', () => {
    expect(nav).toContain('sr-only min-[1440px]:not-sr-only');
    expect(nav).toContain('min-[1440px]:whitespace-nowrap'); // labels never wrap (spec 22, six items)
    expect(search).toContain('sr-only min-[1440px]:not-sr-only');
    expect(search).toContain('min-[1440px]:min-w-[190px]');
  });

  it('the phone order is bell, cart, avatar; the desktop order is bell, avatar, cart', () => {
    expect(header).toMatch(/order-2 empty:hidden nav:order-none[\s\S]*?<AccountMenu/);
    expect(header).toMatch(/order-1 empty:hidden nav:order-none[\s\S]*?<CartPill/);
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
