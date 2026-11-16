import { apiLimitsFrom, type ApiLimits } from '@mechdost/shared/settings';

export type { ApiLimits };

/** Code defaults (also the registry defaults): used before the first read and whenever a read has never worked. */
export const DEFAULT_API_LIMITS: ApiLimits = apiLimitsFrom({});

/** How long the admin's numbers are reused before the settings table is read again (spec 13). */
export const API_LIMITS_TTL_MS = 45_000;

/**
 * The global API limits, read through a short in-process cache so the request path never queries the database per
 * request. Concurrent refreshes share one read; a failed read keeps the last good values (defaults if none yet) and
 * is retried at the next period rather than on every request.
 */
export class ApiLimitsProvider {
  private value: ApiLimits = DEFAULT_API_LIMITS;
  private expiresAt = 0;
  private inflight: Promise<ApiLimits> | null = null;

  constructor(
    private readonly load: () => Promise<ApiLimits>,
    private readonly ttlMs = API_LIMITS_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<ApiLimits> {
    if (this.now() < this.expiresAt) return Promise.resolve(this.value);
    this.inflight ??= this.refresh();
    return this.inflight;
  }

  private async refresh(): Promise<ApiLimits> {
    try {
      this.value = await this.load();
    } catch {
      // Keep the last good values; the next period tries again.
    } finally {
      this.expiresAt = this.now() + this.ttlMs;
      this.inflight = null;
    }
    return this.value;
  }
}
