/**
 * DEMO SITE CONFIG — admin customisation (spec 08 "Content" + "Settings", hard rule 8) stored in this browser.
 * Phase 1 replaces it with `content_blocks`, `site_sections` and per-city `settings` behind `/admin/*` RBAC; the
 * admin screens stay the same. Everything read from storage is validated and clamped; every write checks the
 * version the editor loaded (a stale tab cannot overwrite newer changes) and appends an audit entry.
 */
import { useSyncExternalStore } from 'react';
import { CATEGORY_KEYS, type CategoryKey } from './catalogue';
import {
  DEFAULT_FEATURED,
  FEATURED_MAX,
  FEATURED_MIN,
  HOME_SECTIONS,
  SITE_CONFIG_KEY,
  type HomeSection,
} from '@/lib/site-layout';

export type SiteLocale = 'en' | 'hi';

/** Text the admin can override, per locale. Defaults come from the locale files. */
export const CONTENT_KEYS = [
  'announcement.orders',
  'announcement.workshops',
  'hero.eyebrow',
  'hero.titleLine1',
  'hero.titleLine2',
  'hero.lead',
] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];
export const CONTENT_MAX = { 'hero.lead': 280 } as Partial<Record<ContentKey, number>>;
export const CONTENT_MAX_DEFAULT = 80;

export interface SiteSettings {
  /** Minutes a shop has to accept an offered order (spec 04). Applies to orders offered after the change. */
  acceptMinutes: number;
  /** Minimum total units for a bulk quote (spec 19, Q20). */
  bulkMinUnits: number;
  /** Delivery fee below the free-delivery threshold (spec 03). Applies to new orders; placed orders keep theirs. */
  deliveryFeePaise: number;
  freeDeliveryFromPaise: number;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  acceptMinutes: 15,
  bulkMinUnits: 10,
  deliveryFeePaise: 4_900,
  freeDeliveryFromPaise: 99_900,
};

/** Inclusive limits; money in paise (whole rupees in the editor). */
export const SETTING_LIMITS: Record<keyof SiteSettings, readonly [number, number]> = {
  acceptMinutes: [5, 120],
  bulkMinUnits: [2, 500],
  deliveryFeePaise: [0, 50_000],
  freeDeliveryFromPaise: [0, 5_000_000],
};

export interface AuditEntry {
  at: string;
  actor: string;
  area: 'content' | 'layout' | 'categories' | 'settings';
  action: 'save' | 'reset';
  fields: string[];
}

export type SiteArea = AuditEntry['area'];

export interface SiteConfig {
  /** One version per area (like a per-row `version`): editors of different areas never block each other. */
  versions: Record<SiteArea, number>;
  content: Partial<Record<ContentKey, Partial<Record<SiteLocale, string>>>>;
  layout: { order: HomeSection[]; hidden: HomeSection[] };
  /** Category tiles on the home page; null = default six. */
  featured: CategoryKey[] | null;
  emoji: Partial<Record<CategoryKey, string>>;
  settings: SiteSettings;
  audit: AuditEntry[];
}

const ZERO_VERSIONS: Record<SiteArea, number> = { content: 0, layout: 0, categories: 0, settings: 0 };

export const DEFAULT_CONFIG: SiteConfig = {
  versions: ZERO_VERSIONS,
  content: {},
  layout: { order: [...HOME_SECTIONS], hidden: [] },
  featured: null,
  emoji: {},
  settings: DEFAULT_SETTINGS,
  audit: [],
};

const MAX_AUDIT = 30;

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isSection = (v: unknown): v is HomeSection => HOME_SECTIONS.some((s) => s === v);
const isCategory = (v: unknown): v is CategoryKey => CATEGORY_KEYS.some((k) => k === v);

/** One emoji (incl. ZWJ sequences and variation selectors); no letters, digits, spaces or markup. */
export function isEmoji(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 16 &&
    /\p{Extended_Pictographic}/u.test(value) &&
    !/[\p{L}\p{N}\s<>]/u.test(value)
  );
}

export function clampSetting(key: keyof SiteSettings, value: number): number {
  const [min, max] = SETTING_LIMITS[key];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : DEFAULT_SETTINGS[key];
}

