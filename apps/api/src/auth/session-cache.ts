import type { UserRecord } from '@mechdost/db/repo';
import type { CustomerBlockLevel } from '@mechdost/shared/customers';
import type { Grant } from '@mechdost/shared/rbac';

interface Entry {
  value: { user: UserRecord; grants: Grant[]; blocks: CustomerBlockLevel[]; sessionId: string | null };
  expiresAt: number;
}

/**
 * Per-instance cache of the resolved user + grants, keyed by the token's identity facts, so a signed-in
 * user costs zero DB queries per request for `ttlMs` (spec 13: "cache 60 s"). The key includes the sign-in time,
 * so every new sign-in loads fresh; within one sign-in, role changes and
 * deactivations therefore apply within `ttlMs` on every instance; sensitive routes also check revocation.
 * Holds no state that must be shared (rule 7) — losing it only costs a query.
 */
export class SessionCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly maxEntries = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string) {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: Entry['value']) {
    if (this.entries.size >= this.maxEntries) {
      // Maps iterate in insertion order: evict the oldest tenth.
      for (const k of [...this.entries.keys()].slice(0, Math.ceil(this.maxEntries / 10)))
        this.entries.delete(k);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Drop every entry for a user (after a role change or profile update on this instance). */
  invalidateUser(userId: string) {
    for (const [k, e] of this.entries) if (e.value.user.id === userId) this.entries.delete(k);
  }
}
