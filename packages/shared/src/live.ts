/**
 * Live updates contract (decision 2026-11-01, docs/research/realtime-alternatives.md): a change in Postgres
 * produces a **thin ping** — "this thing changed, it is now at version v" — never the data itself. Clients drop
 * stale or duplicate pings with the version gate and refetch through the API, which checks permissions on every
 * read. The same ping shape travels over every transport (Firebase RTDB inbox, polling, demo storage events, SSE
 * later), so transports can be swapped without touching UI or SQL.
 *
 * Pings carry opaque ids only (no names, phones, amounts or addresses): hard rule 16 and spec 13.
 */

/** What changed. The client maps each kind to the queries it must refetch. */
export const LIVE_KINDS = [
  'order',
  'assignment',
  'shop',
  'workshop',
  'request',
  'quote',
  'coins',
  // Saved cart and wishlist (design 2026-11-15): a hint to re-read it on the customer's other devices.
  'cart',
  'wishlist',
] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/** Event codes (`noun.verb`), one catalogue for analytics and live pings alike. */
export const LIVE_EVENTS = [
  'order.status_changed',
  'assignment.changed',
  'partner.status_changed',
  'request.status_changed',
  'quote.changed',
  'coins.changed',
  'cart.changed',
  'wishlist.changed',
] as const;
export type LiveEvent = (typeof LIVE_EVENTS)[number];

/** Who a ping concerns. The relay turns a topic into recipients from Postgres; clients never pick topics. */
export const LIVE_TOPIC_KINDS = ['order', 'shop', 'workshop', 'user', 'staff_city', 'quote'] as const;
export type LiveTopicKind = (typeof LIVE_TOPIC_KINDS)[number];
export type LiveTopic = `${LiveTopicKind}:${string}`;

export interface LivePing {
  /** Event code. */
  e: LiveEvent;
  /** Entity kind. */
  k: LiveKind;
  /** Entity id (uuid). */
  id: string;
  /** Entity version after the change (monotonic per entity). */
  v: number;
  /** Commit time, ISO-8601 UTC. */
  at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KIND_SET: ReadonlySet<string> = new Set(LIVE_KINDS);
const EVENT_SET: ReadonlySet<string> = new Set(LIVE_EVENTS);
const TOPIC_SET: ReadonlySet<string> = new Set(LIVE_TOPIC_KINDS);
const PING_KEYS = ['at', 'e', 'id', 'k', 'v'];

export function liveTopic(kind: LiveTopicKind, id: string): LiveTopic {
  if (!UUID.test(id)) throw new Error(`live topic id must be a uuid: ${kind}`);
  return `${kind}:${id}`;
}

export function parseLiveTopic(topic: string): { kind: LiveTopicKind; id: string } | null {
  const i = topic.indexOf(':');
  if (i < 1) return null;
  const kind = topic.slice(0, i);
  const id = topic.slice(i + 1);
  if (!TOPIC_SET.has(kind) || !UUID.test(id)) return null;
  return { kind: kind as LiveTopicKind, id };
}

/**
 * Validates a ping from any transport. Exactly the five keys, known codes, a uuid, a positive integer version
 * and a parseable timestamp; anything else is dropped (a transport must never smuggle data to the client).
 */
export function parseLivePing(value: unknown): LivePing | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== PING_KEYS.length || keys.some((k, i) => k !== PING_KEYS[i])) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.e !== 'string' || !EVENT_SET.has(p.e)) return null;
  if (typeof p.k !== 'string' || !KIND_SET.has(p.k)) return null;
  if (typeof p.id !== 'string' || !UUID.test(p.id)) return null;
  if (typeof p.v !== 'number' || !Number.isSafeInteger(p.v) || p.v < 1) return null;
  if (typeof p.at !== 'string' || Number.isNaN(Date.parse(p.at))) return null;
  return { e: p.e as LiveEvent, k: p.k as LiveKind, id: p.id, v: p.v, at: p.at };
}

/**
 * Version gate: at-least-once delivery means duplicates and out-of-order pings are normal. Returns the pings
 * that are news (newer than what the client has seen), updating `seen` in place.
 */
export function newPings(seen: Map<string, number>, pings: readonly LivePing[]): LivePing[] {
  const fresh: LivePing[] = [];
  for (const ping of pings) {
    const key = `${ping.k}:${ping.id}`;
    const last = seen.get(key) ?? 0;
    if (ping.v <= last) continue;
    seen.set(key, ping.v);
    fresh.push(ping);
  }
  return fresh;
}

/**
 * Polling fallback cadence (research/realtime.md §6): 15 s while things are changing, backing off to 30 s and
 * 60 s while nothing changes; hidden tabs do not poll at all (the caller checks `document.visibilityState`).
 */
export const POLL_STEPS_MS = [15_000, 30_000, 60_000] as const;

export function nextPollDelay(unchangedPolls: number): number {
  const step = Math.min(Math.max(0, Math.floor(unchangedPolls / 2)), POLL_STEPS_MS.length - 1);
  return POLL_STEPS_MS[step] ?? POLL_STEPS_MS[0];
}
