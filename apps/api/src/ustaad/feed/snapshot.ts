/**
 * The For you snapshot (spec 23 § 9.5): the ranked list (≤ 300 post ids) is computed on the first page and kept for
 * 10 minutes; the cursor is a position in it, so scrolling never repeats or skips a post while likes and new posts
 * change the scores. Upstash Redis when configured (stateless API, several instances), else a per-instance memory
 * store (development, tests; a cursor that lands on another instance answers `USTAAD_FEED_EXPIRED` and the app
 * reloads page 1). Keys carry the member id, so a cursor never opens another member's snapshot.
 */
import { randomBytes } from 'node:crypto';
import type { FeedPage } from '@mechdost/shared/ustaad/dto/feed';
import { ustaadForYouIds, ustaadPostsByIds, type Tx } from '@mechdost/db/repo';
import { ApiError } from '../../errors';
import { log } from '../../log';
import { TtlCache } from '../../ttl-cache';
import type { RedisKv } from '../correction/cache';

export const FEED_SNAPSHOT_TTL_SECONDS = 600;

export interface FeedSnapshotStore {
  put(key: string, ids: readonly string[]): Promise<void>;
  get(key: string): Promise<string[] | null>;
}

export function memoryFeedSnapshots(maxEntries = 5_000, now: () => number = Date.now): FeedSnapshotStore {
  const cache = new TtlCache<string[]>(FEED_SNAPSHOT_TTL_SECONDS * 1000, maxEntries, now);
  return {
    put: (key, ids) => {
      cache.set(key, [...ids]);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(cache.get(key) ?? null),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const idsOf = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= 300 && v.every((x) => typeof x === 'string' && UUID.test(x)) ? v : null;

export function redisFeedSnapshots(redis: RedisKv): FeedSnapshotStore {
  return {
    async put(key, ids) {
      try {
        await redis.set(key, JSON.stringify(ids), { ex: FEED_SNAPSHOT_TTL_SECONDS });
      } catch {
        log('warn', 'ustaad_feed_snapshot_failed', { op: 'set' });
      }
    },
    async get(key) {
      try {
        const v = await redis.get(key);
        return idsOf(typeof v === 'string' ? JSON.parse(v) : v);
      } catch {
        log('warn', 'ustaad_feed_snapshot_failed', { op: 'get' });
        return null;
      }
    },
  };
}

const SNAP_RE = /^[A-Za-z0-9_-]{12}$/;
interface SnapCursor {
  s: string;
  p: number;
}

function decode(raw: string): SnapCursor {
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof v === 'object' &&
      v !== null &&
      's' in v &&
      'p' in v &&
      typeof v.s === 'string' &&
      SNAP_RE.test(v.s) &&
      typeof v.p === 'number' &&
      Number.isInteger(v.p) &&
      v.p > 0 &&
      v.p <= 300
    )
      return { s: v.s, p: v.p };
  } catch {
    // fall through
  }
  throw new ApiError(422, 'INVALID_CURSOR', 'Invalid cursor');
}

const encode = (c: SnapCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

/** One page of For you: a new snapshot on page 1, a position in it afterwards. */
export async function forYouPage(
  db: Tx,
  store: FeedSnapshotStore,
  actor: { userId: string; memberId: string },
  page: { cursor?: string | undefined; limit: number },
): Promise<FeedPage> {
  let snap: string;
  let ids: string[];
  let from = 0;
  if (page.cursor) {
    const c = decode(page.cursor);
    const stored = await store.get(`ustaad:feed:${actor.memberId}:${c.s}`);
    if (!stored)
      throw new ApiError(410, 'USTAAD_FEED_EXPIRED', 'The feed was refreshed. Pull to load it again');
    snap = c.s;
    ids = stored;
    from = c.p;
  } else {
    ids = await ustaadForYouIds(db, actor);
    snap = randomBytes(9).toString('base64url');
    await store.put(`ustaad:feed:${actor.memberId}:${snap}`, ids);
  }
  const to = from + page.limit;
  return {
    items: await ustaadPostsByIds(db, actor, ids.slice(from, to)),
    nextCursor: to < ids.length ? encode({ s: snap, p: to }) : null,
  };
}
