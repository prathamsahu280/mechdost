import type { CategoryKey } from '@/demo/catalogue';

/**
 * Decorative emoji for category tiles and a few in-page marks. The site chrome (header, footer, bottom dock) uses lucide
 * line icons instead (decision 2026-11-23, guard test/chrome-v4.test.ts). Always rendered with `aria-hidden` next to a
 * real text label, so screen readers never announce them, and they need no translation.
 */
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
  all: '🧾',
} as const;
