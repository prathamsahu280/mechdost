import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { gstinStateCode, isGstin } from '@mechdost/shared/gst';
import { PARTNER_STANDING_REASONS, type PartnerStandingReason } from '@mechdost/shared/partner-codes';
import { DEFAULT_SHOP_HOURS, isShopHours, shopOpenState, type ShopHours } from '@mechdost/shared/shop-hours';
import {
  auditLog,
  partnerStatusEvents,
  pincodes,
  roles,
  shopPincodes,
  shopUsers,
  shops,
  states,
  userRoles,
  users,
} from '../schema';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { maybeGoLive } from './price-requests';
import { grantRole } from './rbac';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';
import { findPasswordAccount } from './users';
import { gstinHeldElsewhere } from './partner-applications';
import type { Keyring } from '../crypto';

/**
 * Shop management on the real API (decision 2026-11-14 "Shop management"; specs 07/08 "Real API mode"). Staff
 * (city-scoped; 404 outside their cities): list and read shops, edit the profile (compare-and-set on `version`,
 * audited before/after), set delivery coverage per PIN (the shop's own city only) and give portal access by phone.
 * Standing (pause/suspend/reactivate) is `setShopStanding` in `partners.ts`. A shop reads its own profile with
 * `getMyShops` (the shops in its grants). Permissions are checked in the API.
 */

export type ShopStatus = 'pending' | 'approved' | 'paused' | 'suspended';
export type ShopMemberRole = 'seller_owner' | 'seller_staff';

export interface AdminShopRow {
  id: string;
  cityId: string;
  name: string;
  nameHi: string | null;
  addressLine: string;
  addressLineHi: string | null;
  pincode: string;
  status: ShopStatus;
  gstStatus: string;
  busy: boolean;
  coveragePincodes: number;
  offersOnSale: number;
  freeDeliveryMinPaise: number | null;
  /** Working hours (IST) and whether the shop is inside them now. */
  hours: ShopHours;
  openNow: boolean;
  version: number;
  /** Shop texts without their Hindi version (hard rule 10): `name`, `addressLine`. */
  missingHindi: string[];
}

export interface ShopCoverageRow {
  pincode: string;
  shippingPaise: number;
  leadDays: number;
  active: boolean;
}

export interface AdminShopDetail extends AdminShopRow {
  legalName: string | null;
  gstin: string | null;
  phone: string;
  email: string | null;
  acceptanceTimeoutMin: number | null;
  statusReason: string | null;
  statusReasonCode: PartnerStandingReason | null;
  statusChangedAt: string | null;
  pausedUntil: string | null;
  coverage: ShopCoverageRow[];
  history: {
    from: string;
    to: string;
    reasonCode: PartnerStandingReason | null;
    reason: string;
    endsAt: string | null;
    at: string;
  }[];
  /** Portal access: role and the last 4 digits of the phone (no full numbers in the console). */
  members: { userId: string; role: ShopMemberRole; phoneLast4: string | null }[];
}

interface ShopSqlRow {
  id: string;
  city_id: string;
  name: string;
  name_hi: string | null;
  address_line: string;
  address_line_hi: string | null;
  pincode: string;
  status: ShopStatus;
  gst_status: string;
  busy: boolean;
  coverage: unknown;
  on_sale: unknown;
  free_delivery_min_paise: unknown;
  hours: unknown;
  version: unknown;
}

const ROW_COLUMNS = sql`s.id, s.city_id, s.name, s.name_hi, s.address_line, s.address_line_hi, s.pincode, s.status,
  s.gst_status, (s.busy and (s.busy_until is null or s.busy_until > now())) as busy,
  (select count(*) from shop_pincodes sp join pincodes pc on pc.pincode = sp.pincode and pc.active
    where sp.shop_id = s.id and sp.active)::int as coverage,
  (select count(*) from shop_inventory si where si.shop_id = s.id and si.active and not si.admin_blocked)::int
    as on_sale,
  s.free_delivery_min_paise, s.hours, s.version`;

