/**
 * Shop portal next tier, part 1 (design 2026-11-15; specs 04, 07, 13): the busy / closed-today toggle (routing and
 * suggestions skip a busy shop, it ends by the clock, audited, owner's shop only), the shop's team (invite by phone,
 * claimed at sign-in, limit of 10, removal, no money for staff) and the late-accept message.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nextIstMidnight, SHOP_TEAM_MAX } from '@mechdost/shared/shop-team';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  acceptShopOffer,
  cancelShopStaffInvite,
  acceptShopStaffInvite,
  declineShopStaffInvite,
  listMyShopInvites,
  getMyShops,
  getRoutingOrder,
  grantRole,
  inviteShopStaff,
  listShopOrders,
  listShopTeam,
  loadGrants,
  placeCodOrder,
  quoteCheckout,
  removeShopMember,
  routeOrder,
  setShopBusy,
  syncRbacCatalogue,
  type CityScope,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let customer = '';
let staff = '';
let owner = '';
const scope: CityScope = { all: true };
const shop: Record<string, string> = {};
let keyN = 0;
let phoneN = 0;
const nextPhone = () => `+9198000${String(10000 + ++phoneN)}`;

async function place() {
  const lines = [{ sku: OIL, qty: 2 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  keyN += 1;
  const placed = await placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: `shop-tier1-key-${String(keyN).padStart(5, '0')}`,
    address: {
      contactName: 'Ravi Sahu',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.totalPaise,
    note: null,
    locale: 'en',
  });
  return placed.orders[0]!.code;
}
const eligibleShops = async (code: string) =>
  (await getRoutingOrder(t(), scope, code, 'en')).shops.filter((x) => x.eligible).map((x) => x.shopId);

async function member(phone: string) {
  const [u] = await db
    .insert(s.users)
    .values({
      firebaseUid: `fb-tier1-${phone}`,
      phone,
      phoneVerifiedAt: new Date(),
      name: 'Account Real Name',
    })
    .returning();
  return u!.id;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-tier1-customer' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-tier1-staff' }).returning())[0]!.id;
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${staff} from product_variants v cross join cities c where c.code = 'RPR'`);
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
  await db.update(s.shops).set({ hours: { open: '00:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6] } });
  owner = (
    await db
      .insert(s.users)
      .values({ firebaseUid: 'fb-tier1-owner', phone: '+919800000001', name: 'Owner' })
      .returning()
  )[0]!.id;
  const sharma = shop['Sharma Auto Parts']!;
  await grantRole(t(), { userId: owner, role: 'seller_owner', shopId: sharma, grantedBy: null });
  await db.insert(s.shopUsers).values({ shopId: sharma, userId: owner, role: 'owner' });
});

afterAll(async () => {
  await client.close();
});

describe('busy / closed today', () => {
  const sharma = () => shop['Sharma Auto Parts']!;
  const asOwner = (body: Parameters<typeof setShopBusy>[1]['body'], now?: Date) =>
    setShopBusy(t(), {
      shopId: sharma(),
      ownedShopIds: [sharma()],
      userId: owner,
      body,
      ...(now ? { now } : {}),
    });

  it('"closed today" ends at the next midnight in India; routing and suggestions skip the shop meanwhile', async () => {
    const code = await place();
    expect(await eligibleShops(code)).toContain(sharma());

    const now = new Date('2026-11-15T20:00:00Z'); // 01:30 IST on the 16th
    const saved = await asOwner({ mode: 'closed_today' }, now);
    // Midnight IST at the end of the 16th = 18:30 UTC on the 16th.
    expect(saved).toEqual({ busy: true, busyUntil: '2026-11-16T18:30:00.000Z' });
    expect(nextIstMidnight(new Date('2026-11-16T18:29:59Z')).toISOString()).toBe('2026-11-16T18:30:00.000Z');
    expect(nextIstMidnight(new Date('2026-11-16T18:30:00Z')).toISOString()).toBe('2026-11-17T18:30:00.000Z');
    // `now` here is in the past of the database clock, so the toggle is already over: set it from the real clock.
    await asOwner({ mode: 'closed_today' });
    expect(await eligibleShops(code)).not.toContain(sharma());
    await expect(
      routeOrder(t(), {
        scope,
        code,
        shopId: sharma(),
        expectedVersion: (await db.select().from(s.orders).where(eq(s.orders.code, code)))[0]!.version,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'SHOP_NOT_ELIGIBLE' });

    const mine = (await getMyShops(t(), [sharma()]))[0]!;
    expect(mine.busy).toBe(true);
    expect(mine.busyUntil).not.toBeNull();

    await asOwner({ mode: 'clear' });
    expect(await eligibleShops(code)).toContain(sharma());
    expect((await getMyShops(t(), [sharma()]))[0]).toMatchObject({ busy: false, busyUntil: null });
  });

  it('"busy for N hours" ends by itself (no job): once the end time passes the shop is offered again', async () => {
    const code = await place();
    const saved = await asOwner({ mode: 'hours', hours: 2 });
    expect(saved.busy).toBe(true);
    expect(await eligibleShops(code)).not.toContain(sharma());
    await db
      .update(s.shops)
      .set({ busyUntil: sql`now() - interval '1 second'` })
      .where(eq(s.shops.id, sharma()));
    expect(await eligibleShops(code)).toContain(sharma());
    expect((await getMyShops(t(), [sharma()]))[0]).toMatchObject({ busy: false, busyUntil: null });
    await asOwner({ mode: 'clear' });
  });

  it('is audited with the mode and end time, and only for a shop the caller owns (404 otherwise)', async () => {
    await asOwner({ mode: 'hours', hours: 1 });
    const [row] = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'shop.busy_changed'), eq(s.auditLog.entityId, sharma())))
      .orderBy(sql`${s.auditLog.createdAt} desc`)
      .limit(1);
    expect(row).toMatchObject({ actorRole: 'shop', actorUserId: owner });
    expect(row?.after).toMatchObject({ mode: 'hours' });
    await expect(
      setShopBusy(t(), {
        shopId: shop['Gupta Lubes & Spares']!,
        ownedShopIds: [sharma()],
        userId: owner,
        body: { mode: 'closed_today' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asOwner({ mode: 'clear' });
  });
});

describe('shop team', () => {
  const sharma = () => shop['Sharma Auto Parts']!;
  const base = () => ({ shopId: sharma(), ownedShopIds: [sharma()], userId: owner });

  it('signing in grants nothing; the invitee accepts once, by the right phone, and the owner sees the typed name only', async () => {
    const phone = nextPhone();
    const inv = await inviteShopStaff(t(), { ...base(), name: 'Mohan', phone });
    const before = await listShopTeam(t(), base());
    expect(before.invites).toEqual([expect.objectContaining({ id: inv.id, name: 'Mohan' })]);

    // The person exists and has signed in: no grant, the invite stays open and is shown to them.
    const helper = await member(phone);
    expect((await loadGrants(t(), helper)).filter((g) => g.shopId !== null)).toEqual([]);
    const mine = await listMyShopInvites(t(), { userId: helper });
    expect(mine).toEqual([
      expect.objectContaining({ id: inv.id, invitedAs: 'Mohan', shopName: 'Sharma Auto Parts' }),
    ]);
    expect((await listShopTeam(t(), base())).members.map((m) => m.userId)).not.toContain(helper);
    // The owner never sees the account's own name before accepting.
    expect(JSON.stringify(before)).not.toContain('Account Real Name');

    // Another person (other phone) or an unverified phone cannot accept it: 404.
    const stranger = await member(nextPhone());
    await expect(acceptShopStaffInvite(t(), { userId: stranger, inviteId: inv.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Two parallel accepts: one grant, the other is refused.
    const results = await Promise.allSettled([
      acceptShopStaffInvite(t(), { userId: helper, inviteId: inv.id }),
      acceptShopStaffInvite(t(), { userId: helper, inviteId: inv.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const grants = (await loadGrants(t(), helper)).filter((g) => g.shopId !== null);
    expect(grants).toEqual([expect.objectContaining({ role: 'seller_staff', shopId: sharma() })]);
    expect(grants[0]!.permissions).not.toContain('payouts:read');
    await expect(acceptShopStaffInvite(t(), { userId: helper, inviteId: inv.id })).rejects.toMatchObject({
      code: 'INVITE_USED',
    });
    const [row] = await db.select().from(s.shopStaffInvites).where(eq(s.shopStaffInvites.id, inv.id));
    expect(row).toMatchObject({ status: 'used', usedBy: helper });
    expect(await listMyShopInvites(t(), { userId: helper })).toEqual([]);

    // After accepting: a member, shown under the typed name, not the account name.
    const after = await listShopTeam(t(), base());
    expect(after.members.find((m) => m.userId === helper)).toMatchObject({ role: 'staff', name: 'Mohan' });
    expect(after.invites.map((i) => i.id)).not.toContain(inv.id);
    expect(JSON.stringify(after)).not.toContain('Account Real Name');
  });

  it('a phone that was never verified cannot accept', async () => {
    const phone = nextPhone();
    const inv = await inviteShopStaff(t(), { ...base(), name: 'Ravi', phone });
    const unverified = (
      await db.insert(s.users).values({ firebaseUid: 'fb-tier1-unverified', phone }).returning()
    )[0]!.id;
    await expect(acceptShopStaffInvite(t(), { userId: unverified, inviteId: inv.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await listMyShopInvites(t(), { userId: unverified })).toEqual([]);
  });

  it('declining closes the invite: nothing is granted and the owner no longer sees it waiting', async () => {
    const phone = nextPhone();
    const inv = await inviteShopStaff(t(), { ...base(), name: 'Sita', phone });
    const person = await member(phone);
    await declineShopStaffInvite(t(), { userId: person, inviteId: inv.id });
    expect((await loadGrants(t(), person)).filter((g) => g.shopId !== null)).toEqual([]);
    expect((await listShopTeam(t(), base())).invites.map((i) => i.id)).not.toContain(inv.id);
    await expect(acceptShopStaffInvite(t(), { userId: person, inviteId: inv.id })).rejects.toMatchObject({
      code: 'INVITE_CLOSED',
    });
    const other = await member(nextPhone());
    await expect(declineShopStaffInvite(t(), { userId: other, inviteId: inv.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a second open invite for the same number, an existing member and another shop owner’s ids', async () => {
    const phone = nextPhone();
    await inviteShopStaff(t(), { ...base(), name: 'Sita', phone });
    await expect(inviteShopStaff(t(), { ...base(), name: 'Sita', phone })).rejects.toMatchObject({
      code: 'INVITE_OPEN',
    });
    await expect(
      inviteShopStaff(t(), { ...base(), name: 'Owner', phone: '+919800000001' }),
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER' });
    await expect(
      inviteShopStaff(t(), {
        ...base(),
        shopId: shop['Gupta Lubes & Spares']!,
        name: 'X Y',
        phone: nextPhone(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(inviteShopStaff(t(), { ...base(), name: 'X', phone: '12345' })).rejects.toMatchObject({
      code: 'INVITE_INVALID',
    });
  });

  it('cancelling stops the invite; an expired invite is never claimed and no longer blocks a new one', async () => {
    const phone = nextPhone();
    const inv = await inviteShopStaff(t(), { ...base(), name: 'Raju', phone });
    await cancelShopStaffInvite(t(), { ...base(), inviteId: inv.id });
    await expect(cancelShopStaffInvite(t(), { ...base(), inviteId: inv.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const person = await member(phone);
    await expect(acceptShopStaffInvite(t(), { userId: person, inviteId: inv.id })).rejects.toMatchObject({
      code: 'INVITE_CLOSED',
    });

    const phone2 = nextPhone();
    const old = await inviteShopStaff(t(), { ...base(), name: 'Old', phone: phone2 });
    await db
      .update(s.shopStaffInvites)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(s.shopStaffInvites.id, old.id));
    const person2 = await member(phone2);
    await expect(acceptShopStaffInvite(t(), { userId: person2, inviteId: old.id })).rejects.toMatchObject({
      code: 'INVITE_EXPIRED',
    });
    const again = await inviteShopStaff(t(), { ...base(), name: 'New', phone: phone2 });
    expect(again.id).not.toBe(old.id);
    const [expired] = await db.select().from(s.shopStaffInvites).where(eq(s.shopStaffInvites.id, old.id));
    expect(expired?.status).toBe('expired');
  });

  it('a MechDost staff account is never made shop staff by an invite', async () => {
    const phone = nextPhone();
    const adminInvite = await inviteShopStaff(t(), { ...base(), name: 'Admin Person', phone });
    const adminUser = await member(phone);
    await grantRole(t(), { userId: adminUser, role: 'support_agent', grantedBy: null });
    await expect(
      acceptShopStaffInvite(t(), { userId: adminUser, inviteId: adminInvite.id }),
    ).rejects.toMatchObject({
      code: 'MEMBER_IS_STAFF',
    });
    expect((await loadGrants(t(), adminUser)).some((g) => g.role === 'seller_staff')).toBe(false);
  });

  it('the owner removes access: grant and membership go together; the owner and yourself stay', async () => {
    const phone = nextPhone();
    const goneInvite = await inviteShopStaff(t(), { ...base(), name: 'Gone Soon', phone });
    const helper = await member(phone);
    await acceptShopStaffInvite(t(), { userId: helper, inviteId: goneInvite.id });
    await removeShopMember(t(), { ...base(), memberUserId: helper });
    expect((await loadGrants(t(), helper)).some((g) => g.shopId !== null)).toBe(false);
    expect((await listShopTeam(t(), base())).members.map((m) => m.userId)).not.toContain(helper);
    await expect(removeShopMember(t(), { ...base(), memberUserId: helper })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(removeShopMember(t(), { ...base(), memberUserId: owner })).rejects.toMatchObject({
      code: 'CANNOT_REMOVE_SELF',
    });
    const [audit] = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'role.revoked'))
      .orderBy(sql`${s.auditLog.createdAt} desc`)
      .limit(1);
    expect(audit?.reason).toBe('removed by the shop owner');
    // A removed person can be invited again.
    await inviteShopStaff(t(), { ...base(), name: 'Gone Soon', phone });
  });

  it('removing the owner by another owner is refused', async () => {
    const co = await member(nextPhone());
    await grantRole(t(), { userId: co, role: 'seller_owner', shopId: sharma(), grantedBy: null });
    await db.insert(s.shopUsers).values({ shopId: sharma(), userId: co, role: 'owner' });
    await expect(removeShopMember(t(), { ...base(), memberUserId: co })).rejects.toMatchObject({
      code: 'CANNOT_REMOVE_OWNER',
    });
  });

  it('at most 10 people per shop (members + waiting invites), also under parallel invites', async () => {
    const before = await listShopTeam(t(), base());
    const room = SHOP_TEAM_MAX - before.members.length - before.invites.length;
    expect(room).toBeGreaterThan(1);
    // Fill all but one place, then race three invites for the last one.
    for (let i = 0; i < room - 1; i++)
      await inviteShopStaff(t(), { ...base(), name: `Helper ${String(i)}`, phone: nextPhone() });
    const raced = await Promise.allSettled(
      [0, 1, 2].map((i) =>
        inviteShopStaff(t(), { ...base(), name: `Racer ${String(i)}`, phone: nextPhone() }),
      ),
    );
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      raced.filter((r) => r.status === 'rejected').map((r) => (r.reason as { code: string }).code),
    ).toEqual(['TEAM_FULL', 'TEAM_FULL']);
    const after = await listShopTeam(t(), base());
    expect(after.members.length + after.invites.length).toBe(SHOP_TEAM_MAX);
  });
});

describe('money and the portal lists', () => {
  it('shop staff get no payout or shop price; the owner does; cash to collect stays for the person at the door', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const code = await place();
    const [o] = await db.select().from(s.orders).where(eq(s.orders.code, code));
    const r = await routeOrder(t(), {
      scope,
      code,
      shopId: sharma,
      expectedVersion: o!.version,
      staffUserId: staff,
    });
    const asOwner = (await listShopOrders(t(), [sharma], 'offers')).items.find((i) => i.code === code)!;
    expect(asOwner.payoutPaise).toBeGreaterThan(0);
    const asStaff = (await listShopOrders(t(), [sharma], 'offers', { moneyShopIds: [] })).items.find(
      (i) => i.code === code,
    )!;
    expect(asStaff.payoutPaise).toBeNull();
    expect(asStaff.items.every((i) => i.unitPaise === null)).toBe(true);
    expect(asStaff.items.length).toBeGreaterThan(0);

    // Late accept: the explicit code, not the generic "unavailable".
    await db
      .update(s.orderAssignments)
      .set({ offeredAt: sql`now() - interval '20 minutes'`, expiresAt: sql`now() - interval '1 second'` })
      .where(eq(s.orderAssignments.id, r.assignmentId));
    await expect(
      acceptShopOffer(t(), { shopIds: [sharma], assignmentId: r.assignmentId, staffUserId: owner }),
    ).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
  });
});
