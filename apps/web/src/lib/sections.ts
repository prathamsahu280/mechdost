/**
 * Section lists for the account area and the admin console. Kept outside the client components: server pages
 * (generateStaticParams) cannot read values exported from a 'use client' module.
 */
export const ACCOUNT_SECTIONS = [
  'overview',
  'orders',
  'services',
  'quotes',
  'coins',
  'vehicles',
  'addresses',
  'profile',
] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export const ADMIN_SECTIONS = [
  'overview',
  'orders',
  'services',
  'quotes',
  'applications',
  'partners',
  'reviews',
  'coins',
  // Site customisation (spec 08 "Content" + "Settings", hard rule 8).
  'content',
  'layout',
  'settings',
  // WhatsApp and other notification channels (spec 10, hard rule 8).
  'notifications',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
