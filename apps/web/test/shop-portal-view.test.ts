/**
 * Shop portal tabs (partner portals UI upgrade, batch A; design 2026-11-27 § 5): tabs and routes, order lanes by real
 * order state, the old one-page anchors and every partner link stored in notices after the split.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE_CATALOGUE, noticeKinds } from '@mechdost/shared/notice-catalogue';
import {
  SHOP_TABS,
  laneCounts,
  lanesFor,
  legacyShopTarget,
  pickShopLane,
  shopLaneOf,
  shopStripState,
  shopTabFor,
} from '../src/lib/shop-portal-view';

const APP = join(__dirname, '..', 'src', 'app', '[locale]');
const bare = (path: string) => (path.split(/[?#]/)[0] ?? '').replace(/\/$/, '');
// The tabs live in the `(portal)` route group, so the packing slip stays outside the frame.
const pageExists = (path: string) => {
  const segs = bare(path).split('/').filter(Boolean);
  const [partner, shop, ...rest] = segs;
  return existsSync(join(APP, partner ?? '', shop ?? '', '(portal)', ...rest, 'page.tsx'));
};

describe('tabs', () => {
  it('has the five tabs in the design order, each a real page', () => {
    expect(SHOP_TABS.map((t) => t.key)).toEqual(['today', 'orders', 'stock', 'numbers', 'profile']);
    for (const t of SHOP_TABS) expect(pageExists(t.path), t.path).toBe(true);
  });
  it('reads the tab from a path, ignoring query, hash and a trailing slash', () => {
    expect(shopTabFor('/partner/shop')).toBe('today');
    expect(shopTabFor('/partner/shop/orders?lane=out')).toBe('orders');
    expect(shopTabFor('/partner/shop/stock#prices-title')).toBe('stock');
    expect(shopTabFor('/partner/shop/numbers/')).toBe('numbers');
    expect(shopTabFor('/partner/shop/profile')).toBe('profile');
    expect(shopTabFor('/partner/shop/slip/MD-1')).toBe('today');
  });
});

describe('order lanes by real order state', () => {
  it('puts every shop status in exactly one lane', () => {
    expect(shopLaneOf('confirmed')).toBe('packing');
    expect(shopLaneOf('packed')).toBe('packing');
    expect(shopLaneOf('packed', 'shop')).toBe('packing');
    expect(shopLaneOf('packed', 'agent')).toBe('ready');
    expect(shopLaneOf('ready_for_pickup', 'agent')).toBe('ready');
    expect(shopLaneOf('shipped')).toBe('out');
    expect(shopLaneOf('out_for_delivery')).toBe('out');
    expect(shopLaneOf('delivered')).toBe('delivered');
    expect(shopLaneOf('given_up')).toBe('given_up');
    expect(shopLaneOf('cancelled')).toBe('given_up');
  });
  it('shows "Ready for pickup" only for shops with agent delivery', () => {
    expect(lanesFor(false)).toEqual(['packing', 'out', 'delivered', 'given_up']);
    expect(lanesFor(true)).toEqual(['packing', 'ready', 'out', 'delivered', 'given_up']);
  });
  it('counts each lane, with a plus when its list has another page', () => {
    const c = laneCounts(
      [
        { status: 'confirmed' },
        { status: 'packed', deliveryMode: 'agent' },
        { status: 'out_for_delivery' },
        { status: 'out_for_delivery' },
      ],
      false,
      [{ status: 'delivered' }, { status: 'given_up' }, { status: 'cancelled' }],
      true,
    );
    expect(c).toEqual({ packing: '1', ready: '1', out: '2', delivered: '1+', given_up: '2+' });
  });
  it('a valid ?lane= wins; otherwise the first lane with work; else packing', () => {
    const counts = { packing: 0, ready: 0, out: 2, delivered: 5, given_up: 0 };
    expect(pickShopLane('delivered', counts, false)).toBe('delivered');
    expect(pickShopLane(null, counts, false)).toBe('out');
    expect(pickShopLane('nonsense', counts, false)).toBe('out');
    expect(pickShopLane('ready', counts, false)).toBe('out');
    expect(pickShopLane('ready', counts, true)).toBe('ready');
    expect(pickShopLane(null, { ...counts, out: 0, delivered: 0 }, false)).toBe('packing');
  });
});

describe('strip state in words', () => {
  const shop = { status: 'approved', busy: false, openNow: true } as const;
  it('says taking orders, busy, closed, paused, suspended or pending', () => {
    expect(shopStripState(shop)).toEqual({ key: 'state_taking', tone: 'ok' });
    expect(shopStripState({ ...shop, busy: true })).toEqual({ key: 'state_busy', tone: 'busy' });
    expect(shopStripState({ ...shop, openNow: false })).toEqual({ key: 'state_closed', tone: 'off' });
    expect(shopStripState({ ...shop, status: 'paused' })).toEqual({ key: 'state_paused', tone: 'off' });
    expect(shopStripState({ ...shop, status: 'suspended' })).toEqual({ key: 'state_suspended', tone: 'off' });
    expect(shopStripState({ ...shop, status: 'pending' })).toEqual({ key: 'state_pending', tone: 'off' });
  });
});

describe('old one-page anchors land on the tab that now holds the block', () => {
  it.each([
    ['#warnings', '/partner/shop/numbers#warnings'],
    ['#shop-performance', '/partner/shop/numbers#shop-performance'],
    ['#prices-title', '/partner/shop/stock#prices-title'],
    ['#new-product-title', '/partner/shop/stock#new-product-title'],
    ['#shop-csv', '/partner/shop/stock#shop-csv'],
    ['#shop-offers', '/partner/shop/stock#shop-offers'],
    ['#shop-team', '/partner/shop/profile#shop-team'],
    ['#agreement-shop-title', '/partner/shop/profile#agreement-shop-title'],
    ['#delivered-title', '/partner/shop/orders?lane=delivered'],
  ])('%s -> %s', (hash, target) => {
    expect(legacyShopTarget(hash)).toBe(target);
    expect(pageExists(target), target).toBe(true);
  });
  it('leaves anchors that stay on Today alone', () => {
    for (const h of ['#offered-title', '#active-title', '', '#nothing'])
      expect(legacyShopTarget(h)).toBeNull();
  });
});

describe('links stored in shop notices keep working', () => {
  const shopLinks = noticeKinds()
    .map((k) => [k, NOTICE_CATALOGUE[k].link({})] as const)
    .filter(([, link]) => link.startsWith('/partner/shop'));
  it('finds the shop notices', () => {
    expect(shopLinks.length).toBeGreaterThan(5);
  });
  it.each(shopLinks)('%s -> %s is a tab', (_kind, link) => {
    expect(
      SHOP_TABS.some((t) => t.path === bare(link)),
      link,
    ).toBe(true);
  });
  it('new warnings open Numbers and a new delivery mode decision opens My shop', () => {
    expect(NOTICE_CATALOGUE['partner.warning'].link({})).toBe('/partner/shop/numbers');
    expect(NOTICE_CATALOGUE['shop.delivery_mode_decided'].link({})).toBe('/partner/shop/profile');
  });
});
