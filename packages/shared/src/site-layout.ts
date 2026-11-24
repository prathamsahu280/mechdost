/**
 * The home page layout the admin controls (hard rule 8; spec 08 "Content", design 2026-11-15 item 6): section order
 * and visibility, which category tiles show (3 to 6) with their emoji, and the workshop map's default view. One
 * pure module for the API (validation), the admin editor and the server-rendered home page. The same shape as the
 * demo editor's browser store (`apps/web/src/demo/site-config.ts`), so demo and real mode agree (L58); a web test
 * pins the lists to the demo's.
 */
export const HOME_SECTIONS = [
  // "Stuck on the road?" band (spec 22, 2026-11-24): first below the hero; shown only where roadside is on.
  'roadside',
  'audiences',
  'trust',
  'categories',
  'products',
  'route',
  'service',
  'workshops',
  'faq',
  'partners',
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** The nine category tiles of the home page, by key (the web maps key to slug, name and emoji). */
export const HOME_CATEGORY_KEYS = [
  'tyres',
  'lubricants',
  'batteries',
  'bearings',
  'filters',
  'spareParts',
  'accessories',
  'workshopTools',
  'evEssentials',
] as const;
export type HomeCategory = (typeof HOME_CATEGORY_KEYS)[number];

/** Tiles shown when the admin has not chosen (the concept's six). */
export const DEFAULT_FEATURED: readonly HomeCategory[] = [
  'tyres',
  'lubricants',
  'batteries',
  'bearings',
  'spareParts',
  'accessories',
];
export const FEATURED_MIN = 3;
export const FEATURED_MAX = 6;
export const MAP_MODES = ['satellite', 'map'] as const;
export type MapMode = (typeof MAP_MODES)[number];

/** `featured` null = the default six; `emoji` holds only the admin's overrides. */
export interface HomeLayout {
  order: HomeSection[];
  hidden: HomeSection[];
  featured: HomeCategory[] | null;
  emoji: Partial<Record<HomeCategory, string>>;
  mapDefault: MapMode;
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  order: [...HOME_SECTIONS],
  hidden: [],
  featured: null,
  emoji: {},
  mapDefault: 'satellite',
};

export type HomeLayoutProblem = 'shape' | 'section' | 'featured_count' | 'emoji';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isSection = (v: unknown): v is HomeSection => HOME_SECTIONS.some((s) => s === v);
const isCategory = (v: unknown): v is HomeCategory => HOME_CATEGORY_KEYS.some((k) => k === v);

/** One emoji (ZWJ sequences and variation selectors allowed); no letters, digits, spaces or markup. */
export function isEmoji(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 16 &&
    /\p{Extended_Pictographic}/u.test(value) &&
    !/[\p{L}\p{N}\s<>]/u.test(value)
  );
}

/** Every section exactly once: the given order first, then any section it left out. */
const fullOrder = (order: HomeSection[]): HomeSection[] => [...new Set([...order, ...HOME_SECTIONS])];

/** Check a layout from an editor. Strict: unknown or repeated entries are refused, not dropped. */
export function cleanHomeLayout(
  input: unknown,
): { ok: true; layout: HomeLayout } | { ok: false; problem: HomeLayoutProblem } {
  if (!isRecord(input) || !Array.isArray(input.order) || !Array.isArray(input.hidden))
    return { ok: false, problem: 'shape' };
  const { order, hidden, featured, emoji, mapDefault } = input;
  if (!order.every(isSection) || !hidden.every(isSection)) return { ok: false, problem: 'section' };
  if (new Set(order).size !== order.length || new Set(hidden).size !== hidden.length)
    return { ok: false, problem: 'section' };
  if (mapDefault !== 'map' && mapDefault !== 'satellite') return { ok: false, problem: 'shape' };
  let featuredOut: HomeCategory[] | null = null;
  if (featured !== null) {
    if (!Array.isArray(featured) || !featured.every(isCategory) || new Set(featured).size !== featured.length)
      return { ok: false, problem: 'shape' };
    if (featured.length < FEATURED_MIN || featured.length > FEATURED_MAX)
      return { ok: false, problem: 'featured_count' };
    featuredOut = featured;
  }
  const emojiOut: Partial<Record<HomeCategory, string>> = {};
  if (!isRecord(emoji)) return { ok: false, problem: 'shape' };
  for (const [key, raw] of Object.entries(emoji)) {
    if (!isCategory(key) || typeof raw !== 'string') return { ok: false, problem: 'shape' };
    const text = raw.trim();
    if (text === '') continue;
    if (!isEmoji(text)) return { ok: false, problem: 'emoji' };
    emojiOut[key] = text;
  }
  return {
    ok: true,
    layout: { order: fullOrder(order), hidden, featured: featuredOut, emoji: emojiOut, mapDefault },
  };
}

/** A stored value read back: anything that does not pass is the default layout (a hand-edited row never breaks the page). */
export function readHomeLayout(value: unknown): HomeLayout {
  const r = cleanHomeLayout(value);
  return r.ok ? r.layout : DEFAULT_HOME_LAYOUT;
}

/** The sections to render, in order, without the hidden ones. */
export function visibleSections(layout: HomeLayout): HomeSection[] {
  return layout.order.filter((s) => !layout.hidden.includes(s));
}

/** The category tiles to render: the admin's choice or the default six. */
export function featuredCategories(layout: HomeLayout): readonly HomeCategory[] {
  return layout.featured ?? DEFAULT_FEATURED;
}
