import { AUTH_MODE } from './auth/mode';
import { BROWSER_ONLY_FEATURES, QUOTES_AVAILABLE } from './data-mode';

/**
 * Section lists for the account area and the admin console. Kept outside the client components: server pages
 * (generateStaticParams) cannot read values exported from a 'use client' module.
 */
const ALL_ACCOUNT_SECTIONS = [
  'overview',
  'orders',
  // Where each refund stands, in plain words (spec 05, user 2026-11-23): demo data in the demo, the API otherwise.
  'refunds',
  'services',
  'quotes',
  'support',
  'coins',
  'vehicles',
  'addresses',
  // Saved products (design 2026-11-15 item 5): real sign-in only, the list lives on the server.
  'wishlist',
  // The bell's choices and this device's push (spec 10, 2026-11-15): real sign-in only, it reads the API.
  'notifications',
  // Consents per purpose, data download, account deletion request (DPDP, design 2026-11-15): real sign-in only.
  'privacy',
  'profile',
] as const;
export type AccountSection = (typeof ALL_ACCOUNT_SECTIONS)[number];

export const ALL_ADMIN_SECTIONS = [
  'overview',
  // Analytics from our own data (spec 08 "Analytics", 2026-11-14): real sign-in only (it reads the API).
  'analytics',
  'orders',
  // The finance refund queue (spec 05, 2026-11-15): real sign-in only, it reads the API.
  'refunds',
  'services',
  // Roadside assistance (spec 22, 2026-11-24): dispatch queue, cancel and the per-city settings.
  'roadside',
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
  // Coupons, MechDost- and shop-funded (spec 08 Promotions, 2026-11-15): real sign-in only (it reads the API).
  'coupons',
  // Site customisation (spec 08 "Content" + "Settings", hard rule 8).
  'content',
  'layout',
  'settings',
  // WhatsApp and other notification channels (spec 10, hard rule 8).
  'notifications',
  // Staff and roles, and the audit log viewer (design 2026-11-15): real sign-in only (they read the API).
  'staff',
  'audit',
  // CSV exports (design 2026-11-15 item 4): real sign-in only (they read the API).
  'exports',
  // Latest Sentry issues of the website and the API (decision 2026-11-14); real sign-in only (it reads the API).
  'errors',
  // Ustaad Network settings and tables (spec 23 § 15, task G1): real sign-in only (it reads the API).
  'ustaad',
] as const;
export type AdminSection = (typeof ALL_ADMIN_SECTIONS)[number];

/** Sections for features that have no API yet (`BROWSER_ONLY_FEATURES`): hidden in real mode. */
const BROWSER_ONLY_SECTIONS: readonly string[] = [];
/** Bulk quotes have their own flag: on the API in real mode, on the browser store in the demo (spec 19, 2026-11-14). */
const quotesShown = QUOTES_AVAILABLE;
/**
 * Review moderation (2026-11-14): the demo queue in the browser demo, the API queue with real sign-in; hidden only
 * in the mixed build (real data, demo sign-in), where neither queue would show the reviews customers see.
 */
const reviewsShown = BROWSER_ONLY_FEATURES || AUTH_MODE === 'firebase';
/**
 * Sections that only read the API and have no demo version: shown with real sign-in only. One list for all of them
 * (Analytics and the monitoring Errors panel, 2026-11-14; add later ones here).
 */
const REAL_SIGN_IN_ONLY: readonly string[] = [
  'analytics',
  'errors',
  'refunds',
  'staff',
  'audit',
  'coupons',
  'exports',
  'wishlist',
  'ustaad',
];
/** Real-only names that this list also shows in the demo (the account's Refunds has sample data; the admin's does not). */
const shown = <T extends string>(all: readonly T[], demoToo: readonly string[] = []): readonly T[] =>
  all.filter(
    (s) =>
      (BROWSER_ONLY_FEATURES || !BROWSER_ONLY_SECTIONS.includes(s)) &&
      (s !== 'quotes' || quotesShown) &&
      (s !== 'reviews' || reviewsShown) &&
      (AUTH_MODE === 'firebase' || demoToo.includes(s) || !REAL_SIGN_IN_ONLY.includes(s)),
  );

/** Account sections shown in this build (navigation, routes). */
// (The bell's choices read the API, so the account section exists with real sign-in only; the admin section of the
// same name is the WhatsApp screen and stays in the demo.)
export const ACCOUNT_SECTIONS = shown(ALL_ACCOUNT_SECTIONS, ['refunds']).filter(
  (s) => (s !== 'notifications' && s !== 'privacy') || AUTH_MODE === 'firebase',
);
/** Admin sections shown in this build (navigation, routes). */
export const ADMIN_SECTIONS = shown(ALL_ADMIN_SECTIONS);
