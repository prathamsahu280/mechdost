import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shopTodayCounts } from '@/lib/shop-today';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (l: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/shared/src/i18n/${l}.json`, import.meta.url), 'utf8'),
  ) as Record<string, Record<string, string>>;

describe('shop Today counts (design 2026-11-27 § 5.2)', () => {
  it('splits active orders into packing, ready for pickup and on the way', () => {
    const c = shopTodayCounts({
      offers: 2,
      active: [
        { status: 'accepted' },
        { status: 'packed', deliveryMode: 'shop' },
        { status: 'packed', deliveryMode: 'agent' },
        { status: 'out_for_delivery' },
        { status: 'shipped' },
      ],
      activeMore: false,
      done: [{ status: 'delivered' }, { status: 'given_up' }],
      doneMore: false,
    });
    expect(c).toEqual({ newOrders: '2', packing: '2', out: '2', readyForPickup: '1', delivered: '1' });
  });
  it('says 20+ when a list has a next page', () => {
    const c = shopTodayCounts({ offers: 0, active: [], activeMore: true, done: [], doneMore: true });
    expect(c.packing).toBe('0+');
    expect(c.delivered).toBe('0+');
  });
  it('tiles sit above the offers and every partnerShop string has Hindi', () => {
    const api = src('components/portal/shop-portal-api.tsx');
    expect(api.indexOf('<ShopTodayTiles')).toBeLessThan(api.indexOf('aria-labelledby="offered-title"'));
    const page = src('app/[locale]/partner/shop/page.tsx');
    expect(page).toMatch(/'partnerKit'/);
    expect(page).toMatch(/'partnerShop'/);
    const en = json('en');
    const hi = json('hi');
    for (const k of Object.keys(en.partnerShop ?? {})) expect(hi.partnerShop?.[k], k).toBeTruthy();
  });
});
