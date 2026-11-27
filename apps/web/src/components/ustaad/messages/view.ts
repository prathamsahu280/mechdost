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
  'NO_VOICE',
  'NO_PHOTO',
] as const;

export function dmErrorKey(code: string): string {
  if (code === 'HTTP_429') return 'err_RATE_LIMITED';
  return oneOf(DM_ERROR_CODES, code) ? `err_${code}` : 'err_generic';
}

/** The IST calendar day of a timestamp as `YYYY-MM-DD` (day separators and "Today" follow India, not the device). */
const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const istDayKey = (iso: string): string => IST_DAY.format(new Date(iso));

/** Oldest-first messages cut into IST days, order kept. */
export function groupByDay<T extends { createdAt: string }>(
  items: readonly T[],
): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = istDayKey(item.createdAt);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}

/** "today" / "yesterday" for the separator, or null (the screen then writes the date). */
export function dayWord(day: string, nowIso: string): 'today' | 'yesterday' | null {
  if (day === istDayKey(nowIso)) return 'today';
  const before = istDayKey(new Date(new Date(nowIso).getTime() - 86_400_000).toISOString());
  return day === before ? 'yesterday' : null;
}

/** A conversation nobody can write in: declined or blocked (read from the status the API already gives). */
export const isClosedThread = (t: { status: string; mine: boolean }): boolean => composerMode(t) === 'closed';

/** `m:ss` of a duration in milliseconds. */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export type MessagePreview =
  | { kind: 'text'; text: string; mine: boolean }
  | { kind: 'voice' | 'photo' | 'post_share'; clock: string | null; mine: boolean };

/** What an inbox row says about the last message: its words, or the kind of thing it is (voice note with length). */
export function previewOf(
  last: { kind: string; text: string | null; durationMs: number | null; mine: boolean } | null | undefined,
): MessagePreview | null {
  if (!last) return null;
  if (last.kind === 'text') return last.text ? { kind: 'text', text: last.text, mine: last.mine } : null;
  if (last.kind === 'voice' || last.kind === 'photo' || last.kind === 'post_share')
    return {
      kind: last.kind,
      clock: last.kind === 'voice' && last.durationMs !== null ? clockOf(last.durationMs) : null,
      mine: last.mine,
    };
  return null;
}

/** How many messages from the other member arrived since `known` (null on first load: nothing to announce). */
export function countIncoming(
  known: ReadonlySet<string> | null,
  messages: readonly { id: string; mine: boolean }[],
): number {
  if (known === null) return 0;
  return messages.filter((m) => !m.mine && !known.has(m.id)).length;
}
