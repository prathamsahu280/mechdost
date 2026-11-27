import type { MyShopDto } from '@mechdost/shared/shop-api';
import { countText } from './partner-kit';

/**
 * Pure views of the shop portal tabs (partner portals UI upgrade, batch A; design 2026-11-27 § 5). No React and no
 * i18n runtime: the frame, the tabs and the unit tests share them.
 */

/** The five tabs (§ 5.1), in order. Today is the portal home; the packing slip stays outside the frame. */
export const SHOP_TABS = [
  { key: 'today', path: '/partner/shop' },
  { key: 'orders', path: '/partner/shop/orders' },
  { key: 'stock', path: '/partner/shop/stock' },
  { key: 'numbers', path: '/partner/shop/numbers' },
  { key: 'profile', path: '/partner/shop/profile' },
] as const;
export type ShopTab = (typeof SHOP_TABS)[number]['key'];

/** The tab a path opens (query and hash ignored); anything else under the portal is Today. */
export function shopTabFor(path: string): ShopTab {
  const bare = (path.split(/[?#]/)[0] ?? '').replace(/\/$/, '');
  const hit = SHOP_TABS.find((t) => t.key !== 'today' && bare === t.path);
  return hit ? hit.key : 'today';
}

/**
 * OLD-ANCHOR MAP. Anchors of the one-page portal (before 2026-11-27) that moved to another tab; a stored link or a
 * bookmark with one of these hashes is sent on to the tab that now holds the block. Today keeps `#offered-title` and
 * `#active-title`, so those are not listed. Notice links themselves are tab paths (see the notice catalogue).
 */
const LEGACY_HASH: Record<string, string> = {
  '#warnings': '/partner/shop/numbers#warnings',
  '#shop-performance': '/partner/shop/numbers#shop-performance',
  '#prices-title': '/partner/shop/stock#prices-title',
  '#new-product-title': '/partner/shop/stock#new-product-title',
  '#shop-csv': '/partner/shop/stock#shop-csv',
  '#shop-offers': '/partner/shop/stock#shop-offers',
  '#shop-team': '/partner/shop/profile#shop-team',
  '#agreement-shop-title': '/partner/shop/profile#agreement-shop-title',
  '#delivered-title': '/partner/shop/orders?lane=delivered',
};
export const legacyShopTarget = (hash: string): string | null => LEGACY_HASH[hash] ?? null;

/** Order lanes (§ 5.1), in this order; "Ready for pickup" only shows for shops with MechDost agent delivery. */
export const SHOP_LANES = ['packing', 'ready', 'out', 'delivered', 'given_up'] as const;
export type ShopLane = (typeof SHOP_LANES)[number];

export const lanesFor = (agentMode: boolean): ShopLane[] =>
  SHOP_LANES.filter((l) => agentMode || l !== 'ready');

/** The lane of one order from its real state (and delivery mode): every status lands in exactly one lane. */
export function shopLaneOf(status: string, deliveryMode?: 'agent' | 'shop'): ShopLane {
  switch (status) {
    case 'shipped':
    case 'out_for_delivery':
      return 'out';
    case 'ready_for_pickup':
      return 'ready';
    case 'packed':
      return deliveryMode === 'agent' ? 'ready' : 'packing';
    case 'delivered':
      return 'delivered';
    case 'given_up':
    case 'cancelled':
      return 'given_up';
    default:
      return 'packing';
  }
}

interface Row {
  status: string;
  deliveryMode?: 'agent' | 'shop' | undefined;
}

/** Count text per lane from the two loaded lists ("20+" when a list has another page). */
export function laneCounts(
  active: readonly Row[],
  activeMore: boolean,
  done: readonly Row[],
  doneMore: boolean,
): Record<ShopLane, string> {
  const n: Record<ShopLane, number> = { packing: 0, ready: 0, out: 0, delivered: 0, given_up: 0 };
  for (const o of [...active, ...done]) n[shopLaneOf(o.status, o.deliveryMode)] += 1;
  const more = (l: ShopLane) => (l === 'delivered' || l === 'given_up' ? doneMore : activeMore);
  return Object.fromEntries(SHOP_LANES.map((l) => [l, countText(n[l], more(l))])) as Record<ShopLane, string>;
}

/** A valid `?lane=` wins; otherwise the first lane with work, else the first lane. */
export function pickShopLane(
  param: string | null,
  counts: Record<ShopLane, number>,
  agentMode: boolean,
): ShopLane {
  const lanes = lanesFor(agentMode);
  const asked = lanes.find((l) => l === param);
  if (asked) return asked;
  return lanes.find((l) => counts[l] > 0) ?? 'packing';
}

/** The strip's state in words (never colour alone): the key in `partnerShop` and the dot tone. */
export function shopStripState(s: Pick<MyShopDto, 'status' | 'busy' | 'openNow'>): {
  key: 'state_suspended' | 'state_paused' | 'state_pending' | 'state_busy' | 'state_closed' | 'state_taking';
  tone: 'ok' | 'busy' | 'off';
} {
  if (s.status === 'suspended') return { key: 'state_suspended', tone: 'off' };
  if (s.status === 'paused') return { key: 'state_paused', tone: 'off' };
  if (s.status === 'pending') return { key: 'state_pending', tone: 'off' };
  if (s.busy) return { key: 'state_busy', tone: 'busy' };
  if (!s.openNow) return { key: 'state_closed', tone: 'off' };
  return { key: 'state_taking', tone: 'ok' };
}
