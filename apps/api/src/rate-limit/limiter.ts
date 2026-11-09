/**
 * Rate limiting (docs/specs/13 "Abuse protection"). Production uses Upstash Redis so limits hold across
 * every API instance; the in-memory limiter is for development and tests only (config refuses it in prod).
 */
export interface RateRule {
  /** Rule name, part of the key (e.g. `api_ip`, `otp_phone`). */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Refuse (throw) instead of allowing when the store cannot answer — sign-in limits (Q18). */
  failClosed?: boolean;
}

/** The limit store did not answer for a `failClosed` rule. */
export class RateLimitUnavailable extends Error {
  constructor() {
    super('rate limit store unavailable');
    this.name = 'RateLimitUnavailable';
  }
}

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds when the window resets. */
  resetAt: number;
}

export interface RateLimiter {
  /** Count `weight` units (default 1) against `rule` for `key`, e.g. the number of events in a batch. */
  hit(rule: RateRule, key: string, weight?: number): Promise<RateResult>;
  /** Read the state of `key` without counting (e.g. "is this sign-in locked?"); `allowed` = units left. */
  peek(rule: RateRule, key: string): Promise<RateResult>;
}

/** Fixed-window counter in process memory. Bounded: expired windows are swept as keys are touched. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  hit(rule: RateRule, key: string, weight = 1): Promise<RateResult> {
    const id = `${rule.name}:${key}`;
    const t = this.now();
    let w = this.windows.get(id);
    if (!w || w.resetAt <= t) {
      if (this.windows.size >= this.maxKeys) this.sweep(t);
      w = { count: 0, resetAt: t + rule.windowSeconds * 1000 };
      this.windows.set(id, w);
    }
    w.count += Math.max(1, Math.floor(weight));
    return Promise.resolve({
      allowed: w.count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - w.count),
      resetAt: w.resetAt,
    });
  }

  peek(rule: RateRule, key: string): Promise<RateResult> {
    const t = this.now();
    const w = this.windows.get(`${rule.name}:${key}`);
    const live = w && w.resetAt > t ? w : { count: 0, resetAt: t + rule.windowSeconds * 1000 };
    return Promise.resolve({
      allowed: live.count < rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - live.count),
      resetAt: live.resetAt,
    });
  }

  private sweep(t: number) {
    for (const [id, w] of this.windows) if (w.resetAt <= t) this.windows.delete(id);
    // Still full (an attack with unique keys): drop the oldest entries rather than grow without bound.
    const excess = this.windows.size - Math.floor(this.maxKeys * 0.9);
    if (excess > 0) for (const id of [...this.windows.keys()].slice(0, excess)) this.windows.delete(id);
  }
}
