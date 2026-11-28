import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import {
  cityMatchKey,
  DEVICE_ACTIVE_REFRESH_MS,
  DEVICE_LIST_CAP,
  gstStateCodeOf,
  type DeviceView,
  type ParsedUserAgent,
  type SessionRevokeReason,
} from '@mechdost/shared/devices';
import { auditLog, cities, userSessions } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import type { Tx } from './orders';

/**
 * Password sign-ins as rows (spec 01 § Devices, decision 2026-11-28; table `user_sessions`, migration 0117).
 *
 * - The raw session key (256-bit CSPRNG, base64url) goes into the person's Firebase token only; the row keeps its
 *   SHA-256 hash, so a database read cannot be replayed as a session.
 * - Every function that reads or ends rows takes the signed-in `userId` and scopes by it: another person's row id is
 *   `NotFoundError` (404), never a 403.
 * - Ending a session is a conditional UPDATE guarded by `revoked_at is null` (the state), so two ends race to one
 *   winner. The row's `version` is bumped by the trigger on every update, including the hourly last-active refresh,
 *   so a client-supplied version would conflict spuriously: the state guard is the check.
 * - Never stored: the IP address and the raw User-Agent.
 */

export const hashSessionKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const newSessionKey = () => randomBytes(32).toString('base64url');

export interface SessionPlace {
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

/** Records one sign-in and returns the raw key for the token claim (shown nowhere else, stored nowhere). */
export async function startUserSession(
  db: Tx,
  input: { userId: string; device: ParsedUserAgent; place: SessionPlace | null },
): Promise<string> {
  const key = newSessionKey();
  await db.insert(userSessions).values({
    userId: input.userId,
    keyHash: hashSessionKey(key),
    deviceKind: input.device.deviceKind,
    browser: input.device.browser,
    os: input.device.os,
    countryCode: input.place?.countryCode ?? null,
    region: input.place?.region ?? null,
    city: input.place?.city ?? null,
  });
  return key;
}

/**
 * Removes a row whose key was never handed out (the token could not be minted after the row was written), so no
 * phantom device appears in the list. Not an "end": a key that reached a client is revoked, never deleted.
 */
export async function discardUnissuedSession(db: Tx, key: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.keyHash, hashSessionKey(key)));
}

export interface SessionState {
  id: string;
  userId: string;
  revoked: boolean;
  lastActiveAt: Date;
}

/** The row behind a session key (by hash), for the auth middleware's cache-miss path. */
export async function sessionStateByKey(db: Tx, key: string): Promise<SessionState | null> {
  const [row] = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      revokedAt: userSessions.revokedAt,
      lastActiveAt: userSessions.lastActiveAt,
    })
    .from(userSessions)
    .where(eq(userSessions.keyHash, hashSessionKey(key)))
    .limit(1);
  return row
    ? { id: row.id, userId: row.userId, revoked: row.revokedAt !== null, lastActiveAt: row.lastActiveAt }
    : null;
}

/**
 * Last active, at most once an hour: the conditional UPDATE only matches a live row whose last activity is older than
 * the refresh period, so concurrent requests and instances write at most once. Returns whether it wrote.
 */
export async function touchSessionActive(
  db: Tx,
  sessionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(userSessions)
    .set({ lastActiveAt: now })
    .where(
      and(
        eq(userSessions.id, sessionId),
        isNull(userSessions.revokedAt),
        lt(userSessions.lastActiveAt, new Date(now.getTime() - DEVICE_ACTIVE_REFRESH_MS)),
      ),
    )
    .returning({ id: userSessions.id });
  return rows.length > 0;
}

/** Hindi city names the platform already has (cities table), keyed by the matching key of the English name. */
async function hindiCityNames(db: Tx, names: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(names.map(cityMatchKey));
  if (wanted.size === 0) return new Map();
  const rows = await db
    .select({ name: cities.name, nameHi: cities.nameHi })
    .from(cities)
    .where(isNotNull(cities.nameHi));
  const out = new Map<string, string>();
  for (const r of rows) {
    const key = cityMatchKey(r.name);
    if (r.nameHi && wanted.has(key)) out.set(key, r.nameHi);
  }
  return out;
}

