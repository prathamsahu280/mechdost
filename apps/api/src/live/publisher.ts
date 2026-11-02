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

export interface LivePublisher {
  readonly name: 'polling' | 'rtdb';
  publish(batch: readonly LiveDelivery[]): Promise<void>;
  /** Deletes everything waiting for these people (they lost access). Idempotent. */
  forget(firebaseUids: readonly string[]): Promise<void>;
}

export const pollingPublisher: LivePublisher = {
  name: 'polling',
  publish: () => Promise.resolve(),
  forget: () => Promise.resolve(),
};

/** RTDB keys may not contain `. # $ [ ] /`; uuids and kind codes never do, but refuse anything else. */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;

/** Multi-path update that removes whole inboxes (only well-formed uids; never a path outside `inbox/`). */
export function inboxRemovals(firebaseUids: readonly string[]): Record<string, null> {
  return Object.fromEntries(
    firebaseUids.filter((uid) => SAFE_KEY.test(uid)).map((uid) => [`inbox/${uid}`, null]),
  );
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
