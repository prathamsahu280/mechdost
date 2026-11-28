import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shopTodayCounts } from '@/lib/shop-today';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (l: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/shared/src/i18n/${l}.json`, import.meta.url), 'utf8'),
  ) as Record<string, Record<string, string>>;

describe('shop Today delivered-today count (P1, design § 5.2)', () => {
  // 2026-11-28 10:00 IST = 04:30Z; IST midnight is 2026-11-27T18:30Z.
  const now = new Date('2026-11-28T04:30:00Z');
  const base = { offers: 0, active: [], activeMore: false, doneMore: false, now };
  it('counts only rows delivered on the IST day of now', () => {
    const c = shopTodayCounts({
      ...base,
      done: [
        { status: 'delivered', deliveredAt: '2026-11-27T18:31:00Z' },
        { status: 'delivered', deliveredAt: '2026-11-28T03:00:00Z' },
        { status: 'delivered', deliveredAt: '2026-11-27T18:29:00Z' },
        { status: 'delivered', deliveredAt: null },
        { status: 'delivered' },
        { status: 'given_up', deliveredAt: '2026-11-28T03:00:00Z' },
      ],
    });
    expect(c.delivered).toBe('2');
  });
  it('says N+ when the first done page is full (more rows exist)', () => {
    const c = shopTodayCounts({
      ...base,
      doneMore: true,
      done: [{ status: 'delivered', deliveredAt: '2026-11-28T03:00:00Z' }],
    });
    expect(c.delivered).toBe('1+');
  });
  it('has the Hindi and English tile label', () => {
    expect(json('en').partnerShop?.kpi_delivered_today).toBe('Delivered today');
    expect(json('hi').partnerShop?.kpi_delivered_today).toBe('आज पहुँचाए');
    expect(src('components/portal/shop-today-tiles.tsx')).toMatch(/kpi_delivered_today/);
  });
});

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
      done: [{ status: 'delivered', deliveredAt: '2026-11-28T03:00:00Z' }, { status: 'given_up' }],
      doneMore: false,
      now: new Date('2026-11-28T04:30:00Z'),
    });
    expect(c).toEqual({ newOrders: '2', packing: '2', out: '2', readyForPickup: '1', delivered: '1' });
  });
  it('says 20+ when a list has a next page', () => {
    const c = shopTodayCounts({
      offers: 0,
      active: [],
      activeMore: true,
      done: [],
      doneMore: true,
      now: new Date(),
    });
    expect(c.packing).toBe('0+');
    expect(c.delivered).toBe('0+');
  });
  it('performance measures are bullet bars against the city middle', () => {
    const perf = src('components/portal/shop-performance-api.tsx');
    expect(perf).toMatch(/<BulletBar/);
    expect(perf).toMatch(/noCityText=\{t\('perfNoCity'\)\}/);
  });
  it('staff earnings by day are money-green day bars with a table view', () => {
    const staff = src('components/portal/shop-staff-performance-api.tsx');
    expect(staff).toMatch(/<DailyBars[\s\S]*tone="success"/);
  });
  it('tiles sit above the offers and every partnerShop string has Hindi', () => {
    const api = src('components/portal/shop-portal-api.tsx');
    expect(api.indexOf('<ShopTodayTiles')).toBeLessThan(api.indexOf('aria-labelledby="offered-title"'));
    const page = src('app/[locale]/partner/shop/(portal)/layout.tsx');
    expect(page).toMatch(/'partnerKit'/);
    expect(page).toMatch(/'partnerShop'/);
    const en = json('en');
    const hi = json('hi');
    for (const k of Object.keys(en.partnerShop ?? {})) expect(hi.partnerShop?.[k], k).toBeTruthy();
  });
});
