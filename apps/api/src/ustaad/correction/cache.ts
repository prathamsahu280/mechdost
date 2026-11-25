import { createHash } from 'node:crypto';
import { log } from '../../logger';
import { TtlCache } from '../../ttl-cache';
import { CORRECTION_PROMPT_VERSION } from './prompt';

/**
 * Smart-correction cache (spec 23 § 11): LLM results only, keyed by sha256(engine id, model, prompt version,
 * protected-list version, lang, masked text), kept 7 days. Both key and value are the **masked** forms, so no phone
 * number, plate or e-mail ever sits in Redis; a hit is restored and guarded again like a fresh reply. Redis (shared by
 * every API instance) when configured, else a bounded in-process cache. A store failure is a miss, never an error.
 */
export const CORRECTION_CACHE_TTL_SECONDS = 7 * 24 * 3600;

export interface CorrectionCache {
  get(key: string): Promise<string | null>;
  set(key: string, maskedOutput: string): Promise<void>;
}

export function correctionCacheKey(parts: {
  engine: string;
  model: string;
  protectedVersion: string;
  lang: string | null;
  maskedText: string;
}): string {
  const h = createHash('sha256')
    .update(
      JSON.stringify([
        parts.engine,
        parts.model,
        CORRECTION_PROMPT_VERSION,
        parts.protectedVersion,
        parts.lang ?? '',
        parts.maskedText,
      ]),
    )
    .digest('hex');
  return `ustaad:sc:${h}`;
}

export function memoryCorrectionCache(maxEntries = 5_000, now: () => number = Date.now): CorrectionCache {
  const cache = new TtlCache<string>(CORRECTION_CACHE_TTL_SECONDS * 1000, maxEntries, now);
  return {
    get: (key) => Promise.resolve(cache.get(key) ?? null),
    set: (key, value) => {
      cache.set(key, value);
      return Promise.resolve();
    },
  };
}

/** The part of the Upstash REST client the cache uses. */
export interface RedisKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>;
}

export function redisCorrectionCache(redis: RedisKv): CorrectionCache {
  return {
    async get(key) {
      try {
        // Stored as JSON `{ text }`: the Upstash client parses JSON values on read, a bare string could come back as
        // a number. Accept both the parsed object and the raw string.
        const v = await redis.get(key);
        const obj: unknown = typeof v === 'string' ? JSON.parse(v) : v;
        return typeof obj === 'object' && obj !== null && 'text' in obj && typeof obj.text === 'string'
          ? obj.text
          : null;
      } catch {
        log('warn', 'correction_cache_failed', { op: 'get' });
        return null;
      }
    },
    async set(key, value) {
      try {
        await redis.set(key, JSON.stringify({ text: value }), { ex: CORRECTION_CACHE_TTL_SECONDS });
      } catch {
        log('warn', 'correction_cache_failed', { op: 'set' });
      }
    },
  };
}