const inCities = (scope: CityScope) =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`s.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

/** A stored reason code as the typed code (the column's CHECK lists the same codes). */
const reasonOf = (v: string | null): PartnerStandingReason | null =>
  PARTNER_STANDING_REASONS.find((r) => r === v) ?? null;

const hoursOf = (v: unknown): ShopHours => (isShopHours(v) ? v : DEFAULT_SHOP_HOURS);

function toRow(r: ShopSqlRow): AdminShopRow {
  const hours = hoursOf(r.hours);
  const missingHindi: string[] = [];
  if (!r.name_hi) missingHindi.push('name');
  if (!r.address_line_hi) missingHindi.push('addressLine');
  return {
    id: r.id,
    cityId: r.city_id,
    name: r.name,
    nameHi: r.name_hi,
    addressLine: r.address_line,
    addressLineHi: r.address_line_hi,
    pincode: r.pincode,
    status: r.status,
    gstStatus: r.gst_status,
    busy: r.busy,
    coveragePincodes: num(r.coverage),
    offersOnSale: num(r.on_sale),
    freeDeliveryMinPaise: numOrNull(r.free_delivery_min_paise),
    hours,
    openNow: shopOpenState(hours, new Date()).open,
    version: num(r.version),
    missingHindi,
  };
}

const SHOP_PAGE = 50;
const SHOP_PAGE_MAX = 100;

/** The caller's shops by name (keyset on name + id: the cursor names the last shop), optionally one status. */
export async function listAdminShops(
  db: Tx,
  scope: CityScope,
  opts: { status?: ShopStatus | null; cursor?: string | null; limit?: number },
): Promise<{ items: AdminShopRow[]; nextCursor: string | null }> {
  const limit = pageSize(opts.limit, SHOP_PAGE, SHOP_PAGE_MAX);
  // The cursor carries the last row's name and id (never re-read: a rename between pages skips nothing, and no
  // lookup by id can reach a shop outside the caller's cities; security review 2026-11-14).
  const after = opts.cursor ? decodeCursor(opts.cursor, 'text', 300) : null;
  const rows = rowsOf<ShopSqlRow>(
    await db.execute(sql`select ${ROW_COLUMNS} from shops s
      where ${inCities(scope)}
        and ${opts.status ? sql`s.status = ${opts.status}` : sql`true`}
        and ${after ? sql`(s.name, s.id) > (${after.k}, ${after.id}::uuid)` : sql`true`}
      order by s.name, s.id limit ${limit + 1}`),
  );
  const items = rows.slice(0, limit).map(toRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.name, id: last.id }) : null,
  };
}

/** One shop in the caller's cities (404 otherwise), locked when `forUpdate`. */
async function scopedShop(db: Tx, scope: CityScope, shopId: string, forUpdate = false) {
  const q = db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  const [row] = forUpdate ? await q.for('update') : await q;
  if (!row || (!scope.all && !scope.cityIds.includes(row.cityId))) throw new NotFoundError('Shop not found');
  return row;
}

export async function getAdminShop(db: Tx, scope: CityScope, shopId: string): Promise<AdminShopDetail> {
  const shop = await scopedShop(db, scope, shopId);
  const [row] = rowsOf<ShopSqlRow>(
    await db.execute(sql`select ${ROW_COLUMNS} from shops s where s.id = ${shopId}`),
  );
  if (!row) throw new NotFoundError('Shop not found');
  const coverage = await db
    .select({
      pincode: shopPincodes.pincode,
      shippingPaise: shopPincodes.shippingPaise,
      leadDays: shopPincodes.leadDays,
      active: shopPincodes.active,
    })
    .from(shopPincodes)
    .where(eq(shopPincodes.shopId, shopId))
    .orderBy(asc(shopPincodes.pincode));
  const history = await db
    .select()
    .from(partnerStatusEvents)
    .where(and(eq(partnerStatusEvents.partnerKind, 'shop'), eq(partnerStatusEvents.partnerId, shopId)))
    .orderBy(desc(partnerStatusEvents.createdAt), desc(partnerStatusEvents.id))
    .limit(20);
  const members = await db
    .select({ userId: userRoles.userId, role: roles.key, phone: users.phone })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.shopId, shopId), inArray(roles.key, ['seller_owner', 'seller_staff'])))
    .orderBy(asc(roles.key), asc(userRoles.createdAt));
  const current = history[0];
  return {
    ...toRow(row),
    legalName: shop.legalName,
    gstin: shop.gstin,
    phone: shop.phone,
    email: shop.email,
    acceptanceTimeoutMin: shop.acceptanceTimeoutMin,
    statusReason: shop.status === 'paused' || shop.status === 'suspended' ? shop.statusReason : null,
    statusReasonCode:
      (shop.status === 'paused' || shop.status === 'suspended') && current?.toStatus === shop.status
        ? reasonOf(current.reasonCode)
        : null,
    statusChangedAt: shop.statusChangedAt?.toISOString() ?? null,
    pausedUntil: shop.pausedUntil?.toISOString() ?? null,
    coverage,
    history: history.map((h) => ({
      from: h.fromStatus,
      to: h.toStatus,
      reasonCode: reasonOf(h.reasonCode),
      reason: h.reason,
      endsAt: h.endsAt?.toISOString() ?? null,
      at: h.createdAt.toISOString(),
    })),
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role === 'seller_owner' ? 'seller_owner' : 'seller_staff',
      phoneLast4: m.phone ? m.phone.slice(-4) : null,
    })),
  };
}

export interface ShopProfilePatch {
  name?: string;
  nameHi?: string | null;
  legalName?: string | null;
  addressLine?: string;
  addressLineHi?: string | null;
  phone?: string;
  email?: string | null;
  gstin?: string;
  acceptanceTimeoutMin?: number | null;
  freeDeliveryMinPaise?: number | null;
  hours?: ShopHours;
}

/**
 * Edit a shop's profile: only the fields sent, compare-and-set on `version`. A GSTIN change is an approval (it
 * makes an enrolled shop a registered one, which can be priced and routed): it needs `partners:approve` covering
 * the shop's city, a valid GSTIN (checksum) and the shop's state code (invoices).
 */
export async function updateShopProfile(
  db: Tx,
  input: {
    scope: CityScope;
    approveScope: CityScope;
    staffUserId: string;
    shopId: string;
    expectedVersion: number;
    patch: ShopProfilePatch;
    /** For the duplicate check against seller applications (blind index); null in development. */
    keyring?: Keyring | null;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const cur = await scopedShop(tx, input.scope, input.shopId, true);
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(input.patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(set).length === 0) throw new ValidationError('Nothing to change', 'EMPTY_PATCH');
    if (input.patch.hours !== undefined && !isShopHours(input.patch.hours))
      throw new ValidationError('Opening hours: one window, close after open, weekdays 0–6', 'HOURS_INVALID');
    if (input.patch.gstin !== undefined) {
      const a = input.approveScope;
      if (!a.all && !a.cityIds.includes(cur.cityId))
        throw new ForbiddenError("Changing a shop's GSTIN needs approval rights in its city");
      if (!isGstin(input.patch.gstin)) throw new ValidationError('This GSTIN is not valid', 'GSTIN_INVALID');
      const [st] = await tx
        .select({ code: states.gstStateCode })
        .from(states)
        .where(eq(states.id, cur.stateId));
      if (st && gstinStateCode(input.patch.gstin) !== st.code)
        throw new ValidationError("This GSTIN belongs to another state than the shop's", 'GSTIN_STATE');
      if (await gstinHeldElsewhere(tx, input.patch.gstin, input.keyring ?? null, cur.id))
        throw new ConflictError('Another shop or seller application already has this GSTIN', 'GSTIN_TAKEN');
      set.gstStatus = 'registered';
    }
    const [row] = await tx
      .update(shops)
      .set(set)
      .where(and(eq(shops.id, cur.id), eq(shops.version, input.expectedVersion)))
      .returning({ version: shops.version });
    if (!row) throw new ConflictError('This shop changed meanwhile; reload and try again', 'STALE_SHOP');
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, cur[k as keyof typeof cur] ?? null]));
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'shop.updated',
      entity: 'shop',
      entityId: cur.id,
      before,
      after: set,
    });
    await recordServerEvent(tx, 'admin_shop_updated', {
      userId: input.staffUserId,
      cityId: cur.cityId,
      props: {
        shopId: cur.id,
        fields: Object.keys(input.patch)
          .filter((k) => set[k] !== undefined)
          .sort(),
      },
    });
    return row;
  });
}

/**
 * Delivery coverage: add or change PIN codes (charge in paise, lead days, on/off) and remove others, in one
 * compare-and-set on the shop's `version` so two staff edits never interleave. PIN codes must belong to the shop's
 * city (a shop in another city is a different shop, spec 15). A pending shop may go live afterwards.
 */
export async function setShopCoverage(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    shopId: string;
    expectedVersion: number;
    upsert: readonly ShopCoverageRow[];
    remove: readonly string[];
  },
): Promise<{ version: number }> {
  const pins = input.upsert.map((u) => u.pincode);
  if (new Set([...pins, ...input.remove]).size !== pins.length + input.remove.length)
    throw new ValidationError('Each PIN code appears once', 'DUPLICATE_PINCODE');
  if (pins.length + input.remove.length === 0) throw new ValidationError('Nothing to change', 'EMPTY_PATCH');
  for (const u of input.upsert)
    if (
      !Number.isSafeInteger(u.shippingPaise) ||
      u.shippingPaise < 0 ||
      u.shippingPaise > 1_000_000 ||
      !Number.isInteger(u.leadDays) ||
      u.leadDays < 0 ||
      u.leadDays > 60
    )
      throw new ValidationError('Delivery charge 0 to ₹10,000 and 0 to 60 days', 'COVERAGE_INVALID');
  return db.transaction(async (tx) => {
    const cur = await scopedShop(tx, input.scope, input.shopId, true);
    if (pins.length > 0) {
      const known = await tx
        .select({ pincode: pincodes.pincode, cityId: pincodes.cityId })
        .from(pincodes)
        .where(inArray(pincodes.pincode, pins));
      for (const p of pins) {
        const k = known.find((x) => x.pincode === p);
        if (!k)
          throw new ValidationError(`PIN code ${p} is not in MechDost`, 'PINCODE_UNKNOWN', { pincode: p });
        if (k.cityId !== cur.cityId)
          throw new ValidationError(`PIN code ${p} is in another city`, 'PINCODE_OTHER_CITY', { pincode: p });
      }
    }
    // The shop row carries the version for its coverage (shop_pincodes has none); the trigger bumps it.
    const [bumped] = await tx
      .update(shops)
      .set({ version: sql`${shops.version}` })
      .where(and(eq(shops.id, cur.id), eq(shops.version, input.expectedVersion)))
      .returning({ version: shops.version });
    if (!bumped) throw new ConflictError('This shop changed meanwhile; reload and try again', 'STALE_SHOP');

    const before = await tx.select().from(shopPincodes).where(eq(shopPincodes.shopId, cur.id));
    for (const u of input.upsert)
      await tx
        .insert(shopPincodes)
        .values({ shopId: cur.id, ...u })
        .onConflictDoUpdate({
          target: [shopPincodes.shopId, shopPincodes.pincode],
          set: { shippingPaise: u.shippingPaise, leadDays: u.leadDays, active: u.active },
        });
    if (input.remove.length > 0)
      await tx
        .delete(shopPincodes)
        .where(and(eq(shopPincodes.shopId, cur.id), inArray(shopPincodes.pincode, [...input.remove])));
    const had = new Set(before.map((b) => b.pincode));
    const removed = input.remove.filter((p) => had.has(p)).length;
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'shop.coverage_changed',
      entity: 'shop',
      entityId: cur.id,
      before: { coverage: before.map(({ shopId: _s, ...r }) => r) },
      after: { upsert: input.upsert, remove: input.remove },
    });
    await recordServerEvent(tx, 'admin_shop_coverage_changed', {
      userId: input.staffUserId,
      cityId: cur.cityId,
      props: {
        shopId: cur.id,
        added: pins.filter((p) => !had.has(p)).length,
        changed: pins.filter((p) => had.has(p)).length,
        removed,
      },
    });
    await maybeGoLive(tx, cur.id, input.staffUserId, 'staff');
    const [after] = await tx.select({ version: shops.version }).from(shops).where(eq(shops.id, cur.id));
    return { version: after?.version ?? bumped.version };
  });
}

/**
 * Portal access for a person who already signed up (found by phone): the shop role (what the API authorises) and
 * the `shop_users` membership (who gets live pings). Staff accounts are refused (one person, one side). Idempotent.
 */
export async function addShopMember(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; shopId: string; phone: string; role: ShopMemberRole },
): Promise<{ userId: string }> {
  const shop = await scopedShop(db, input.scope, input.shopId);
  const account = await findPasswordAccount(db, { kind: 'phone', value: input.phone });
  if (!account) throw new NotFoundError('No account uses this phone number; the person signs up first');
  if (account.status !== 'active')
    throw new ConflictError('This account is not active', 'ACCOUNT_NOT_ACTIVE');
  if (account.staff)
    throw new ConflictError('This is a MechDost staff account; use a separate account', 'MEMBER_IS_STAFF');
  await db.transaction(async (tx) => {
    if (input.role === 'seller_staff') {
      const [owner] = await tx
        .select({ role: shopUsers.role })
        .from(shopUsers)
        .where(and(eq(shopUsers.shopId, shop.id), eq(shopUsers.userId, account.userId)));
      const owns = await tx
        .select({ id: userRoles.id })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(userRoles.shopId, shop.id),
            eq(userRoles.userId, account.userId),
            eq(roles.key, 'seller_owner'),
          ),
        )
        .limit(1);
      if (owner?.role === 'owner' || owns.length > 0)
        throw new ConflictError('This person already owns the shop', 'ALREADY_OWNER');
    }
    await grantRole(tx, {
      userId: account.userId,
      role: input.role,
      shopId: shop.id,
      grantedBy: input.staffUserId,
      reason: 'shop member added by staff',
    });
    const role = input.role === 'seller_owner' ? 'owner' : 'staff';
    await tx
      .insert(shopUsers)
      .values({ shopId: shop.id, userId: account.userId, role })
      .onConflictDoUpdate({ target: [shopUsers.shopId, shopUsers.userId], set: { role } });
    await recordServerEvent(tx, 'admin_shop_member_added', {
      userId: input.staffUserId,
      cityId: shop.cityId,
      props: { shopId: shop.id, role: input.role },
    });
  });
  return { userId: account.userId };
}

export interface MyShop {
  id: string;
  name: string;
  nameHi: string | null;
  addressLine: string;
  addressLineHi: string | null;
  pincode: string;
  status: ShopStatus;
  /** Why the shop is paused or suspended (code + the note staff wrote), and when a pause ends; null when live. */
  standing: {
    reasonCode: PartnerStandingReason | null;
    note: string | null;
    until: string | null;
    since: string | null;
  } | null;
  busy: boolean;
  coverage: { pincodes: number; minShippingPaise: number | null; maxShippingPaise: number | null };
  freeDeliveryMinPaise: number | null;
  hours: ShopHours;
  openNow: boolean;
  /** The shop row's version (the owner's hours edit sends it back). */
  version: number;
  offersOnSale: number;
  /** Last 30 days of offers: accepted / answered (accepted + declined + timed out). */
  offers30d: { accepted: number; answered: number };
}

/** The signed-in shop's own profile(s): the ids come from the caller's grants (never from the request). */
export async function getMyShops(db: Tx, shopIds: readonly string[]): Promise<MyShop[]> {
  if (shopIds.length === 0) return [];
  const rows = rowsOf<{
    id: string;
    name: string;
    name_hi: string | null;
    address_line: string;
    address_line_hi: string | null;
    pincode: string;
    status: ShopStatus;
    status_reason: string | null;
    paused_until: string | null;
    status_changed_at: string | null;
    reason_code: PartnerStandingReason | null;
    busy: boolean;
    coverage: unknown;
    min_ship: unknown;
    max_ship: unknown;
    free_delivery_min_paise: unknown;
    on_sale: unknown;
    accepted: unknown;
    answered: unknown;
    hours: unknown;
    version: unknown;
  }>(
    await db.execute(sql`select s.id, s.name, s.name_hi, s.address_line, s.address_line_hi, s.pincode, s.status,
        s.status_reason, to_char(s.paused_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as paused_until,
        to_char(s.status_changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as status_changed_at,
        (select e.reason_code from partner_status_events e where e.partner_kind = 'shop' and e.partner_id = s.id
           and e.to_status = s.status order by e.created_at desc, e.id desc limit 1) as reason_code,
        (s.busy and (s.busy_until is null or s.busy_until > now())) as busy,
        cov.n as coverage, cov.min_ship, cov.max_ship, s.free_delivery_min_paise,
        (select count(*) from shop_inventory si where si.shop_id = s.id and si.active and not si.admin_blocked)::int
          as on_sale,
        st.accepted, st.answered, s.hours, s.version
      from shops s
      left join lateral (select count(*)::int as n, min(sp.shipping_paise) as min_ship, max(sp.shipping_paise) as max_ship
        from shop_pincodes sp join pincodes pc on pc.pincode = sp.pincode and pc.active
        where sp.shop_id = s.id and sp.active) cov on true
      left join lateral (select count(*) filter (where a.status = 'accepted')::int as accepted,
          count(*) filter (where a.status in ('accepted', 'declined', 'expired'))::int as answered
        from order_assignments a where a.shop_id = s.id and a.offered_at > now() - interval '30 days') st on true
      where s.id in (${sql.join(
        shopIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      order by s.name, s.id`),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameHi: r.name_hi,
    addressLine: r.address_line,
    addressLineHi: r.address_line_hi,
    pincode: r.pincode,
    status: r.status,
    standing:
      r.status === 'paused' || r.status === 'suspended'
        ? {
            reasonCode: r.reason_code,
            note: r.status_reason,
            until: r.status === 'paused' ? r.paused_until : null,
            since: r.status_changed_at,
          }
        : null,
    busy: r.busy,
    coverage: {
      pincodes: num(r.coverage),
      minShippingPaise: numOrNull(r.min_ship),
      maxShippingPaise: numOrNull(r.max_ship),
    },
    freeDeliveryMinPaise: numOrNull(r.free_delivery_min_paise),
    hours: hoursOf(r.hours),
    openNow: shopOpenState(hoursOf(r.hours), new Date()).open,
    version: num(r.version),
    offersOnSale: num(r.on_sale),
    offers30d: { accepted: num(r.accepted ?? 0), answered: num(r.answered ?? 0) },
  }));
}

/**
 * The shop owner sets their own working hours (user 2026-11-14: "each seller individually configures it"). The
 * API checks the caller owns this shop; compare-and-set on the shop's `version`, audited as the shop.
 */
export async function setOwnShopHours(
  db: Tx,
  input: { shopId: string; userId: string; expectedVersion: number; hours: ShopHours },
): Promise<{ version: number }> {
  if (!isShopHours(input.hours))
    throw new ValidationError('Opening hours: one window, close after open, weekdays 0–6', 'HOURS_INVALID');
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ hours: shops.hours, cityId: shops.cityId })
      .from(shops)
      .where(eq(shops.id, input.shopId));
    if (!cur) throw new NotFoundError('Shop not found');
    const [row] = await tx
      .update(shops)
      .set({ hours: input.hours })
      .where(and(eq(shops.id, input.shopId), eq(shops.version, input.expectedVersion)))
      .returning({ version: shops.version });
    if (!row) throw new ConflictError('This shop changed meanwhile; reload and try again', 'STALE_SHOP');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: 'shop.hours_changed',
      entity: 'shop',
      entityId: input.shopId,
      before: { hours: cur.hours },
      after: { hours: input.hours },
    });
    await recordServerEvent(tx, 'shop_hours_changed', {
      userId: input.userId,
      cityId: cur.cityId,
      props: { shopId: input.shopId, days: input.hours.days.length, by: 'shop' },
    });
    return row;
  });
}
