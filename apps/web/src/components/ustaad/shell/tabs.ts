import { stripLocale } from '@/lib/locale-path';

/**
 * The network's five bottom tabs (founder Q-UI-1, 2026-11-27: Home · Ask · + Create · Jobs · Me; Discover and Learn
 * live in the Home "More" sheet, the Me shortcuts and the rail). `match` lists the canonical path prefixes that make a
 * tab current: an Ask question page (`/ustaad/q/…`) belongs to Ask. Pure, so the server layout and tests share it.
 */
export type UstaadTabKey = 'home' | 'ask' | 'create' | 'jobs' | 'me';

export const USTAAD_TABS: readonly { key: UstaadTabKey; path: string; match: readonly string[] }[] = [
  { key: 'home', path: '/ustaad', match: [] },
  { key: 'ask', path: '/ustaad/ask', match: ['/ustaad/ask', '/ustaad/q'] },
  { key: 'create', path: '/ustaad/create', match: ['/ustaad/create'] },
  { key: 'jobs', path: '/ustaad/jobs', match: ['/ustaad/jobs'] },
  { key: 'me', path: '/ustaad/me', match: ['/ustaad/me'] },
];

const under = (here: string, prefix: string) => here === prefix || here.startsWith(`${prefix}/`);

/** The one current tab for a pathname in either language, or null (Discover, Learn, Messages … have none). */
export function ustaadTabFor(pathname: string): UstaadTabKey | null {
  const here = stripLocale(pathname);
  if (here === '/ustaad') return 'home';
  for (const tab of USTAAD_TABS) if (tab.match.some((m) => under(here, m))) return tab.key;
  return null;
}

/** A conversation page (`/ustaad/messages/<id>`) has its own sticky composer: the dock steps aside there. */
export const hidesDock = (pathname: string): boolean =>
  /^\/ustaad\/messages\/[^/]+/.test(stripLocale(pathname));
