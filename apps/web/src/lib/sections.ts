import { AUTH_MODE } from './auth/mode';
import { BROWSER_ONLY_FEATURES } from './data-mode';

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
  // Latest Sentry issues of the website and the API (decision 2026-11-14); real sign-in only (it reads the API).
  'errors',
] as const;
export type AdminSection = (typeof ALL_ADMIN_SECTIONS)[number];

/** Sections for features that have no API yet (`BROWSER_ONLY_FEATURES`): hidden in real mode. */
const BROWSER_ONLY_SECTIONS: readonly string[] = ['quotes', 'coins'];
/**
 * Review moderation (2026-11-14): the demo queue in the browser demo, the API queue with real sign-in; hidden only
 * in the mixed build (real data, demo sign-in), where neither queue would show the reviews customers see.
 */
const reviewsShown = BROWSER_ONLY_FEATURES || AUTH_MODE === 'firebase';
const shown = <T extends string>(all: readonly T[]): readonly T[] =>
  all.filter(
    (s) => (BROWSER_ONLY_FEATURES || !BROWSER_ONLY_SECTIONS.includes(s)) && (s !== 'reviews' || reviewsShown),
  );

/** Account sections shown in this build (navigation, routes). */
export const ACCOUNT_SECTIONS = shown(ALL_ACCOUNT_SECTIONS);
/** Admin sections that read live API data only: not in demo sign-in builds. */
const REAL_SIGN_IN_ONLY: readonly string[] = ['errors'];
/** Admin sections shown in this build (navigation, routes). */
export const ADMIN_SECTIONS = shown(ALL_ADMIN_SECTIONS).filter(
  (s) => AUTH_MODE === 'firebase' || !REAL_SIGN_IN_ONLY.includes(s),
);
