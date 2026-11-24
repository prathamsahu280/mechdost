import { log } from '../logger';

/**
 * In-process LRU cache for public, immutable photo bytes (decision 2026-11-24). It only saves Supabase Storage
 * egress: the route still checks the database (approved? exists?) on every request, so a cache hit can never show
 * a photo that is no longer public. Bounded by total bytes; nothing is stored for private photos or errors (the
 * caller decides what goes in); any internal failure is swallowed and the caller falls back to Storage.
 */
export interface PhotoByteCache {
  get(id: string, width: number): Buffer | null;
  set(id: string, width: number, bytes: Buffer): void;
  /** Drops every width of one photo (it was removed or replaced). */
  evict(id: string): void;
  stats(): { entries: number; bytes: number; hits: number; misses: number };
}

/** One summary log line per this many lookups (hits and misses), so the log stays small. */
const LOG_EVERY = 500;

export function createPhotoByteCache(maxBytes: number): PhotoByteCache {
  // Map keeps insertion order: the first key is the least recently used (a hit re-inserts its key).
  const entries = new Map<string, Buffer>();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  const key = (id: string, width: number) => `${id}:${String(width)}`;
  const note = () => {
    if ((hits + misses) % LOG_EVERY === 0) {
      log('info', 'photo_cache', { hits, misses, entries: entries.size, bytes, maxBytes });
    }
  };
  const drop = (k: string) => {
    const old = entries.get(k);
    if (old) {
      bytes -= old.length;
      entries.delete(k);
    }
  };

  return {
    get(id, width) {
      try {
        const k = key(id, width);
        const found = entries.get(k);
        if (!found) {
          misses += 1;
          note();
          return null;
        }
        entries.delete(k);
        entries.set(k, found);
        hits += 1;
        note();
        return found;
      } catch {
        return null;
      }
    },
    set(id, width, value) {
      try {
        // A single picture bigger than a quarter of the budget is not worth evicting everything for.
        if (maxBytes <= 0 || value.length === 0 || value.length > maxBytes / 4) return;
        const k = key(id, width);
        drop(k);
        entries.set(k, value);
        bytes += value.length;
        while (bytes > maxBytes) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          drop(oldest.value);
        }
      } catch {
        // Caching never breaks a response.
      }
    },
    evict(id) {
      try {
        for (const k of [...entries.keys()]) if (k.startsWith(`${id}:`)) drop(k);
      } catch {
        // Nothing to do: the database check already hides a removed photo.
      }
    },
    stats: () => ({ entries: entries.size, bytes, hits, misses }),
  };
}
