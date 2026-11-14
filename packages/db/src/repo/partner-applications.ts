import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import {
  APPLICATION_REJECT_REASONS,
  SellerApplicationSchema,
  type SellerApplication,
} from '@mechdost/shared/partners';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { applicationMachine, type ApplicationStatus } from '@mechdost/shared/state';
import { blindIndex, decryptField, encryptField, type Keyring } from '../crypto';
import {
  auditLog,
  partnerApplicationProducts,
  partnerApplications,
  partnerInvites,
  pincodes,
  products,
  shopPincodes,
  shopUsers,
  shops,
} from '../schema';
import { queueApplicationEmail } from './email-events';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { queueStaffNotice } from './notices';
import { findOpenInvite } from './partner-invites';
import type { Tx } from './orders';
import { grantRole } from './rbac';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * Seller applications (design 2026-11-13): public form or invite link → review (or pre-approved by an invite) →
 * a `pending` shop with its delivery area. The GSTIN or enrolment number lives only in `kyc_enc`; `gstin_index`
 * (a blind index) finds duplicates without decrypting.
 */
const KYC_AAD = 'partner_applications.kyc_enc';
const GSTIN_PURPOSE = 'gstin';

export interface CoverageInput {
  pincode: string;
  shippingPaise: number;
  leadDays: number;
}

type SubmitInput =
  | { application: SellerApplication; source: 'public'; keyring: Keyring }
  | { application: SellerApplication; source: 'invite'; inviteToken: string; keyring: Keyring };

