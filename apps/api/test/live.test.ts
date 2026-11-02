/**
 * Live relay (decision 2026-11-01): outbox rows become thin pings for recipients resolved from Postgres; a failed
 * transport loses nothing (rows come back after the lease); the RTDB inbox write is bounded and path-safe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '@mechdost/db/schema';
import { createTestDb, type TestDb } from '@mechdost/db/testing';
import type { Tx } from '@mechdost/db/repo';
import { parseLivePing } from '@mechdost/shared/live';
import { ConfigError, loadConfig } from '../src/config';
import {
  inboxRemovals,
  inboxUpdates,
  type ForgetTarget,
  type LiveDelivery,
  type LivePublisher,
} from '../src/live/publisher';
import { PublishTimeoutError, relayOnce, revokeOnce, withTimeout } from '../src/live/relay';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
let seq = 0;

async function newOrder() {
  seq += 1;
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const code = `MD-RPR-2026-RPAY${B32[seq % 32] ?? '0'}0`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId: F.customer!,
      cityId: F.city!,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `relay-idem-${seq}-xxxxxxxxxxxx`,
    })
    .returning();
  return (
    await db
      .insert(s.orders)
      .values({
        groupId: g!.id,
        subNo: 1,
        code: `${code}-1`,
        userId: F.customer!,
        cityId: F.city!,
        shippingAddress: { line1: 'Sarona', pincode: '492001' },
        pincode: '492001',
        subtotalPaise: 50000,
        totalPaise: 50000,
      })
      .returning()
  )[0]!;
}

class FakePublisher implements LivePublisher {
  readonly name = 'rtdb' as const;
  batches: LiveDelivery[][] = [];
  failNext = false;
  publish(batch: readonly LiveDelivery[]) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('transport down'));
    }
    this.batches.push([...batch]);
    return Promise.resolve();
  }
  forgotten: ForgetTarget[] = [];
  forget(targets: readonly ForgetTarget[]) {
    this.forgotten.push(...targets);
    return Promise.resolve();
  }
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await db
    .insert(s.cities)
    .values({
      stateId: state!.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      status: 'live',
      centroid: { lng: 81.64, lat: 21.227 },
    })
    .returning();
  F.city = city!.id;
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: F.city,
    centroid: { lng: 81.64, lat: 21.227 },
  });
  F.customer = (await db.insert(s.users).values({ firebaseUid: 'fb-relay-customer' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('live relay', () => {
  it('delivers each change once to the people Postgres allows, then marks it sent', async () => {
    const order = await newOrder();
    const pub = new FakePublisher();
    const first = await relayOnce(t(), pub);
    expect(first.claimed).toBeGreaterThan(0);
    const delivery = pub.batches.flat().find((d) => d.ping.id === order.id);
    expect(delivery?.recipients).toEqual(['fb-relay-customer']);
    expect(parseLivePing(delivery?.ping)).not.toBeNull();
    expect((await relayOnce(t(), pub)).claimed).toBe(0);
  });

  it('a failed transport loses nothing: the rows come back after the lease', async () => {
    const order = await newOrder();
    const pub = new FakePublisher();
    pub.failNext = true;
    await expect(relayOnce(t(), pub)).rejects.toThrow('transport down');
    expect((await relayOnce(t(), pub)).claimed).toBe(0); // still leased
    await client.exec(
      "update live_outbox set claimed_at = now() - interval '1 minute' where sent_at is null",
    );
    await relayOnce(t(), pub);
    expect(pub.batches.flat().some((d) => d.ping.id === order.id)).toBe(true);
  });
});

describe('RTDB inbox updates', () => {
  const ping = (v: number) => ({
    e: 'order.status_changed' as const,
    k: 'order' as const,
    id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
    v,
    at: '2026-11-01T10:00:00.000Z',
  });

  it('writes one node per recipient and entity, newest version wins', () => {
    const updates = inboxUpdates([
      { recipients: ['uidA', 'uidB'], ping: ping(2) },
      { recipients: ['uidA'], ping: ping(3) },
      { recipients: ['uidA'], ping: ping(1) },
    ]);
    expect(Object.keys(updates).sort()).toEqual([
      'inbox/uidA/order~0192f3a4-5b6c-7d8e-9f01-23456789abcd',
      'inbox/uidB/order~0192f3a4-5b6c-7d8e-9f01-23456789abcd',
    ]);
    expect(updates['inbox/uidA/order~0192f3a4-5b6c-7d8e-9f01-23456789abcd']?.v).toBe(3);
  });

  it('never writes outside a recipient inbox', () => {
    expect(inboxUpdates([{ recipients: ['../admin', 'a/b', 'x.y', ''], ping: ping(1) }])).toEqual({});
  });
});

describe('live config', () => {
  const base = { DATABASE_POOL_URL: 'postgres://localhost/db' };

  it('defaults to polling', () => {
    expect(loadConfig(base).live.transport).toBe('polling');
  });

  it('requires a Firebase RTDB URL for rtdb', () => {
    expect(() => loadConfig({ ...base, LIVE_TRANSPORT: 'rtdb' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...base, LIVE_TRANSPORT: 'rtdb', FIREBASE_DATABASE_URL: 'https://evil.example.com/' }),
    ).toThrow(ConfigError);
    const cfg = loadConfig({
      ...base,
      LIVE_TRANSPORT: 'rtdb',
      FIREBASE_DATABASE_URL: 'https://mechdost-live.asia-southeast1.firebasedatabase.app',
    });
    expect(cfg.live).toMatchObject({ transport: 'rtdb', listenUrl: null });
  });
});

describe('RTDB security rules (firebase/database.rules.json)', () => {
  it('lets a user read only their own inbox and nobody write from a client', async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(new URL('../../../firebase/database.rules.json', import.meta.url), 'utf8');
    const rules = JSON.parse(raw) as {
      rules: Record<string, unknown> & { inbox: { $uid: Record<string, unknown> } };
    };
    expect(rules.rules['.read']).toBe(false);
    expect(rules.rules['.write']).toBe(false);
    expect(Object.keys(rules.rules).sort()).toEqual(['.read', '.write', 'inbox']);
    expect(rules.rules.inbox.$uid).toEqual({ '.read': 'auth != null && auth.uid === $uid', '.write': false });
  });
});

describe('lost access wipes the live inbox (security review follow-ups)', () => {
  it('a deactivated user is wiped now and once more after the in-flight window, then the row is done', async () => {
    await db.insert(s.users).values({ firebaseUid: 'fb-relay-leaver' });
    await client.exec("update users set status = 'deactivated' where firebase_uid = 'fb-relay-leaver'");
    const pub = new FakePublisher();
    expect(await revokeOnce(t(), pub)).toBe(1);
    expect(pub.forgotten).toEqual([{ firebaseUid: 'fb-relay-leaver', node: null }]);
    expect(await revokeOnce(t(), pub)).toBe(0); // second pass waits for the in-flight window
    await client.exec("update live_revocations set wiped_at = now() - interval '3 minutes'");
    expect(await revokeOnce(t(), pub)).toBe(1);
    expect(await revokeOnce(t(), pub)).toBe(0); // done after two passes
    expect(pub.forgotten).toHaveLength(2);
  });

  it('a wipe recorded while the relay was down still gets its full in-flight window', async () => {
    await db.insert(s.users).values({ firebaseUid: 'fb-relay-late' });
    await client.exec("update users set status = 'deactivated' where firebase_uid = 'fb-relay-late'");
    await client.exec(
      "update live_revocations set created_at = now() - interval '10 minutes' where firebase_uid = 'fb-relay-late'",
    );
    const pub = new FakePublisher();
    expect(await revokeOnce(t(), pub)).toBe(1);
    expect(await revokeOnce(t(), pub)).toBe(0); // not back to back: waits 120 s after the first pass
  });

  it('a timed-out publish re-arms the wipes of its recipients (the late write may still land)', async () => {
    const pub = new FakePublisher();
    await client.exec(
      "insert into live_revocations (firebase_uid, reason, attempts, wiped_at, done_at) values ('fb-relay-customer', 'role_changed', 2, now(), now())",
    );
    await newOrder();
    pub.publish = () => Promise.reject(new PublishTimeoutError());
    await expect(relayOnce(t(), pub)).rejects.toThrow('live publish timed out');
    const res = await client.query<{ done_at: string | null; attempts: number }>(
      "select done_at, attempts from live_revocations where firebase_uid = 'fb-relay-customer' and reason = 'role_changed'",
    );
    expect(res.rows[0]).toMatchObject({ done_at: null, attempts: 1 });
  });

  it('an older wipe without wiped_at (before migration 0023) still gets its second pass', async () => {
    await client.exec(
      "insert into live_revocations (firebase_uid, reason, attempts, created_at) values ('fb-relay-legacy', 'deactivated', 1, now() - interval '10 minutes')",
    );
    const pub = new FakePublisher();
    await revokeOnce(t(), pub);
    expect(pub.forgotten.some((f) => f.firebaseUid === 'fb-relay-legacy')).toBe(true);
  });

  it('a publish never runs past its cap', async () => {
    const never = new Promise<void>(() => undefined);
    await expect(withTimeout(never, 10)).rejects.toThrow('live publish timed out');
    await expect(withTimeout(Promise.resolve('ok'), 10)).resolves.toBe('ok');
  });

  it('only ever removes paths inside inbox/{uid}', () => {
    const id = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
    expect(
      inboxRemovals([
        { firebaseUid: 'uidA', node: null },
        { firebaseUid: 'uidB', node: `order~${id}` },
        { firebaseUid: 'uidC', node: '../../admin' },
        { firebaseUid: '../admin', node: null },
        { firebaseUid: 'a/b', node: null },
      ]),
    ).toEqual({ 'inbox/uidA': null, [`inbox/uidB/order~${id}`]: null });
  });
});
