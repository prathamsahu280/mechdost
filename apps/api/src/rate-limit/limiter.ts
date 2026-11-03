/**
 * Rate limiting (docs/specs/13 "Abuse protection"). Production uses Upstash Redis so limits hold across
 * every API instance; the in-memory limiter is for development and tests only (config refuses it in prod).
 */
export interface RateRule {
  /** Rule name, part of the key (e.g. `api_ip`, `otp_phone`). */
  name: string;
  limit: number;
  windowSeconds: number;
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

  private sweep(t: number) {
    for (const [id, w] of this.windows) if (w.resetAt <= t) this.windows.delete(id);
    // Still full (an attack with unique keys): drop the oldest entries rather than grow without bound.
    const excess = this.windows.size - Math.floor(this.maxKeys * 0.9);
    if (excess > 0) for (const id of [...this.windows.keys()].slice(0, excess)) this.windows.delete(id);
  }
}
