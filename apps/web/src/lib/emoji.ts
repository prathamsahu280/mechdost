import type { CategoryKey } from '@/demo/catalogue';
import type { NavKey } from './nav';

/**
 * Decorative emoji used in navigation and category UI (user request 2026-11-01: "add some emojis to the top
 * bar, the cart button etc."). Always rendered with `aria-hidden` next to a real text label, so screen readers
 * never announce them, and they need no translation. Admin-managed categories carry their own emoji in Phase 1.
 */
export const NAV_EMOJI: Record<NavKey, string> = {
  home: '🏠',
  shop: '🛍️',
  workshops: '🔧',
  vehicles: '🚗',
  business: '🤝',
};

export const CATEGORY_EMOJI: Record<CategoryKey, string> = {
  tyres: '🛞',
  lubricants: '🛢️',
  batteries: '🔋',
  bearings: '⚙️',
  filters: '🌀',
  spareParts: '🔩',
  accessories: '✨',
  workshopTools: '🧰',
  evEssentials: '⚡',
};

export const UI_EMOJI = {
  cart: '🛒',
  account: '👤',
  signOut: '🚪',
  bell: '🔔',
  language: '🌐',
  dark: '🌙',
  light: '☀️',
  orders: '📦',
  workshops: '🔧',
  all: '🧾',
} as const;
