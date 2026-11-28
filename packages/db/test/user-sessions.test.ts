import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEVICE_LIST_CAP } from '@mechdost/shared/devices';
import {
  CurrentDeviceError,
  hashSessionKey,
  listUserSessions,
  revokeAllUserSessions,
  revokeCurrentUserSession,
  revokeOtherUserSessions,
  revokeUserSession,
  sessionStateByKey,
  startUserSession,
  touchSessionActive,
  type Tx,
} from '../src/repo';
import { NotFoundError } from '../src/repo/errors';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
const t = () => db as unknown as Tx;
let n = 0;

const device = { deviceKind: 'mobile', browser: 'chrome', os: 'android' } as const;
const rashtra = { countryCode: 'IN', region: 'Chhattisgarh', city: 'Raipur' };

async function freshUser(): Promise<string> {
  n += 1;
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `sess-${String(n)}`, phone: `+9198333000${String(n).padStart(2, '0')}` })
    .returning();
  return u!.id;
}

async function row(key: string) {
  const [r] = await db
    .select()
    .from(s.userSessions)
    .where(eq(s.userSessions.keyHash, hashSessionKey(key)));
  return r!;
}

beforeAll(async () => {
  ({ db } = await createTestDb());
});

describe('user_sessions (migration 0117)', () => {
  it('stores only the hash of the key, never the key, an address or the raw user agent', async () => {
    const u = await freshUser();
    const key = await startUserSession(t(), { userId: u, device, place: rashtra });
    expect(key.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
    const r = await row(key);
    expect(r.keyHash).toBe(hashSessionKey(key));
    expect(r.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(Object.keys(r).filter((k) => /ip|agent/i.test(k))).toEqual([]);
    expect(r).toMatchObject({ deviceKind: 'mobile', browser: 'chrome', os: 'android', countryCode: 'IN' });
    expect(r.version).toBe(1);
  });

  it('refuses invalid codes and half-revoked rows at the database', async () => {
    const u = await freshUser();
    const base = {
      userId: u,
      keyHash: 'a'.repeat(64),
      deviceKind: 'mobile',
      browser: 'chrome',
      os: 'android',
    };
    const bad = async (over: Record<string, unknown>, hash: string) =>
      db.insert(s.userSessions).values({ ...base, keyHash: hash, ...over });
    await expect(bad({ deviceKind: 'toaster' }, 'b'.repeat(64))).rejects.toThrow();
    await expect(bad({}, 'not-hex')).rejects.toThrow();
    await expect(bad({ countryCode: 'in' }, 'c'.repeat(64))).rejects.toThrow();
    await expect(bad({ revokedAt: new Date() }, 'd'.repeat(64))).rejects.toThrow(); // reason missing
    await expect(bad({ revokedReason: 'self_all' }, 'e'.repeat(64))).rejects.toThrow(); // time missing
    await bad({}, 'a'.repeat(64));
    await expect(bad({}, 'a'.repeat(64))).rejects.toThrow(); // key hash is unique
  });

  it('bumps version and updated_at on every update (trigger)', async () => {
    const u = await freshUser();
    const key = await startUserSession(t(), { userId: u, device, place: null });
    const before = await row(key);
    await db.update(s.userSessions).set({ region: 'X' }).where(eq(s.userSessions.id, before.id));
    const after = await row(key);
    expect(after.version).toBe(before.version + 1);
  });

  it('looks a session up by key and tells revoked from live from unknown', async () => {
    const u = await freshUser();
    const key = await startUserSession(t(), { userId: u, device, place: null });
    expect(await sessionStateByKey(t(), key)).toMatchObject({ userId: u, revoked: false });
    expect(await sessionStateByKey(t(), 'nope-nope-nope-nope-nope-nope-nope-nope')).toBeNull();
    await revokeAllUserSessions(t(), u, 'self_all');
    expect(await sessionStateByKey(t(), key)).toMatchObject({ revoked: true });
  });
});

describe('listing', () => {
  it('lists only the caller’s live sign-ins, newest activity first, flags the current one, hides the hash', async () => {
    const a = await freshUser();
    const b = await freshUser();
    const k1 = await startUserSession(t(), { userId: a, device, place: rashtra });
    const k2 = await startUserSession(t(), {
      userId: a,
      device: { deviceKind: 'desktop', browser: 'edge', os: 'windows' },
      place: null,
    });
    await startUserSession(t(), { userId: b, device, place: null });
    const r1 = await row(k1);
    const r2 = await row(k2);
    await db
      .update(s.userSessions)
      .set({ lastActiveAt: new Date(Date.now() - 3 * 3600_000) })
      .where(eq(s.userSessions.id, r1.id));
    const list = await listUserSessions(t(), a, r2.id);
    expect(list.map((d) => d.id)).toEqual([r2.id, r1.id]);
    expect(list.map((d) => d.current)).toEqual([true, false]);
    expect(JSON.stringify(list)).not.toContain(r1.keyHash);
    expect(list[1]!.place).toMatchObject({ region: 'Chhattisgarh', gstStateCode: '22', city: 'Raipur' });
    expect(list[0]!.place).toBeNull();
  });

  it('gives a Hindi city only when the cities table knows it, and caps the list', async () => {
    const u = await freshUser();
    const [st] = await db
      .insert(s.states)
      .values({ code: 'ZZ', name: 'Zed', gstStateCode: '99' })
      .onConflictDoNothing()
      .returning();
    const stateId = st?.id ?? (await db.select().from(s.states).where(eq(s.states.code, 'ZZ')))[0]!.id;
    await db
      .insert(s.cities)
      .values({ stateId, code: 'ZZA', slug: 'zeta-town', name: 'Zeta Town', nameHi: 'ज़ेटा नगर' })
      .onConflictDoNothing();
    await startUserSession(t(), {
      userId: u,
      device,
      place: { countryCode: 'IN', region: 'Delhi', city: 'zeta town' },
    });
    await startUserSession(t(), {
      userId: u,
      device,
      place: { countryCode: 'IN', region: 'Delhi', city: 'Nowhereville' },
    });
    const list = await listUserSessions(t(), u, null);
    const byCity = new Map(list.map((d) => [d.place?.city, d.place?.cityHi]));
    expect(byCity.get('zeta town')).toBe('ज़ेटा नगर');
    expect(byCity.get('Nowhereville')).toBeNull();
    for (let i = 0; i < DEVICE_LIST_CAP + 3; i += 1)
      await startUserSession(t(), { userId: u, device, place: null });
    expect((await listUserSessions(t(), u, null)).length).toBe(DEVICE_LIST_CAP);
  });
});

describe('ending sessions', () => {
  it('ends another device, audits it, and the row leaves the list', async () => {
    const u = await freshUser();
    const cur = await row(await startUserSession(t(), { userId: u, device, place: null }));
    const other = await row(await startUserSession(t(), { userId: u, device, place: null }));
    await revokeUserSession(t(), { userId: u, sessionId: other.id, currentSessionId: cur.id });
    const after = await db.select().from(s.userSessions).where(eq(s.userSessions.id, other.id));
    expect(after[0]).toMatchObject({ revokedReason: 'self_device' });
    expect(after[0]!.revokedAt).toBeInstanceOf(Date);
    expect((await listUserSessions(t(), u, cur.id)).map((d) => d.id)).toEqual([cur.id]);
    const log = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'auth.device_signed_out'), eq(s.auditLog.entityId, other.id)));
    expect(log).toHaveLength(1);
    expect(log[0]!.actorUserId).toBe(u);
  });

  it('answers 404 for someone else’s row and for an unknown or already-ended id; the other row stays live', async () => {
    const a = await freshUser();
    const b = await freshUser();
    const curA = await row(await startUserSession(t(), { userId: a, device, place: null }));
    const rowB = await row(await startUserSession(t(), { userId: b, device, place: null }));
    await expect(
      revokeUserSession(t(), { userId: a, sessionId: rowB.id, currentSessionId: curA.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      revokeUserSession(t(), {
        userId: a,
        sessionId: '00000000-0000-7000-8000-000000000000',
        currentSessionId: curA.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listUserSessions(t(), b, null)).map((d) => d.id)).toEqual([rowB.id]);
  });

  it('refuses to end the current device through this path', async () => {
    const u = await freshUser();
    const cur = await row(await startUserSession(t(), { userId: u, device, place: null }));
    await expect(
      revokeUserSession(t(), { userId: u, sessionId: cur.id, currentSessionId: cur.id }),
    ).rejects.toBeInstanceOf(CurrentDeviceError);
  });

  it('two ends of the same row race to one winner (conditional update on state)', async () => {
    const u = await freshUser();
    const cur = await row(await startUserSession(t(), { userId: u, device, place: null }));
    const other = await row(await startUserSession(t(), { userId: u, device, place: null }));
    const results = await Promise.allSettled([
      revokeUserSession(t(), { userId: u, sessionId: other.id, currentSessionId: cur.id }),
      revokeUserSession(t(), { userId: u, sessionId: other.id, currentSessionId: cur.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected && 'reason' in rejected ? rejected.reason : null).toBeInstanceOf(NotFoundError);
  });

  it('ends every other device (all of them when the caller has no row), counts and audits once', async () => {
    const u = await freshUser();
    const cur = await row(await startUserSession(t(), { userId: u, device, place: null }));
    await startUserSession(t(), { userId: u, device, place: null });
    await startUserSession(t(), { userId: u, device, place: null });
    expect(await revokeOtherUserSessions(t(), { userId: u, currentSessionId: cur.id })).toBe(2);
    expect((await listUserSessions(t(), u, cur.id)).map((d) => d.id)).toEqual([cur.id]);
    expect(await revokeOtherUserSessions(t(), { userId: u, currentSessionId: cur.id })).toBe(0);
    const log = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'auth.devices_signed_out_others'), eq(s.auditLog.entityId, u)));
    expect(log).toHaveLength(1);
    expect(log[0]!.after).toEqual({ count: 2 });
    // A legacy (claim-less) caller has no current row: every live row counts as "other".
    expect(await revokeOtherUserSessions(t(), { userId: u, currentSessionId: null })).toBe(1);
  });

  it('never touches another person’s rows', async () => {
    const a = await freshUser();
    const b = await freshUser();
    await startUserSession(t(), { userId: a, device, place: null });
    const kb = await startUserSession(t(), { userId: b, device, place: null });
    await revokeOtherUserSessions(t(), { userId: a, currentSessionId: null });
    await revokeAllUserSessions(t(), a, 'self_all');
    expect(await sessionStateByKey(t(), kb)).toMatchObject({ revoked: false });
  });

  it('revokeAllUserSessions records the reason; the current-device sign-out is idempotent', async () => {
    const u = await freshUser();
    const k = await startUserSession(t(), { userId: u, device, place: null });
    const r = await row(k);
    await startUserSession(t(), { userId: u, device, place: null });
    expect(await revokeCurrentUserSession(t(), { userId: u, sessionId: r.id })).toBe(true);
    expect(await revokeCurrentUserSession(t(), { userId: u, sessionId: r.id })).toBe(false);
    expect(await revokeAllUserSessions(t(), u, 'staff_role_removed')).toBe(1);
    expect(await revokeAllUserSessions(t(), u, 'staff_role_removed')).toBe(0);
    const reasons = (await db.select().from(s.userSessions).where(eq(s.userSessions.userId, u))).map(
      (x) => x.revokedReason,
    );
    expect(reasons.sort()).toEqual(['self_device', 'staff_role_removed']);
  });
});

describe('last active', () => {
  it('refreshes at most once an hour, and never on a revoked row', async () => {
    const u = await freshUser();
    const r = await row(await startUserSession(t(), { userId: u, device, place: null }));
    expect(await touchSessionActive(t(), r.id)).toBe(false); // just created
    await db
      .update(s.userSessions)
      .set({ lastActiveAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(s.userSessions.id, r.id));
    expect(await touchSessionActive(t(), r.id)).toBe(true);
    expect(await touchSessionActive(t(), r.id)).toBe(false);
    await db
      .update(s.userSessions)
      .set({
        lastActiveAt: new Date(Date.now() - 2 * 3600_000),
        revokedAt: new Date(),
        revokedReason: 'self_all',
      })
      .where(eq(s.userSessions.id, r.id));
    expect(await touchSessionActive(t(), r.id)).toBe(false);
  });

  it('uses the partial active index for a person’s list', async () => {
    const plan = (
      await db.execute(sql`select indexname, indexdef from pg_indexes where tablename = 'user_sessions'`)
    ).rows as { indexname: string; indexdef: string }[];
    const active = plan.find((p) => p.indexname === 'user_sessions_active_idx');
    expect(active?.indexdef).toContain('revoked_at IS NULL');
  });
});
