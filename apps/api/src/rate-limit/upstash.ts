import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { RateLimitUnavailable, type RateLimiter, type RateResult, type RateRule } from './limiter';

/**
 * Sliding-window limits shared by all instances. If Redis is slow or down, Upstash allows the request after
 * `timeout` (fail-open) so an outage does not take the API down; Cloudflare WAF remains the outer layer.
 * Rules marked `failClosed` (password sign-in, Q18) throw `RateLimitUnavailable` instead.
 */
export class UpstashRateLimiter implements RateLimiter {
  private readonly redis: Redis;
  private readonly limiters = new Map<string, Ratelimit>();

  constructor(opts: { url: string; token: string }) {
    this.redis = new Redis({ url: opts.url, token: opts.token });
  }

  private limiterFor(rule: RateRule): Ratelimit {
    const id = `${rule.name}:${rule.limit}:${rule.windowSeconds}`;
    let rl = this.limiters.get(id);
    if (!rl) {
      rl = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
        prefix: `rl:${rule.name}`,
        timeout: 1000,
        analytics: false,
      });
      this.limiters.set(id, rl);
    }
    return rl;
  }

  async hit(rule: RateRule, key: string, weight = 1): Promise<RateResult> {
    const rate = Math.max(1, Math.floor(weight));
    const r = await this.limiterFor(rule).limit(key, rate === 1 ? undefined : { rate });
    if (rule.failClosed && r.reason === 'timeout') throw new RateLimitUnavailable();
    return { allowed: r.success, limit: r.limit, remaining: r.remaining, resetAt: r.reset };
  }

  async reset(rule: RateRule, key: string): Promise<void> {
    try {
      await this.limiterFor(rule).resetUsedTokens(key);
    } catch (err) {
      if (rule.failClosed) throw new RateLimitUnavailable();
      throw err;
    }
  }
}
