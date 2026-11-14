/**
 * Per-item back-off for worker sweeps (review 2026-11-14): an item that keeps failing (a quote the expiry sweep
 * cannot close) is skipped for a delay that doubles on every failure up to `maxMs`, instead of being retried — and
 * logged — on every tick. In memory per worker process; bounded so a burst of failures cannot grow it forever.
 */
export class FailureBackoff {
  private readonly entries = new Map<string, { failures: number; until: number }>();
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly maxEntries: number;

  constructor(opts: { baseMs: number; maxMs: number; maxEntries?: number }) {
    this.baseMs = opts.baseMs;
    this.maxMs = opts.maxMs;
    this.maxEntries = opts.maxEntries ?? 1000;
  }

  /** Record a failure at `now`; returns the delay before the item is tried again. */
  fail(id: string, now: number): number {
    const failures = (this.entries.get(id)?.failures ?? 0) + 1;
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** Math.min(failures - 1, 30));
    this.entries.delete(id);
    this.entries.set(id, { failures, until: now + delay });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return delay;
  }

  succeed(id: string): void {
    this.entries.delete(id);
  }

  /** Items still waiting out their delay at `now`. */
  skipped(now: number): Set<string> {
    return new Set([...this.entries].filter(([, e]) => e.until > now).map(([id]) => id));
  }

  get size(): number {
    return this.entries.size;
  }
}
