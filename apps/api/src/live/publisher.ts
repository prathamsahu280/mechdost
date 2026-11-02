import type { LivePing } from '@mechdost/shared/live';

/**
 * Live transport seam (decision 2026-11-01, docs/research/realtime-alternatives.md §8). The relay hands each
 * implementation thin pings already addressed to recipients resolved from Postgres; implementations never
 * decide who sees what. Selected by `LIVE_TRANSPORT`:
 * - `polling`: no push at all; clients poll the API with ETag (the always-on fallback and cost floor).
 * - `rtdb`: Firebase Realtime Database per-user inbox `/inbox/{firebaseUid}/{kind}~{id}`.
 * Later options (own SSE, Supabase broadcast, Ably) implement the same interface.
 */
export interface LiveDelivery {
  /** Firebase uids of the people allowed to see this entity. */
  recipients: readonly string[];
  ping: LivePing;
}

export interface ForgetTarget {
  firebaseUid: string;
  /** Null = the whole inbox; otherwise `order~{uuid}` / `assignment~{uuid}`. */
  node: string | null;
}

export interface LivePublisher {
  readonly name: 'polling' | 'rtdb';
  publish(batch: readonly LiveDelivery[]): Promise<void>;
  /** Deletes what is waiting for people who lost access: a whole inbox, or one node of it. Idempotent. */
  forget(targets: readonly ForgetTarget[]): Promise<void>;
}

export const pollingPublisher: LivePublisher = {
  name: 'polling',
  publish: () => Promise.resolve(),
  forget: () => Promise.resolve(),
};

/** RTDB keys may not contain `. # $ [ ] /`; uuids and kind codes never do, but refuse anything else. */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;

const NODE = /^(order|assignment)~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Multi-path update that removes inboxes or single nodes; never a path outside `inbox/{uid}`. */
export function inboxRemovals(targets: readonly ForgetTarget[]): Record<string, null> {
  const out: Record<string, null> = {};
  for (const { firebaseUid, node } of targets) {
    if (!SAFE_KEY.test(firebaseUid)) continue;
    if (node === null) out[`inbox/${firebaseUid}`] = null;
    else if (NODE.test(node)) out[`inbox/${firebaseUid}/${node}`] = null;
  }
  return out;
}

/**
 * Builds one multi-path update for the whole batch. Each entity has one node per recipient that is overwritten
 * with the latest ping (the inbox stays bounded per entity); the newest version wins within a batch.
 */
export function inboxUpdates(batch: readonly LiveDelivery[]): Record<string, LivePing> {
  const updates: Record<string, LivePing> = {};
  for (const { recipients, ping } of batch) {
    for (const uid of recipients) {
      if (!SAFE_KEY.test(uid)) continue;
      const path = `inbox/${uid}/${ping.k}~${ping.id}`;
      const existing = updates[path];
      if (!existing || existing.v < ping.v) updates[path] = ping;
    }
  }
  return updates;
}
