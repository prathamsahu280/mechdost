/**
 * `GET /v1/me/refunds` (spec 05, 2026-11-23): a customer sees only their own refunds, in plain stages, newest first;
 * another customer's refund never appears; shop accounts are refused; nothing internal (staff ids, notes, reject
 * reason, idempotency key, payout destination) leaves the server.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { encryptField, loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
const ids: Record<string, string> = {};
const heads: Record<string, Record<string, string>> = {};
let seq = 0;
const ring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const SECRET_DESTINATION = 'ravi-private@okbank';

async function person(key: string, role: string | null, shopId: string | null = null) {
  const phone = `+9198444444${key}`;
  const token = ctx.verifier.add(`token-myrefunds-00${key}`, {
    firebaseUid: `mr-${key}`,
    phone,
    email: `mr-${key}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `mr-${key}`,
    phone,
    email: `mr-${key}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  ids[key] = user.id;
  heads[key] = { ...bearer(token), 'content-type': 'application/json' };
}

/** A checkout of `userId` with one refund on it. */
async function refundFor(
  userId: string,
  values: Partial<typeof s.refunds.$inferInsert> & { amountPaise: number },
) {
  seq += 1;
  const [city] = await ctx.db.select().from(s.cities).limit(1);
  const code = `MD-RPR-2026-Q${String(seq).padStart(5, '0')}`;
  const [g] = await ctx.db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: city!.id,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `my-refunds-idem-${code}-xxxxxxxx`,
    })
    .returning();
  const [r] = await ctx.db
    .insert(s.refunds)
    .values({
      groupId: g!.id,
      mode: 'bank_upi',
      idemKey: `my-refunds-refund-idem-${String(seq)}`,
      status: 'requested',
      source: 'order_rejected',
      reasonCode: 'order_rejected',
      note: 'Staff only: customer shouted',
      destinationEnc: encryptField(SECRET_DESTINATION, ring, 'refunds.destination_enc'),
      ...values,
    })
    .returning();
  return { code, refund: r! };
}

const get = (key: string | null, query = '') =>
  ctx.app.request(`/v1/me/refunds${query}`, { headers: key ? heads[key] : {} });

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  await person('01', null);
  await person('02', null);
  await person('03', 'support_agent');
  const [shop] = await ctx.db.select().from(s.shops).limit(1);
  await person('04', 'seller_owner', shop!.id);
});

