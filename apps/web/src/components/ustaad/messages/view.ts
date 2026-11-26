import { USTAAD_LEVELS, USTAAD_SPECIALITY_CODES } from '@mechdost/shared/ustaad/codes';

/**
 * Pure view rules for the Ustaad messages, My network and Discover screens (spec 23 § 4 flows 7–8, § 5; D2 web).
 * No React here, so the unit suite (`test/ustaad-dm-view.test.ts`) checks them directly.
 */

export const THREAD_BOXES = ['inbox', 'requests', 'sent'] as const;
export type ThreadBox = (typeof THREAD_BOXES)[number];

export const NETWORK_TABS = ['followers', 'following', 'connections', 'requests', 'blocked'] as const;
export type NetworkTab = (typeof NETWORK_TABS)[number];

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

export const parseThreadBox = (v: string | undefined): ThreadBox => (oneOf(THREAD_BOXES, v) ? v : 'inbox');
export const parseNetworkTab = (v: string | undefined): NetworkTab =>
  oneOf(NETWORK_TABS, v) ? v : 'followers';

/** The tick on my message: held for a check, seen by the other member, or sent. Their messages carry none. */
export function tickState(m: {
  mine: boolean;
  pending: boolean;
  read: boolean;
}): 'pending' | 'seen' | 'sent' | null {
  if (!m.mine) return null;
  if (m.pending) return 'pending';
  return m.read ? 'seen' : 'sent';
}

/** The API answers newest first; a chat reads oldest first (newest at the bottom, like WhatsApp). */
export const chronological = <T>(items: readonly T[]): T[] => [...items].reverse();

/** One or two letters for the avatar (no photo request per row). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Handles are lower-case Latin letters, digits and `_` (the join flow makes them, spec 23 § 21b). */
const HANDLE_RE = /^[a-z0-9_]{2,40}$/;
export function normaliseHandle(raw: string | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
}

/** The Discover search matches parts of names and handles; only the exact handle may open a conversation. */
export function pickExactHandle<T extends { handle: string }>(items: readonly T[], handle: string): T | null {
  return items.find((i) => i.handle.toLowerCase() === handle) ?? null;
}

export type ComposerMode = 'open' | 'waiting' | 'decide' | 'closed';
/** Request-only messages (SR-33): before the receiver accepts, the sender waits and the receiver decides. */
export function composerMode(t: { status: string; mine: boolean }): ComposerMode {
  if (t.status === 'open') return 'open';
  if (t.status === 'requested') return t.mine ? 'waiting' : 'decide';
  return 'closed';
}

export interface DiscoverFilters {
  q: string | null;
  work: (typeof USTAAD_SPECIALITY_CODES)[number] | null;
  level: (typeof USTAAD_LEVELS)[number] | null;
}
/** The filters the API serves (`q` 2–60 characters, `work`, `level`); the `area=` filter is not served (§ 21d). */
export function parseDiscoverFilters(sp: { q?: string; work?: string; level?: string }): DiscoverFilters {
  const q = sp.q?.trim() ?? '';
  return {
    q: q.length >= 2 && q.length <= 60 ? q : null,
    work: oneOf(USTAAD_SPECIALITY_CODES, sp.work) ? sp.work : null,
    level: oneOf(USTAAD_LEVELS, sp.level) ? sp.level : null,
  };
}

/** API codes these screens put into words (`ustaad.messages.err_*`, en + hi; the unit suite checks both). */
export const DM_ERROR_CODES = [
  'USTAAD_DM_TOO_NEW',
  'USTAAD_DM_NOT_ALLOWED',
  'USTAAD_DM_PENDING',
  'USTAAD_DM_LINK',
  'USTAAD_CONTENT_BLOCKED',
  'USTAAD_DAILY_CAP',
  'USTAAD_CONNECT_COOLDOWN',
  'USTAAD_RESTRICTED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'NETWORK',
  'HANDLE_NOT_FOUND',
] as const;

export function dmErrorKey(code: string): string {
  if (code === 'HTTP_429') return 'err_RATE_LIMITED';
  return oneOf(DM_ERROR_CODES, code) ? `err_${code}` : 'err_generic';
}