export async function submitSellerApplication(
  db: Tx,
  input: SubmitInput,
): Promise<{ code: string; status: ApplicationStatus }> {
  const parsed = SellerApplicationSchema.safeParse(input.application);
  if (!parsed.success) throw new ValidationError('Check the application', 'APPLICATION_INVALID');
  const app = parsed.data;
  return db.transaction(async (tx) => {
    const [place] = rowsOf<{ city_id: string; code: string }>(
      await tx.execute(sql`select c.id as city_id, c.code from pincodes p join cities c on c.id = p.city_id
        where p.pincode = ${app.pincode}`),
    );
    if (!place) throw new ValidationError('We do not serve this PIN code yet', 'PINCODE_NOT_SERVED');
    const found = await tx
      .select({ id: products.id, slug: products.slug })
      .from(products)
      .where(and(inArray(products.slug, app.productSlugs), eq(products.status, 'live')));
    if (found.length !== app.productSlugs.length)
      throw new ValidationError('Some products are not in the catalogue', 'PRODUCTS');

    const gstinIndex = blindIndex(app.gstNumber, input.keyring, GSTIN_PURPOSE);
    const duplicate = await isDuplicateGstin(tx, gstinIndex, app.gstNumber, null);

    let status: ApplicationStatus = 'new';
    let inviteId: string | null = null;
    let reviewedBy: string | null = null;
    let contacts = { name: app.name, email: app.email, phone: app.phone };
    if (input.source === 'invite') {
      const invite = await findOpenInvite(tx, input.inviteToken, true);
      if (invite.cityId !== place.city_id)
        throw new ValidationError('This invite is for another city', 'INVITE_CITY');
      // The invite proves these contacts (design: pre-verified); the form cannot change them (final review).
      contacts = { name: invite.name, email: invite.email, phone: invite.phone };
      const used = await tx
        .update(partnerInvites)
        .set({ status: 'used', usedAt: sql`now()` })
        .where(and(eq(partnerInvites.id, invite.id), eq(partnerInvites.status, 'sent')))
        .returning({ createdBy: partnerInvites.createdBy });
      if (used.length === 0) throw new ConflictError('This invite has already been used', 'INVITE_USED');
      inviteId = invite.id;
      // Pre-approved by the inviting admin, unless the GSTIN is already known (then a person looks at it).
      if (!duplicate) {
        status = 'approved';
        reviewedBy = used[0]?.createdBy ?? null;
      }
    }

    const code = publicCode('PA', place.code);
    const [row] = await tx
      .insert(partnerApplications)
      .values({
        code,
        kind: 'seller',
        name: contacts.name,
        phone: contacts.phone,
        email: contacts.email,
        business: app.businessName,
        shopName: app.shopName,
        shopNameHi: app.shopNameHi ?? null,
        pincode: app.pincode,
        kycEnc: encryptField(JSON.stringify({ gstNumber: app.gstNumber }), input.keyring, KYC_AAD),
        gstStatus: app.gstStatus,
        gstinIndex,
        addressLine: app.addressLine,
        landmark: app.landmark ?? null,
        location: { lng: app.location.lng, lat: app.location.lat },
        locationAccuracyM: app.location.accuracyM,
        locationSource: app.location.source,
        source: input.source,
        inviteId,
        status,
        reviewedBy,
        consentAt: new Date(),
      })
      .returning({ id: partnerApplications.id, version: partnerApplications.version });
    if (!row) throw new Error('application insert returned no row');
    await tx
      .insert(partnerApplicationProducts)
      .values(found.map((p) => ({ applicationId: row.id, productId: p.id })));
    await tx.insert(auditLog).values({
      actorUserId: reviewedBy,
      actorRole: input.source === 'invite' ? 'system' : 'guest',
      action: 'partner_application.submitted',
      entity: 'partner_application',
      entityId: row.id,
      after: { code, source: input.source, status, products: found.length, duplicateGstin: duplicate },
    });
    await recordServerEvent(tx, 'partner_application_submitted', {
      cityId: place.city_id,
      props: {
        kind: 'seller',
        source: input.source,
        gstStatus: app.gstStatus,
        products: found.length,
        locationSource: app.location.source,
      },
    });
    // Staff who review applications in this city get a bell notice; an invited applicant is already approved.
    if (status !== 'approved')
      await queueStaffNotice(tx, {
        kind: 'staff.new_application',
        cityId: place.city_id,
        entityId: row.id,
        version: 1,
      });
    if (status === 'approved') {
      // The invite stood in for the review: the shop starts with its city's PIN codes at the default charge.
      const coverage = await defaultCoverage(tx, app.pincode);
      const shopId = await createShop(tx, {
        applicationId: row.id,
        staffUserId: reviewedBy,
        coverage,
        keyring: input.keyring,
      });
      await tx
        .update(partnerApplications)
        .set({ convertedShopId: shopId })
        .where(eq(partnerApplications.id, row.id));
    }
    // Email the applicant only when the address came from an admin's invite ("approved": the invite stood in for
    // the review). A public form's address is unverified and typed by anyone, so mailing it would make us a spam /
    // phishing relay (security review 2026-11-15); public applicants keep the reference shown on screen.
    if (input.source === 'invite')
      await queueApplicationEmail(tx, {
        template: status === 'approved' ? 'application_approved' : 'application_received',
        applicationId: row.id,
        version: row.version,
        name: contacts.name,
        email: contacts.email,
        code,
      });
    return { code, status };
  });
}

/**
 * A GSTIN staff want to set on a shop is already held by another shop, or by a seller application that is not this
 * shop's own and not rejected (code review 2026-11-14). Without a keyring (development) only shops are checked.
 */
export async function gstinHeldElsewhere(
  tx: Tx,
  gstin: string,
  keyring: Keyring | null,
  shopId: string,
): Promise<boolean> {
  const [shop] = await tx
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.gstin, gstin), sql`${shops.id} <> ${shopId}`))
    .limit(1);
  if (shop) return true;
  if (!keyring) return false;
  const [app] = await tx
    .select({ id: partnerApplications.id })
    .from(partnerApplications)
    .where(
      and(
        eq(partnerApplications.gstinIndex, blindIndex(gstin, keyring, GSTIN_PURPOSE)),
        sql`${partnerApplications.status} <> 'rejected'`,
        sql`${partnerApplications.convertedShopId} is distinct from ${shopId}::uuid`,
      ),
    )
    .limit(1);
  return app !== undefined;
}