describe('GET /v1/me/refunds', () => {
  it('needs sign-in', async () => {
    expect((await get(null)).status).toBe(401);
  });

  it('starts empty for a customer with no refunds', async () => {
    const res = await get('01');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refunds: [], nextCursor: null });
  });

  it('shows only the caller’s own refunds, never another customer’s, with no internal fields', async () => {
    const mine = await refundFor(ids['01']!, { amountPaise: 12_300 });
    const theirs = await refundFor(ids['02']!, { amountPaise: 99_900 });
    const res = await get('01');
    const body = (await res.json()) as { refunds: Record<string, unknown>[] };
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0]).toEqual({
      id: mine.refund.id,
      target: { kind: 'order', code: mine.code },
      amountPaise: 12_300,
      reasonCode: 'order_rejected',
      method: 'manual',
      stage: 'requested',
      requestedAt: mine.refund.createdAt.toISOString(),
      approvedAt: null,
      sentAt: null,
      completedAt: null,
      providerRefundId: null,
    });
    const text = JSON.stringify(body);
    for (const secret of [
      theirs.code,
      'Staff only',
      SECRET_DESTINATION,
      'idemKey',
      'rejectReason',
      'approvedBy',
    ])
      expect(text).not.toContain(secret);
    // The other customer sees theirs, and only theirs.
    const other = (await (await get('02')).json()) as { refunds: { id: string }[] };
    expect(other.refunds.map((r) => r.id)).toEqual([theirs.refund.id]);
  });

  it('maps every refund status to a plain stage; "completed" only once processed; the Razorpay id only once sent', async () => {
    await person('05', null);
    const user = ids['05']!;
    const now = new Date();
    const cases: [string, Partial<typeof s.refunds.$inferInsert>, string, boolean][] = [
      ['requested', {}, 'requested', false],
      ['approved', { decidedAt: now, approvedBy: ids['03']! }, 'approved', false],
      [
        'rejected',
        { rejectedBy: ids['03']!, rejectReasonCode: 'not_eligible', decidedAt: now },
        'declined',
        false,
      ],
    ];
    for (const [status, extra] of cases) {
      await refundFor(user, { amountPaise: 1000, status, ...extra });
    }
    const rows = (
      (await (await get('05', '?limit=50')).json()) as {
        refunds: { stage: string; providerRefundId: string | null }[];
      }
    ).refunds;
    expect(rows.map((r) => r.stage).sort()).toEqual(['approved', 'declined', 'requested']);
    expect(rows.every((r) => r.providerRefundId === null)).toBe(true);
  });

  it('a sent Razorpay refund shows the stage "sent" with its refund id; a processed one is "completed"', async () => {
    await person('06', null);
    const user = ids['06']!;
    const [city] = await ctx.db.select().from(s.cities).limit(1);
    seq += 1;
    const code = `MD-RPR-2026-P${String(seq).padStart(5, '0')}`;
    const [g] = await ctx.db
      .insert(s.orderGroups)
      .values({
        code,
        userId: user,
        cityId: city!.id,
        paymentMethod: 'online',
        paymentStatus: 'paid',
        subtotalPaise: 50000,
        totalPaise: 50000,
        idempotencyKey: `my-refunds-idem-${code}-xxxxxxxx`,
      })
      .returning();
    const [pay] = await ctx.db
      .insert(s.payments)
      .values({
        groupId: g!.id,
        provider: 'razorpay',
        providerOrderId: `order_mr${String(seq)}`,
        providerPaymentId: `pay_mr${String(seq)}`,
        amountPaise: 50000,
        status: 'paid',
        capturedAt: new Date(),
      } as typeof s.payments.$inferInsert)
      .returning();
    const make = (status: string, n: number, extra: Partial<typeof s.refunds.$inferInsert>) =>
      ctx.db.insert(s.refunds).values({
        groupId: g!.id,
        paymentId: pay!.id,
        mode: 'source',
        amountPaise: 1000 * n,
        idemKey: `my-refunds-rz-idem-${String(seq)}-${String(n)}`,
        status,
        source: 'order_rejected',
        reasonCode: 'order_rejected',
        decidedAt: new Date(),
        approvedBy: ids['03']!,
        ...extra,
      });
    await make('initiated', 1, { providerRefundId: 'rfnd_Sent0001', initiatedAt: new Date() });
    await make('needs_reconciliation', 3, { initiatedAt: new Date() });
    await make('failed', 4, { failureCode: 'confirmed_not_sent', settledAt: new Date() });
    await make('processed', 2, {
      providerRefundId: 'rfnd_Done0002',
      initiatedAt: new Date(),
      settledAt: new Date(),
    });
    const rows = (
      (await (await get('06')).json()) as {
        refunds: {
          stage: string;
          amountPaise: number;
          method: string;
          providerRefundId: string | null;
          sentAt: string | null;
          completedAt: string | null;
        }[];
      }
    ).refunds;
    const sent = rows.find((r) => r.amountPaise === 1000)!;
    const done = rows.find((r) => r.amountPaise === 2000)!;
    expect(rows.find((r) => r.amountPaise === 3000)?.stage).toBe('checking');
    expect(rows.find((r) => r.amountPaise === 4000)?.stage).toBe('failed');
    expect(sent).toMatchObject({
      stage: 'sent',
      method: 'original',
      providerRefundId: 'rfnd_Sent0001',
      completedAt: null,
    });
    expect(sent.sentAt).not.toBeNull();
    expect(done).toMatchObject({ stage: 'completed', providerRefundId: 'rfnd_Done0002' });
    expect(done.completedAt).not.toBeNull();
  });

  it('pages newest first by cursor and refuses a tampered cursor', async () => {
    await person('07', null);
    for (let i = 1; i <= 3; i += 1) await refundFor(ids['07']!, { amountPaise: 1000 * i });
    const first = (await (await get('07', '?limit=2')).json()) as {
      refunds: { amountPaise: number }[];
      nextCursor: string | null;
    };
    expect(first.refunds.map((r) => r.amountPaise)).toEqual([3000, 2000]);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await get('07', `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)
    ).json()) as { refunds: { amountPaise: number }[]; nextCursor: string | null };
    expect(second.refunds.map((r) => r.amountPaise)).toEqual([1000]);
    expect(second.nextCursor).toBeNull();
    const bad = await get('07', '?cursor=not-a-cursor');
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson).error.code).toBe('INVALID_CURSOR');
  });

  it('refuses shop accounts and gives staff with no orders an empty list (their own scope, nothing of others)', async () => {
    const shop = await get('04');
    expect(shop.status).toBe(403);
    const staff = await get('03');
    expect(staff.status).toBe(200);
    expect(await staff.json()).toEqual({ refunds: [], nextCursor: null });
  });
});
