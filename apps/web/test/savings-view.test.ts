/**
 * "Your savings" on the website (decision 2026-11-26): the breakdown rows (non-zero components in a fixed order), the
 * demo-store figures (same maths as the API: delivered orders only, by IST month/year, lines without an MRP excluded),
 * every text key in English and Hindi, and the import graph that keeps the savings code out of first-load chunks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { demoOrderSavings, demoPeriodSavings, savingsRows } from '../src/lib/savings-view';

const line = (qty: number, unitPaise: number, mrpPaise: number | null) => ({ qty, unitPaise, mrpPaise });

describe('savingsRows', () => {
  it('lists only the components that saved something, in a fixed order', () => {
    expect(savingsRows({ mrpPaise: 500, couponPaise: 0, coinsPaise: 100, deliveryPaise: 4000 })).toEqual([
      { key: 'comp_mrp', paise: 500 },
      { key: 'comp_coins', paise: 100 },
      { key: 'comp_delivery', paise: 4000 },
    ]);
    expect(savingsRows({ mrpPaise: 0, couponPaise: 0, coinsPaise: 0, deliveryPaise: 0 })).toEqual([]);
  });
});

describe('demo store figures', () => {
  const now = new Date('2026-11-26T06:00:00Z');
  it('an undelivered order is an estimate; a cancelled one is none', () => {
    expect(
      demoOrderSavings({ at: now, delivered: false, live: true, lines: [line(2, 900, 1000)], coinsPaise: 0 }),
    ).toMatchObject({ status: 'estimate', mrpPaise: 200, totalPaise: 200 });
    expect(
      demoOrderSavings({
        at: now,
        delivered: false,
        live: false,
        lines: [line(1, 900, 1000)],
        coinsPaise: 0,
      }),
    ).toMatchObject({ status: 'none', totalPaise: 0 });
  });

  it('this month counts delivered orders of the IST month only, with Coins and excluded lines', () => {
    const orders = [
      {
        at: now,
        delivered: true,
        live: true,
        lines: [line(1, 900, 1000), line(1, 50, null)],
        coinsPaise: 30,
      },
      { at: now, delivered: false, live: true, lines: [line(1, 100, 9000)], coinsPaise: 0 },
      {
        at: new Date('2026-10-10T06:00:00Z'),
        delivered: true,
        live: true,
        lines: [line(1, 1, 101)],
        coinsPaise: 0,
      },
    ];
    expect(demoPeriodSavings(orders, 'month', now)).toMatchObject({
      mrpPaise: 100,
      coinsPaise: 30,
      totalPaise: 130,
      orders: 1,
      excludedLines: 1,
    });
    expect(demoPeriodSavings(orders, 'year', now)).toMatchObject({ totalPaise: 230, orders: 2 });
  });
});

describe('copy', () => {
  it('every savings key exists in English and Hindi, and Hindi keeps MRP in Latin script', () => {
    const e = (en as unknown as Record<string, Record<string, string>>).savings!;
    const h = (hi as unknown as Record<string, Record<string, string>>).savings!;
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) expect(h[k]?.trim()).toBeTruthy();
    expect(h.order).toContain('MRP');
    expect(h.order).toContain('{amount}');
    // Honest wording: never "sale price" or a percentage claim.
    for (const v of Object.values(e)) expect(v).not.toMatch(/sale price|% off|was ₹/i);
  });
});

describe('import graph (JS budget)', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
  it('the account card and order blocks load lazily; the cart imports no savings module', () => {
    expect(src('components/account/account-area.tsx')).toMatch(
      /lazy\(\(\) =>\s*import\('\.\/savings-card'\)/,
    );
    expect(src('components/commerce/order-view-api.tsx')).toMatch(
      /lazy\(\(\) =>\s*import\('\.\.\/savings\/order-savings'\)/,
    );
    expect(src('components/commerce/order-view.tsx')).toMatch(
      /lazy\(\(\) =>\s*import\('\.\.\/savings\/order-savings-demo'\)/,
    );
    // The real-mode chunk never carries the demo catalogue.
    expect(src('components/savings/order-savings.tsx')).not.toMatch(/@\/demo\//);
    expect(src('components/commerce/cart-view.tsx')).not.toMatch(
      /savings-view|savings-api|order-savings|savings-card/,
    );
  });
});