export function contentMax(key: ContentKey): number {
  return CONTENT_MAX[key] ?? CONTENT_MAX_DEFAULT;
}

/** Plain text only: trims, collapses whitespace, drops control characters and caps the length. */
export function cleanText(key: ContentKey, value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, contentMax(key));
}

function parse(raw: string | null): SiteConfig {
  if (!raw) return DEFAULT_CONFIG;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (!isRecord(data)) return DEFAULT_CONFIG;

  const content: SiteConfig['content'] = {};
  if (isRecord(data.content)) {
    for (const key of CONTENT_KEYS) {
      const entry = data.content[key];
      if (!isRecord(entry)) continue;
      const out: Partial<Record<SiteLocale, string>> = {};
      for (const locale of ['en', 'hi'] as const) {
        const v = entry[locale];
        if (typeof v === 'string' && cleanText(key, v)) out[locale] = cleanText(key, v);
      }
      if (out.en ?? out.hi) content[key] = out;
    }
  }

  const layout = isRecord(data.layout) ? data.layout : {};
  const order = Array.isArray(layout.order) ? layout.order.filter(isSection) : [];
  // Every section exactly once: keep the stored order, append any section the stored list is missing.
  const fullOrder = [...new Set([...order, ...HOME_SECTIONS])];
  const hidden = Array.isArray(layout.hidden) ? [...new Set(layout.hidden.filter(isSection))] : [];

  const featuredRaw = Array.isArray(data.featured) ? [...new Set(data.featured.filter(isCategory))] : null;
  const featured =
    featuredRaw && featuredRaw.length >= FEATURED_MIN && featuredRaw.length <= FEATURED_MAX
      ? featuredRaw
      : null;

  const emoji: SiteConfig['emoji'] = {};
  if (isRecord(data.emoji)) {
    for (const key of CATEGORY_KEYS) {
      const v = data.emoji[key];
      if (typeof v === 'string' && isEmoji(v.trim())) emoji[key] = v.trim();
    }
  }

  const s = isRecord(data.settings) ? data.settings : {};
  const settings = Object.fromEntries(
    (Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[]).map((k) => {
      const v = s[k];
      return [k, typeof v === 'number' ? clampSetting(k, v) : DEFAULT_SETTINGS[k]];
    }),
  ) as unknown as SiteSettings;

  const audit = Array.isArray(data.audit)
    ? data.audit
        .filter(
          (a): a is AuditEntry =>
            isRecord(a) &&
            typeof a.at === 'string' &&
            typeof a.actor === 'string' &&
            typeof a.area === 'string' &&
            Array.isArray(a.fields),
        )
        .slice(0, MAX_AUDIT)
    : [];

  return {
    versions: Object.fromEntries(
      (Object.keys(ZERO_VERSIONS) as SiteArea[]).map((a) => {
        const v = isRecord(data.versions) ? data.versions[a] : undefined;
        return [a, typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0];
      }),
    ) as Record<SiteArea, number>,
    content,
    layout: { order: fullOrder, hidden },
    featured,
    emoji,
    settings,
    audit,
  };
}

// ── store ─────────────────────────────────────────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: SiteConfig } = { raw: null, value: DEFAULT_CONFIG };

/** Current config (defaults on the server or when storage is blocked). Safe to call outside React. */
export function siteConfig(): SiteConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SITE_CONFIG_KEY);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