/** The person's live sign-ins, newest activity first, at most `DEVICE_LIST_CAP`; the current one is flagged. */
export async function listUserSessions(
  db: Tx,
  userId: string,
  currentSessionId: string | null,
): Promise<DeviceView[]> {
  const rows = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .orderBy(desc(userSessions.lastActiveAt), desc(userSessions.id))
    .limit(DEVICE_LIST_CAP);
  const hi = await hindiCityNames(
    db,
    rows.flatMap((r) => (r.city ? [r.city] : [])),
  );
  return rows.map((r) => ({
    id: r.id,
    deviceKind: r.deviceKind as DeviceView['deviceKind'],
    browser: r.browser as DeviceView['browser'],
    os: r.os as DeviceView['os'],
    place:
      r.region || r.city
        ? {
            region: r.region,
            gstStateCode: gstStateCodeOf(r.region),
            city: r.city,
            cityHi: r.city ? (hi.get(cityMatchKey(r.city)) ?? null) : null,
          }
        : null,
    createdAt: r.createdAt.toISOString(),
    lastActiveAt: r.lastActiveAt.toISOString(),
    current: r.id === currentSessionId,
  }));
}

/** The device making the request cannot be ended through the "other devices" path (409 CURRENT_DEVICE). */
export class CurrentDeviceError extends ConflictError {
  constructor() {
    super('This is the device you are using; use Sign out', 'CURRENT_DEVICE');
    this.name = 'CurrentDeviceError';
  }
}

async function audit(
  db: Tx,
  input: { userId: string; action: string; entity: string; entityId: string; after: unknown },
) {
  await db.insert(auditLog).values({
    actorUserId: input.userId,
    actorRole: 'user',
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    after: input.after,
  });
}

/**
 * Ends one other sign-in of the person. 404 when the id is not theirs or already ended; `CurrentDeviceError` (409)
 * when it is the device making the request. The audit row is in the same transaction.
 */
export async function revokeUserSession(
  db: Tx,
  input: { userId: string; sessionId: string; currentSessionId: string | null },
): Promise<void> {
  if (input.sessionId === input.currentSessionId) throw new CurrentDeviceError();
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: 'self_device' })
      .where(
        and(
          eq(userSessions.id, input.sessionId),
          eq(userSessions.userId, input.userId),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });
    if (rows.length === 0) throw new NotFoundError();
    await audit(tx, {
      userId: input.userId,
      action: 'auth.device_signed_out',
      entity: 'user_session',
      entityId: input.sessionId,
      after: { reason: 'self_device' },
    });
  });
}

/** Ends every live sign-in of the person except the current one (all of them when the caller has no row). */
export async function revokeOtherUserSessions(
  db: Tx,
  input: { userId: string; currentSessionId: string | null },
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: 'self_others' })
      .where(
        and(
          eq(userSessions.userId, input.userId),
          isNull(userSessions.revokedAt),
          input.currentSessionId ? ne(userSessions.id, input.currentSessionId) : undefined,
        ),
      )
      .returning({ id: userSessions.id });
    if (rows.length > 0)
      await audit(tx, {
        userId: input.userId,
        action: 'auth.devices_signed_out_others',
        entity: 'user',
        entityId: input.userId,
        after: { count: rows.length },
      });
    return rows.length;
  });
}

/** This device's normal sign-out: ends its own row (idempotent: nothing to end is fine). */
export async function revokeCurrentUserSession(
  db: Tx,
  input: { userId: string; sessionId: string },
): Promise<boolean> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: new Date(), revokedReason: 'self_device' })
    .where(
      and(
        eq(userSessions.id, input.sessionId),
        eq(userSessions.userId, input.userId),
        isNull(userSessions.revokedAt),
      ),
    )
    .returning({ id: userSessions.id });
  return rows.length > 0;
}

/**
 * Ends every live sign-in of a user for a stated reason (sign out of all devices, a removed staff role, a changed
 * password). The caller audits its own action. Returns how many ended.
 */
export async function revokeAllUserSessions(
  db: Tx,
  userId: string,
  reason: SessionRevokeReason,
): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length;
}
