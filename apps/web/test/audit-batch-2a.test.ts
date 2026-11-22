/**
 * UI state audit batch 2a (2026-11-16): refund lines are a valid list (axe "list"), horizontally scrolling tables
 * are keyboard reachable (axe "scrollable-region-focusable"), analytics tiles never push a rupee amount out of
 * their box, and no UI copy leaks English words onto /hi. Source guards; the geometry itself is measured by the audit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const src = (p: string) => read('src', p);

describe('refund lines are a valid list (API-ORD-REFUNDLINE)', () => {
  const view = src('components/commerce/order-view-api.tsx');
  it('no list item carries a role that replaces the listitem role', () => {
    const block = /function RefundLines[\s\S]*?\n}\n/.exec(view)?.[0] ?? '';
    expect(block).toContain('<li');
    expect(block).not.toMatch(/<li[^>]*role=/);
    expect(block).toMatch(/<span role="status">/);
  });
});

describe('scrolling tables are keyboard reachable (API-ADM-ANALYTICS / COMPANY / DEMAND)', () => {
  const region = src('components/ui/scroll-region.tsx');
  it('the shared region is focusable, named, and shows the shared focus ring', () => {
    expect(region).toContain('tabIndex={0}');
    expect(region).toContain('role="region"');
    expect(region).toMatch(/aria-label|aria-labelledby/);
    expect(region).toContain('overflow-x-auto');
  });
  for (const file of [
    'components/portal/analytics-charts.tsx',
    'components/portal/admin-demand-api.tsx',
    'components/portal/admin-workshop-analytics-api.tsx',
  ]) {
    it(`${file} has no bare overflow-x-auto wrapper`, () => {
      const s = src(file);
      expect(s).not.toMatch(/className="[^"]*overflow-x-auto/);
      expect(s).toContain('<ScrollRegion');
    });
  }
});

describe('analytics tiles keep amounts inside their box (API-ADM-ANALYTICS 320 px)', () => {
  const s = src('components/portal/admin-analytics-api.tsx');
  it('values may wrap and the tile can shrink', () => {
    expect(s).toMatch(/<dd[^>]*break-words|<dd[^>]*\[overflow-wrap:anywhere\]/);
  });
});

describe('copy has no English words on /hi (API-ACC-SUPPORT, API-WS-HOMEJOB)', () => {
  const hi = JSON.parse(read('..', '..', 'packages', 'shared', 'src', 'i18n', 'hi.json')) as Record<
    string,
    Record<string, unknown>
  >;
  const flat = (o: unknown, out: string[] = []): string[] => {
    if (typeof o === 'string') out.push(o);
    else if (o && typeof o === 'object') for (const v of Object.values(o)) flat(v, out);
    return out;
  };
  it('the support thread UPI example uses no English words ("name@bank")', () => {
    const strings = flat(hi.supportThread);
    for (const s of strings) expect(s).not.toMatch(/name@bank/);
    expect(JSON.stringify(hi.supportThread)).toContain('@upi');
  });
});

describe('signed-in header at 480-559 px (audit: page scrolled sideways by 15 px en, 31 px hi)', () => {
  it('the cart label waits for 640 px (v4: an icon button until then); the signed-in bell takes the room', () => {
    const pill = src('components/commerce/cart-pill.tsx');
    expect(pill).toContain('sr-only sm:not-sr-only');
    expect(pill).not.toContain('min-[480px]:not-sr-only');
    expect(pill).not.toContain('min-[560px]:not-sr-only');
  });
});