export function siteSettings(): SiteSettings {
  return siteConfig().settings;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SITE_CONFIG_KEY) {
      window.__mdSiteCss?.(siteConfig());
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSiteConfig(): SiteConfig {
  return useSyncExternalStore(subscribe, siteConfig, () => DEFAULT_CONFIG);
}

export function useSiteSettings(): SiteSettings {
  return useSiteConfig().settings;
}

/** Admin text override for this locale, or null to keep the default text. */
export function useContentOverride(key: ContentKey, locale: string): string | null {
  const entry = useSiteConfig().content[key];
  return (locale === 'hi' ? entry?.hi : entry?.en) ?? null;
}

export function useCategoryEmoji(): (key: CategoryKey, fallback: string) => string {
  const emoji = useSiteConfig().emoji;
  return (key, fallback) => emoji[key] ?? fallback;
}

type Change = Omit<SiteConfig, 'versions' | 'audit'>;

/**
 * Applies a change if the area's stored version still equals `expectedVersion` (compare-and-set, like the API's
 * conditional UPDATE … WHERE version = $n). Returns false when another tab saved that area in between.
 */
function commit(
  expectedVersion: number,
  entry: Omit<AuditEntry, 'at'>,
  change: (current: SiteConfig) => Change,
): boolean {
  const current = siteConfig();
  if (current.versions[entry.area] !== expectedVersion) return false;
  const next: SiteConfig = {
    ...change(current),
    versions: { ...current.versions, [entry.area]: expectedVersion + 1 },
    audit: [{ ...entry, at: new Date().toISOString() }, ...current.audit].slice(0, MAX_AUDIT),
  };
  try {
    window.localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  window.__mdSiteCss?.(next);
  for (const l of listeners) l();
  return true;
}

const without = (c: SiteConfig): Change => ({
  content: c.content,
  layout: c.layout,
  featured: c.featured,
  emoji: c.emoji,
  settings: c.settings,
});

export function saveContent(expectedVersion: number, actor: string, content: SiteConfig['content']): boolean {
  const clean: SiteConfig['content'] = {};
  for (const key of CONTENT_KEYS) {
    const entry = content[key];
    const en = entry?.en ? cleanText(key, entry.en) : '';
    const hi = entry?.hi ? cleanText(key, entry.hi) : '';
    if (en || hi) clean[key] = { ...(en ? { en } : {}), ...(hi ? { hi } : {}) };
  }
  return commit(
    expectedVersion,
    { actor, area: 'content', action: 'save', fields: Object.keys(clean) },
    (c) => ({
      ...without(c),
      content: clean,
    }),
  );
}

export function saveLayout(expectedVersion: number, actor: string, layout: SiteConfig['layout']): boolean {
  const order = [...new Set([...layout.order.filter(isSection), ...HOME_SECTIONS])];
  const hidden = [...new Set(layout.hidden.filter(isSection))];
  return commit(expectedVersion, { actor, area: 'layout', action: 'save', fields: hidden }, (c) => ({
    ...without(c),
    layout: { order, hidden },
  }));
}

export function saveCategories(
  expectedVersion: number,
  actor: string,
  featured: CategoryKey[],
  emoji: SiteConfig['emoji'],
): boolean {
  const list = [...new Set(featured.filter(isCategory))];
  if (list.length < FEATURED_MIN || list.length > FEATURED_MAX) return false;
  const cleanEmoji: SiteConfig['emoji'] = {};
  for (const key of CATEGORY_KEYS) {
    const v = emoji[key]?.trim();
    if (v && isEmoji(v)) cleanEmoji[key] = v;
  }
  const isDefault =
    list.length === DEFAULT_FEATURED.length && list.every((k, i) => k === DEFAULT_FEATURED[i]);
  return commit(
    expectedVersion,
    { actor, area: 'categories', action: 'save', fields: Object.keys(cleanEmoji) },
    (c) => ({ ...without(c), featured: isDefault ? null : list, emoji: cleanEmoji }),
  );
}

export function saveSettings(expectedVersion: number, actor: string, settings: SiteSettings): boolean {
  const clean = Object.fromEntries(
    (Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[]).map((k) => [k, clampSetting(k, settings[k])]),
  ) as unknown as SiteSettings;
  return commit(
    expectedVersion,
    {
      actor,
      area: 'settings',
      action: 'save',
      fields: (Object.keys(clean) as (keyof SiteSettings)[]).filter((k) => clean[k] !== siteSettings()[k]),
    },
    (c) => ({ ...without(c), settings: clean }),
  );
}

/** Restores one area to its defaults (audited like any other change). */
export function resetArea(expectedVersion: number, actor: string, area: AuditEntry['area']): boolean {
  return commit(expectedVersion, { actor, area, action: 'reset', fields: [] }, (c) => {
    const rest = without(c);
    if (area === 'content') return { ...rest, content: {} };
    if (area === 'layout') return { ...rest, layout: DEFAULT_CONFIG.layout };
    if (area === 'categories') return { ...rest, featured: null, emoji: {} };
    return { ...rest, settings: DEFAULT_SETTINGS };
  });
}
