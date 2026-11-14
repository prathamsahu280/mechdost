/**
 * A small per-instance cache with a time to live and a size cap (oldest entry evicted first). An accelerator only
 * (rule 7: the API stays stateless): a miss recomputes from Postgres, and each instance warms its own copy.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** Store `value` and return it (so a miss can be filled in one expression). */
  set(key: string, value: T): T {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    return value;
  }
}
