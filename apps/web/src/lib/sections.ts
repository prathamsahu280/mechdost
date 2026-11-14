import { BROWSER_ONLY_FEATURES, QUOTES_AVAILABLE } from './data-mode';

/**
 * Section lists for the account area and the admin console. Kept outside the client components: server pages
 * (generateStaticParams) cannot read values exported from a 'use client' module.
 */
const ALL_ACCOUNT_SECTIONS = [
  'overview',
  'orders',
  'services',
  'quotes',
  'support',
  'coins',
  'vehicles',
  'addresses',
  'profile',
] as const;
export type AccountSection = (typeof ALL_ACCOUNT_SECTIONS)[number];

const ALL_ADMIN_SECTIONS = [
  'overview',
  'orders',
  'services',
  'quotes',
  'applications',
  'partners',
  // Product texts, fit, packs and customer prices per city/PIN (plan 2026-11-13 admin catalogue, Task 5).
  'catalogue',
  // Customer blocks (cod_only / orders / full), research/admin-console.md §5.
  'customers',
  'reviews',
  // Customer requests from the website and WhatsApp (spec 09).
  'support',
  'coins',
  // Site customisation (spec 08 "Content" + "Settings", hard rule 8).
  'content',
  'layout',
  'settings',
  // WhatsApp and other notification channels (spec 10, hard rule 8).
  'notifications',
] as const;
export type AdminSection = (typeof ALL_ADMIN_SECTIONS)[number];

/** Sections for features that have no API yet (`BROWSER_ONLY_FEATURES`): hidden in real mode. */
const BROWSER_ONLY_SECTIONS: readonly string[] = ['coins', 'reviews'];
/** Bulk quotes have their own flag: on the API in real mode (spec 19, 2026-11-14). */
const hiddenQuotes = (s: string) => s === 'quotes' && !QUOTES_AVAILABLE;
const shown = <T extends string>(all: readonly T[]): readonly T[] =>
  all.filter((s) => !hiddenQuotes(s) && (BROWSER_ONLY_FEATURES || !BROWSER_ONLY_SECTIONS.includes(s)));

/** Account sections shown in this build (navigation, routes). */
export const ACCOUNT_SECTIONS = shown(ALL_ACCOUNT_SECTIONS);
/** Admin sections shown in this build (navigation, routes). */
export const ADMIN_SECTIONS = shown(ALL_ADMIN_SECTIONS);