/** Another application or a shop already has this GSTIN or enrolment number. */
async function isDuplicateGstin(
  tx: Tx,
  index: string,
  gstNumber: string,
  exceptId: string | null,
): Promise<boolean> {
  const [app] = await tx
    .select({ id: partnerApplications.id })
    .from(partnerApplications)
    .where(
      and(
        eq(partnerApplications.gstinIndex, index),
        exceptId ? sql`${partnerApplications.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (app) return true;
  const [shop] = await tx.select({ id: shops.id }).from(shops).where(eq(shops.gstin, gstNumber)).limit(1);
  return shop !== undefined;
}

/** The city's active PIN codes with the default delivery charge and days (admin settings). */
export async function defaultCoverage(tx: Tx, pincode: string): Promise<CoverageInput[]> {
  const [home] = await tx
    .select({ cityId: pincodes.cityId })
    .from(pincodes)
    .where(eq(pincodes.pincode, pincode));
  if (!home?.cityId) return [];
  const pins = await tx
    .select({ pincode: pincodes.pincode })
    .from(pincodes)
    .where(and(eq(pincodes.cityId, home.cityId), eq(pincodes.active, true)))
    .orderBy(pincodes.pincode);
  const shipping = await globalInt(tx, 'partners.default_shipping_paise');
  const lead = await globalInt(tx, 'partners.default_lead_days');
  return pins.map((p) => ({ pincode: p.pincode, shippingPaise: shipping, leadDays: lead }));
}

async function globalInt(tx: Tx, key: 'partners.default_shipping_paise' | 'partners.default_lead_days') {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(sql`select value from settings where key = ${key} and city_id is null limit 1`),
  );
  const s = OPERATIONAL_SETTINGS[key];
  const v = row?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= s.min && v <= s.max ? v : s.default;
}

function checkCoverage(coverage: readonly CoverageInput[]) {
  if (coverage.length === 0 || coverage.length > 500)
    throw new ValidationError('Choose the PIN codes this shop delivers to', 'COVERAGE');
  const seen = new Set<string>();
  for (const c of coverage) {
    if (!/^[1-9][0-9]{5}$/.test(c.pincode) || seen.has(c.pincode))
      throw new ValidationError('Check the PIN codes', 'COVERAGE');
    seen.add(c.pincode);
    if (!Number.isInteger(c.shippingPaise) || c.shippingPaise < 0 || c.shippingPaise > 50_000)
      throw new ValidationError('Delivery charge must be ₹0 to ₹500', 'COVERAGE');
    if (!Number.isInteger(c.leadDays) || c.leadDays < 0 || c.leadDays > 14)
      throw new ValidationError('Delivery days must be 0 to 14', 'COVERAGE');
  }
}

/** Create the `pending` shop and its delivery area from an approved application. */
async function createShop(
  tx: Tx,
  input: {
    applicationId: string;
    staffUserId: string | null;
    coverage: readonly CoverageInput[];
    keyring: Keyring;
  },
): Promise<string> {
  checkCoverage(input.coverage);
  const [a] = rowsOf<{
    shop_name: string;
    shop_name_hi: string | null;
    business: string | null;
    phone: string;
    email: string | null;
    address_line: string;
    pincode: string;
    gst_status: string;
    kyc_enc: string;
    lng: number;
    lat: number;
    city_id: string;
    state_id: string;
  }>(
    await tx.execute(sql`select a.shop_name, a.shop_name_hi, a.business, a.phone, a.email, a.address_line, a.pincode,
        a.gst_status, a.kyc_enc, ST_X(a.location::geometry) as lng, ST_Y(a.location::geometry) as lat,
        p.city_id, p.state_id
      from partner_applications a join pincodes p on p.pincode = a.pincode where a.id = ${input.applicationId}`),
  );
  if (!a) throw new NotFoundError('Application not found');
  const pins = await tx
    .select({ pincode: pincodes.pincode })
    .from(pincodes)
    .where(
      and(
        inArray(
          pincodes.pincode,
          input.coverage.map((c) => c.pincode),
        ),
        // A shop can only be given active PIN codes (spec 15 "PIN codes").
        eq(pincodes.active, true),
      ),
    );
  if (pins.length !== input.coverage.length)
    throw new ValidationError('Some PIN codes are not served yet', 'COVERAGE');
  const { gstNumber } = JSON.parse(decryptField(a.kyc_enc, input.keyring, KYC_AAD)) as { gstNumber: string };
  const [shop] = await tx
    .insert(shops)
    .values({
      name: a.shop_name,
      nameHi: a.shop_name_hi,
      legalName: a.business,
      // A GSTIN is printed on every tax invoice, so the shop keeps it in clear; an enrolment number is not.
      gstin: a.gst_status === 'registered' ? gstNumber : null,
      gstStatus: a.gst_status,
      phone: a.phone,
      email: a.email,
      addressLine: a.address_line,
      pincode: a.pincode,
      cityId: a.city_id,
      stateId: a.state_id,
      location: { lng: num(a.lng), lat: num(a.lat) },
      status: 'pending',
    })
    .returning({ id: shops.id });
  if (!shop) throw new Error('shop insert returned no row');
  await tx.insert(shopPincodes).values(
    input.coverage.map((c) => ({
      shopId: shop.id,
      pincode: c.pincode,
      shippingPaise: c.shippingPaise,
      leadDays: c.leadDays,
    })),
  );
  await tx.insert(auditLog).values({
    actorUserId: input.staffUserId,
    actorRole: input.staffUserId ? 'staff' : 'system',
    action: 'shop.created_from_application',
    entity: 'shop',
    entityId: shop.id,
    after: { applicationId: input.applicationId, pincodes: input.coverage.length },
  });
  return shop.id;
}

async function lockApplication(tx: Tx, scope: CityScope, code: string) {
  const [row] = rowsOf<{
    id: string;
    status: ApplicationStatus;
    version: number;
    city_id: string;
    kind: string;
  }>(
    await tx.execute(sql`select a.id, a.status, a.version, p.city_id, a.kind from partner_applications a
      join pincodes p on p.pincode = a.pincode where a.code = ${code} for update of a`),
  );
  if (!row || (!scope.all && !scope.cityIds.includes(row.city_id)))
    throw new NotFoundError('Application not found');
  return { ...row, version: num(row.version) };
}

export async function approveApplication(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    expectedVersion: number;
    staffUserId: string;
    coverage: readonly CoverageInput[];
    keyring: Keyring;
  },
): Promise<{ shopId: string }> {
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, input.scope, input.code);
    if (app.kind !== 'seller')
      throw new ConflictError('Only seller applications create shops', 'NOT_A_SELLER');
    applicationMachine.assert(app.status, 'approved', 'admin');
    if (app.version !== input.expectedVersion)
      throw new ConflictError('Someone else changed this application; reload', 'STALE_APPLICATION');
    const shopId = await createShop(tx, {
      applicationId: app.id,
      staffUserId: input.staffUserId,
      coverage: input.coverage,
      keyring: input.keyring,
    });
    await decide(tx, app, 'approved', input.staffUserId, null, null, shopId);
    return { shopId };
  });
}

export async function rejectApplication(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    expectedVersion: number;
    staffUserId: string;
    reasonCode: (typeof APPLICATION_REJECT_REASONS)[number];
    note?: string | null;
  },
): Promise<void> {
  if (!(APPLICATION_REJECT_REASONS as readonly string[]).includes(input.reasonCode))
    throw new ValidationError('Choose a reason', 'REASON_CODE');
  await db.transaction(async (tx) => {
    const app = await lockApplication(tx, input.scope, input.code);
    applicationMachine.assert(app.status, 'rejected', 'admin');
    if (app.version !== input.expectedVersion)
      throw new ConflictError('Someone else changed this application; reload', 'STALE_APPLICATION');
    await decide(tx, app, 'rejected', input.staffUserId, input.reasonCode, input.note ?? null);
  });
}

async function decide(
  tx: Tx,
  app: { id: string; status: ApplicationStatus; version: number; city_id: string },
  to: 'approved' | 'rejected',
  staffUserId: string,
  reasonCode: string | null,
  note: string | null = null,
  convertedShopId: string | null = null,
) {
  const updated = await tx
    .update(partnerApplications)
    .set({
      status: to,
      reviewedBy: staffUserId,
      reasonCode,
      reviewNote: note,
      ...(convertedShopId ? { convertedShopId } : {}),
    })
    .where(
      and(
        eq(partnerApplications.id, app.id),
        eq(partnerApplications.status, app.status),
        eq(partnerApplications.version, app.version),
      ),
    )
    .returning({ id: partnerApplications.id });
  if (updated.length === 0)
    throw new ConflictError('Someone else changed this application; reload', 'STALE_APPLICATION');
  await tx.insert(auditLog).values({
    actorUserId: staffUserId,
    actorRole: 'staff',
    action: `partner_application.${to}`,
    entity: 'partner_application',
    entityId: app.id,
    before: { status: app.status },
    after: { status: to, reasonCode },
  });
  await recordServerEvent(tx, 'partner_application_decided', {
    userId: staffUserId,
    cityId: app.city_id,
    props: { decision: to, reasonCode },
  });
  // Email the applicant the decision (spec 10): approved with the way in, rejected with the reason in plain words.
  const [who] = await tx
    .select({
      name: partnerApplications.name,
      email: partnerApplications.email,
      code: partnerApplications.code,
      version: partnerApplications.version,
    })
    .from(partnerApplications)
    .where(eq(partnerApplications.id, app.id))
    .limit(1);
  if (who)
    await queueApplicationEmail(tx, {
      template: to === 'approved' ? 'application_approved' : 'application_rejected',
      applicationId: app.id,
      version: who.version,
      name: who.name,
      email: who.email,
      code: who.code,
      reasonCode,
    });
}

export interface ApplicationDetail {
  code: string;
  status: ApplicationStatus;
  version: number;
  source: string;
  name: string;
  phone: string;
  email: string | null;
  businessName: string | null;
  shopName: string | null;
  gstStatus: string | null;
  gstNumber: string | null;
  duplicateGstin: boolean;
  addressLine: string | null;
  landmark: string | null;
  pincode: string;
  location: { lat: number; lng: number; accuracyM: number | null; source: string | null } | null;
  products: number;
  productSlugs: string[];
  reasonCode: string | null;
  createdAt: string;
}

/** One application for staff (the GST number is decrypted for `applications:review` callers only). */
export async function getApplication(
  db: Tx,
  scope: CityScope,
  code: string,
  keyring: Keyring,
): Promise<ApplicationDetail> {
  const [a] = rowsOf<{
    id: string;
    code: string;
    status: ApplicationStatus;
    version: unknown;
    source: string;
    name: string;
    phone: string;
    email: string | null;
    business: string | null;
    shop_name: string | null;
    gst_status: string | null;
    kyc_enc: string | null;
    gstin_index: string | null;
    address_line: string | null;
    landmark: string | null;
    pincode: string;
    lat: number | null;
    lng: number | null;
    location_accuracy_m: number | null;
    location_source: string | null;
    reason_code: string | null;
    created_at: string;
    city_id: string;
  }>(
    await db.execute(sql`select a.*, ST_Y(a.location::geometry) as lat, ST_X(a.location::geometry) as lng, p.city_id
      from partner_applications a join pincodes p on p.pincode = a.pincode where a.code = ${code}`),
  );
  if (!a || (!scope.all && !scope.cityIds.includes(a.city_id)))
    throw new NotFoundError('Application not found');
  const gstNumber = a.kyc_enc
    ? ((JSON.parse(decryptField(a.kyc_enc, keyring, KYC_AAD)) as { gstNumber?: string }).gstNumber ?? null)
    : null;
  const slugs = await db
    .select({ slug: products.slug })
    .from(partnerApplicationProducts)
    .innerJoin(products, eq(products.id, partnerApplicationProducts.productId))
    .where(eq(partnerApplicationProducts.applicationId, a.id));
  return {
    code: a.code,
    status: a.status,
    version: num(a.version),
    source: a.source,
    name: a.name,
    phone: a.phone,
    email: a.email,
    businessName: a.business,
    shopName: a.shop_name,
    gstStatus: a.gst_status,
    gstNumber,
    duplicateGstin:
      a.gstin_index !== null &&
      gstNumber !== null &&
      (await isDuplicateGstin(db, a.gstin_index, gstNumber, a.id)),
    addressLine: a.address_line,
    landmark: a.landmark,
    pincode: a.pincode,
    location:
      a.lat === null || a.lng === null
        ? null
        : { lat: num(a.lat), lng: num(a.lng), accuracyM: a.location_accuracy_m, source: a.location_source },
    products: slugs.length,
    productSlugs: slugs.map((s) => s.slug).sort(),
    reasonCode: a.reason_code,
    createdAt: new Date(a.created_at).toISOString(),
  };
}

/** Applications in the staff member's cities, newest first (keyset on created_at, id). */
export async function listApplications(
  db: Tx,
  scope: CityScope,
  opts: {
    status?: ApplicationStatus | null;
    before?: { createdAt: string; id: string } | null;
    limit?: number;
  },
) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await db
    .select({
      id: partnerApplications.id,
      code: partnerApplications.code,
      kind: partnerApplications.kind,
      status: partnerApplications.status,
      source: partnerApplications.source,
      name: partnerApplications.name,
      shopName: partnerApplications.shopName,
      pincode: partnerApplications.pincode,
      gstStatus: partnerApplications.gstStatus,
      createdAt: partnerApplications.createdAt,
      cityId: pincodes.cityId,
    })
    .from(partnerApplications)
    .innerJoin(pincodes, eq(pincodes.pincode, partnerApplications.pincode))
    .where(
      and(
        scope.all
          ? undefined
          : inArray(
              pincodes.cityId,
              scope.cityIds.length ? scope.cityIds : ['00000000-0000-0000-0000-000000000000'],
            ),
        opts.status ? eq(partnerApplications.status, opts.status) : undefined,
        opts.before
          ? or(
              lt(partnerApplications.createdAt, new Date(opts.before.createdAt)),
              and(
                eq(partnerApplications.createdAt, new Date(opts.before.createdAt)),
                lt(partnerApplications.id, opts.before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(partnerApplications.createdAt), desc(partnerApplications.id))
    .limit(limit + 1);
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

/**
 * On sign-in: an applicant whose seller application was approved becomes the owner of its shop (once). Returns
 * how many shops were linked. The phone was proved by OTP at sign-in (Q78), so the match is safe.
 */
export async function linkApplicantOwner(db: Tx, input: { userId: string; phone: string }): Promise<number> {
  return db.transaction(async (tx) => {
    // Claimed once (owner_user_id): a removed owner is never granted again by signing in (security review).
    const claimed = await tx
      .update(partnerApplications)
      .set({ ownerUserId: input.userId })
      .where(
        and(
          eq(partnerApplications.phone, input.phone),
          eq(partnerApplications.status, 'approved'),
          sql`${partnerApplications.convertedShopId} is not null`,
          sql`${partnerApplications.ownerUserId} is null`,
        ),
      )
      .returning({ shopId: partnerApplications.convertedShopId, reviewedBy: partnerApplications.reviewedBy });
    for (const a of claimed) {
      if (!a.shopId) continue;
      await grantRole(tx, {
        userId: input.userId,
        role: 'seller_owner',
        shopId: a.shopId,
        grantedBy: a.reviewedBy,
        reason: 'seller application approved',
      });
      // Membership = who gets live pings for the shop (live.ts); the grant above is what the API authorises.
      await tx
        .insert(shopUsers)
        .values({ shopId: a.shopId, userId: input.userId, role: 'owner' })
        .onConflictDoNothing();
    }
    return claimed.length;
  });
}
