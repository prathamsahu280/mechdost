import type { AdminSection } from './sections';

/**
 * Admin side bar groups (design 2026-11-24): the 23 sections under five headings so the bar can be scanned. Pure data,
 * kept outside the client component so a unit test can check that every section is placed exactly once. The heading
 * texts are `portal.navGroup_<id>` in the locale files; the first group has no heading (the home screens).
 */
export type AdminNavGroupId = 'home' | 'operations' | 'catalogue' | 'people' | 'content' | 'system';

export interface AdminNavGroup {
  readonly id: AdminNavGroupId;
  /** The heading text key (`portal.navGroup_<heading>`); the first group sits above the headings, with none. */
  readonly heading: Exclude<AdminNavGroupId, 'home'> | null;
  readonly sections: readonly AdminSection[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  { id: 'home', heading: null, sections: ['overview', 'analytics'] },
  {
    id: 'operations',
    heading: 'operations',
    sections: ['orders', 'refunds', 'services', 'roadside', 'quotes', 'support'],
  },
  { id: 'catalogue', heading: 'catalogue', sections: ['catalogue', 'coupons', 'coins', 'reviews'] },
  { id: 'people', heading: 'people', sections: ['customers', 'partners', 'applications', 'staff'] },
  { id: 'content', heading: 'content', sections: ['content', 'layout', 'notifications'] },
  { id: 'system', heading: 'system', sections: ['settings', 'audit', 'exports', 'errors'] },
];

/** The groups with only the sections this build shows; a group with none left is dropped. */
export function groupAdminSections(shown: readonly AdminSection[]): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter((s) => shown.includes(s)),
  })).filter((g) => g.sections.length > 0);
}
