import { log } from '../logger';
import { RateLimitUnavailable, type RateLimiter, type RateResult, type RateRule } from './limiter';

/**
 * The part of the Upstash REST client this limiter uses: a MULTI/EXEC transaction and DEL. Works against Upstash and
 * against the server's own Redis behind Serverless Redis HTTP (decision 2026-11-24).
 */
export interface RedisTx {
  incrby(key: string, n: number): RedisTx;
  pexpire(key: string, ms: number): RedisTx;
  get(key: string): RedisTx;
  exec(): Promise<unknown[]>;
}
export interface RedisLike {
  multi(): RedisTx;
  del(...keys: string[]): Promise<number>;
}

/**
 * Sliding-window limits shared by every API instance, with plain commands any Redis runs (the Upstash library's Lua
 * scripts carry an Upstash-only flag, `allow-key-locking`, that Redis 7/8 and Valkey refuse).
 *
 * Two fixed windows per key: the current one counts every hit (INCRBY), the previous one is weighed by how much of it
 * still overlaps the last `windowSeconds`, so there is no double burst at a window boundary. Both keys expire after
 * two windows. The INCRBY, PEXPIRE and GET run in one MULTI/EXEC, so concurrent hits never lose a count.
 *
 * Store failure (outage 2026-11-24: an exhausted Upstash plan made every API route answer 500): ordinary rules allow
 * the request and log `rate_limit_store_failed`, so browsing keeps working; rules marked `failClosed` (password
 * sign-in, codes, payments, resets) throw `RateLimitUnavailable` and the route refuses with 503.
 */
export class RedisRestRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: RedisLike,
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string, detail?: Record<string, unknown>) => void = (
      message,
      detail,
    ) => {
      log('warn', message, detail);
    },
  ) {}

  async hit(rule: RateRule, key: string, weight = 1): Promise<RateResult> {
    const rate = Math.max(1, Math.floor(weight));
    const windowMs = rule.windowSeconds * 1000;
    const t = this.now();
    const index = Math.floor(t / windowMs);
    const current = `rl:${rule.name}:${key}:${String(index)}`;
    const previous = `rl:${rule.name}:${key}:${String(index - 1)}`;
    const resetAt = (index + 1) * windowMs;
    let replies: unknown[];
    try {
      replies = await this.redis
        .multi()
        .incrby(current, rate)
        .pexpire(current, windowMs * 2)
        .get(previous)
        .exec();
    } catch (err) {
      if (rule.failClosed) throw new RateLimitUnavailable();
      this.warn('rate_limit_store_failed', {
        rule: rule.name,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt };
    }
    const now = Number(replies[0]) || 0;
    const before = Number(replies[2]) || 0;
    const overlap = (windowMs - (t - index * windowMs)) / windowMs;
    const used = before * overlap + now;
    return {
      allowed: used <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, Math.floor(rule.limit - used)),
      resetAt,
    };
  }

  async reset(rule: RateRule, key: string): Promise<void> {
    const index = Math.floor(this.now() / (rule.windowSeconds * 1000));
    try {
      await this.redis.del(
        `rl:${rule.name}:${key}:${String(index)}`,
        `rl:${rule.name}:${key}:${String(index - 1)}`,
      );
    } catch (err) {
      if (rule.failClosed) throw new RateLimitUnavailable();
      this.warn('rate_limit_store_failed', {
        rule: rule.name,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }
}
