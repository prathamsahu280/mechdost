import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { FleetApplication, TradeApplication } from '@mechdost/shared/business-applications';
import {
  BUSINESS_APPLICATION_KINDS,
  TRADE_REVOKE_REASONS,
  type BusinessApplicationKind,
  type TradeBusinessType,
  type TradeRevokeReason,
  type TradeStatus,
} from '@mechdost/shared/business-codes';
import { publicCode } from '@mechdost/shared/ids';
import { APPLICATION_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import {
  businessApplicationMachine,
  tradeAccountMachine,
  type BusinessApplicationStatus,
  type TradeAccountStatus,
} from '@mechdost/shared/state';
import {
  auditLog,
  businessApplicationEvents,
  businessApplications,
  categories,
  tradeAccountEvents,
  tradeAccounts,
  users,
} from '../schema';
import { queueEmail } from './email-notifications';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * Trade account applications and fleet enquiries (audience entry design 2026-11-22, item 3). A trade application is
 * sent signed in; approving it verifies the applicant's account (`trade_accounts`, audited, with events), which
 * staff can revoke with a reason code and restore. A fleet enquiry is a lead: staff review and close it.
 * Every status change is a conditional UPDATE on `(id, status, version)` after the machine allows it.
 * The typed email address of a signed-out fleet enquiry is never mailed (unverified: no spam relay, 2026-11-15).
 */

async function placeOf(tx: Tx, pincode: string): Promise<{ cityId: string; cityCode: string }> {
  const [place] = rowsOf<{ city_id: string; code: string }>(
    await tx.execute(sql`select c.id as city_id, c.code from pincodes p join cities c on c.id = p.city_id
      where p.pincode = ${pincode}`),
  );
  if (!place) throw new ValidationError('We do not serve this PIN code yet', 'PINCODE_NOT_SERVED');
  return { cityId: place.city_id, cityCode: place.code };
}

async function recordSubmitted(
  tx: Tx,
  input: {
    id: string;
    code: string;
    kind: BusinessApplicationKind;
    cityId: string;
    userId: string | null;
  },
) {
  await tx.insert(businessApplicationEvents).values({
    applicationId: input.id,
    fromStatus: null,
    toStatus: 'new',
    actorUserId: input.userId,
  });
  await tx.insert(auditLog).values({
    actorUserId: input.userId,
    actorRole: input.userId ? 'customer' : 'guest',
    action: 'business_application.submitted',
    entity: 'business_application',
    entityId: input.id,
    after: { code: input.code, kind: input.kind, status: 'new' },
  });
  await recordServerEvent(tx, 'business_application_submitted', {
    userId: input.userId,
    cityId: input.cityId,
    props: { kind: input.kind, signedIn: input.userId !== null },
  });
  await queueStaffNotice(tx, {
    kind: 'staff.new_application',
    cityId: input.cityId,
    entityId: input.id,
    version: 1,
  });
}

export async function submitTradeApplication(
  db: Tx,
  input: { userId: string; application: TradeApplication },
): Promise<{ code: string; status: BusinessApplicationStatus }> {
  const app = input.application;
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ name: users.name, phone: users.phone, email: users.email })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.status, 'active')))
      .limit(1);
    if (!user) throw new NotFoundError('Account not found');
    const place = await placeOf(tx, app.pincode);
    const found = await tx
      .select({ slug: categories.slug })
      .from(categories)
      .where(and(inArray(categories.slug, app.categories), eq(categories.hidden, false)));
    if (found.length !== app.categories.length)
      throw new ValidationError('Some categories are not in the catalogue', 'CATEGORIES');
    const [account] = await tx
      .select({ status: tradeAccounts.status })
      .from(tradeAccounts)
      .where(eq(tradeAccounts.userId, input.userId))
      .limit(1);
    if (account?.status === 'verified')
      throw new ConflictError('This account is already a verified trade account', 'TRADE_ALREADY_VERIFIED');

    const code = publicCode('BA', place.cityCode);
    // The unique partial index (one open trade application per account) is the guard; the error maps to a 409.
    const row = await tx
      .insert(businessApplications)
      .values({
        code,
        kind: 'trade',
        userId: input.userId,
        cityId: place.cityId,
        pincode: app.pincode,
        contactName: user.name ?? app.businessName,
        contactPhone: user.phone,
        contactEmail: user.email,
        businessName: app.businessName,
        businessType: app.businessType,
        gstin: app.gstin ?? null,
        spendBand: app.spendBand,
        categories: app.categories,
        consentAt: new Date(),
        createdBy: input.userId,
      })
      .returning({ id: businessApplications.id })
      .then(
        (rows) => rows[0],
        (err: unknown) => {
          if (pgCode(err) === '23505')
            throw new ConflictError('You already have an application waiting', 'TRADE_APPLICATION_OPEN');
          throw err;
        },
      );
    if (!row) throw new Error('trade insert returned no row');
    await recordSubmitted(tx, {
      id: row.id,
      code,
      kind: 'trade',
      cityId: place.cityId,
      userId: input.userId,
    });
    await queueEmail(tx, {
      template: 'trade_application_received',
      entityId: row.id,
      version: 1,
      audience: 'customer',
      userId: input.userId,
      payload: { name: user.name ?? app.businessName, applicationCode: code },
    });
    return { code, status: 'new' as const };
  });
}

export async function submitFleetApplication(
  db: Tx,
  input: { userId: string | null; application: FleetApplication },
): Promise<{ code: string; status: BusinessApplicationStatus }> {
  const app = input.application;
  return db.transaction(async (tx) => {
    const place = await placeOf(tx, app.pincode);
    const code = publicCode('BA', place.cityCode);
    const [row] = await tx
      .insert(businessApplications)
      .values({
        code,
        kind: 'fleet',
        userId: input.userId,
        cityId: place.cityId,
        pincode: app.pincode,
        contactName: app.contactName,
        contactPhone: app.phone,
        contactEmail: app.email,
        businessName: app.companyName,
        fleet2w: app.fleet.w2,
        fleet3w: app.fleet.w3,
        fleet4w: app.fleet.w4,
        needs: app.needs,
        note: app.note ?? null,
        consentAt: new Date(),
        createdBy: input.userId,
      })
      .returning({ id: businessApplications.id });
    if (!row) throw new Error('fleet insert returned no row');
    await recordSubmitted(tx, {
      id: row.id,
      code,
      kind: 'fleet',
      cityId: place.cityId,
      userId: input.userId,
    });
    // Only a signed-in account has a verified address: a typed one is never mailed.
    if (input.userId)
      await queueEmail(tx, {
        template: 'fleet_application_received',
        entityId: row.id,
        version: 1,
        audience: 'customer',
        userId: input.userId,
        payload: { name: app.contactName, applicationCode: code },
      });
    return { code, status: 'new' as const };
  });
}

const cityFilter = (scope: CityScope) =>
  scope.all
    ? undefined
    : inArray(
        businessApplications.cityId,
        scope.cityIds.length ? scope.cityIds : ['00000000-0000-0000-0000-000000000000'],
      );

export async function listBusinessApplications(
  db: Tx,
  scope: CityScope,
  opts: {
    status?: BusinessApplicationStatus | null;
    kind?: BusinessApplicationKind | null;
    before?: { createdAt: string; id: string } | null;
    limit?: number;
  },
) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await db
    .select({
      id: businessApplications.id,
      code: businessApplications.code,
      kind: businessApplications.kind,
      status: businessApplications.status,
      businessName: businessApplications.businessName,
      contactName: businessApplications.contactName,
      pincode: businessApplications.pincode,
      businessType: businessApplications.businessType,
      createdAt: businessApplications.createdAt,
    })
    .from(businessApplications)
    .where(
      and(
        cityFilter(scope),
        opts.status ? eq(businessApplications.status, opts.status) : undefined,
        opts.kind ? eq(businessApplications.kind, opts.kind) : undefined,
        opts.before
          ? or(
              lt(businessApplications.createdAt, new Date(opts.before.createdAt)),
              and(
                eq(businessApplications.createdAt, new Date(opts.before.createdAt)),
                lt(businessApplications.id, opts.before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(businessApplications.createdAt), desc(businessApplications.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map((r) => ({
    ...r,
    kind: r.kind as BusinessApplicationKind,
    status: r.status as BusinessApplicationStatus,
  }));
  return { items, more: rows.length > limit };
}

export interface BusinessApplicationDetail {
  code: string;
  kind: BusinessApplicationKind;
  status: BusinessApplicationStatus;
  version: number;
  businessName: string;
  businessType: string | null;
  gstin: string | null;
  spendBand: string | null;
  categories: string[];
  fleet: { w2: number; w3: number; w4: number } | null;
  needs: string[];
  note: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  signedIn: boolean;
  pincode: string;
  reasonCode: string | null;
  createdAt: string;
  tradeAccount: {
    status: TradeAccountStatus;
    version: number;
    reasonCode: string | null;
  } | null;
}

export async function getBusinessApplication(
  db: Tx,
  scope: CityScope,
  code: string,
): Promise<BusinessApplicationDetail> {
  const [a] = await db
    .select()
    .from(businessApplications)
    .where(and(eq(businessApplications.code, code), cityFilter(scope)))
    .limit(1);
  if (!a) throw new NotFoundError('Application not found');
  const [acc] =
    a.kind === 'trade' && a.userId
      ? await db
          .select({
            status: tradeAccounts.status,
            version: tradeAccounts.version,
            reasonCode: tradeAccounts.reasonCode,
          })
          .from(tradeAccounts)
          .where(and(eq(tradeAccounts.userId, a.userId), eq(tradeAccounts.applicationId, a.id)))
          .limit(1)
      : [];
  return {
    code: a.code,
    kind: a.kind as BusinessApplicationKind,
    status: a.status as BusinessApplicationStatus,
    version: a.version,
    businessName: a.businessName,
    businessType: a.businessType,
    gstin: a.gstin,
    spendBand: a.spendBand,
    categories: a.categories ?? [],
    fleet:
      a.fleet2w === null || a.fleet3w === null || a.fleet4w === null
        ? null
        : { w2: a.fleet2w, w3: a.fleet3w, w4: a.fleet4w },
    needs: a.needs ?? [],
    note: a.note,
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    contactEmail: a.contactEmail,
    signedIn: a.userId !== null,
    pincode: a.pincode,
    reasonCode: a.reasonCode,
    createdAt: a.createdAt.toISOString(),
    tradeAccount: acc ? { ...acc, status: acc.status as TradeAccountStatus } : null,
  };
}

async function lockApplication(tx: Tx, scope: CityScope, code: string) {
  const [row] = rowsOf<{
    id: string;
    status: BusinessApplicationStatus;
    version: number;
    city_id: string;
    kind: BusinessApplicationKind;
    user_id: string | null;
    business_name: string;
    business_type: TradeBusinessType | null;
    gstin: string | null;
    contact_name: string;
    code: string;
  }>(
    await tx.execute(sql`select id, status, version, city_id, kind, user_id, business_name, business_type, gstin,
      contact_name, code from business_applications where code = ${code} for update`),
  );
  if (!row || (!scope.all && !scope.cityIds.includes(row.city_id)))
    throw new NotFoundError('Application not found');
  return { ...row, version: num(row.version) };
}

export async function decideBusinessApplication(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    expectedVersion: number;
    staffUserId: string;
    decision: Exclude<BusinessApplicationStatus, 'new'>;
    reasonCode?: (typeof APPLICATION_REJECT_REASONS)[number] | null;
    note?: string | null;
  },
): Promise<void> {
  const reason = input.reasonCode ?? null;
  if (input.decision === 'rejected' && (!reason || !APPLICATION_REJECT_REASONS.includes(reason)))
    throw new ValidationError('Choose a reason', 'REASON_CODE');
  await db.transaction(async (tx) => {
    const app = await lockApplication(tx, input.scope, input.code);
    if (!(BUSINESS_APPLICATION_KINDS as readonly string[]).includes(app.kind))
      throw new ConflictError('Unknown application kind', 'KIND');
    if (app.kind === 'fleet' && (input.decision === 'approved' || input.decision === 'rejected'))
      throw new ConflictError(
        'A fleet enquiry is reviewed and closed, not approved',
        'NOT_A_TRADE_APPLICATION',
      );
    if (app.kind === 'trade' && input.decision === 'closed')
      throw new ConflictError('A trade application is approved or rejected', 'TRADE_CANNOT_CLOSE');
    // Separation of duties (security review 2026-11-22): nobody decides their own application.
    if (app.user_id !== null && app.user_id === input.staffUserId)
      throw new ForbiddenError('You cannot decide your own application', 'STAFF_SELF_CHANGE');
    businessApplicationMachine.assert(app.status, input.decision, 'admin');
    if (app.version !== input.expectedVersion)
      throw new ConflictError('Someone else changed this application; reload', 'STALE_APPLICATION');
    const updated = await tx
      .update(businessApplications)
      .set({
        status: input.decision,
        reviewedBy: input.staffUserId,
        reviewedAt: new Date(),
        reasonCode: input.decision === 'rejected' ? reason : null,
        reviewNote: input.note ?? null,
      })
      .where(
        and(
          eq(businessApplications.id, app.id),
          eq(businessApplications.status, app.status),
          eq(businessApplications.version, app.version),
        ),
      )
      .returning({ id: businessApplications.id });
    if (updated.length === 0)
      throw new ConflictError('Someone else changed this application; reload', 'STALE_APPLICATION');
    await tx.insert(businessApplicationEvents).values({
      applicationId: app.id,
      fromStatus: app.status,
      toStatus: input.decision,
      reasonCode: input.decision === 'rejected' ? reason : null,
      actorUserId: input.staffUserId,
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `business_application.${input.decision}`,
      entity: 'business_application',
      entityId: app.id,
      before: { status: app.status },
      after: { status: input.decision, reasonCode: reason },
    });
    if (input.decision !== 'in_review')
      await recordServerEvent(tx, 'business_application_decided', {
        userId: input.staffUserId,
        cityId: app.city_id,
        props: { kind: app.kind, decision: input.decision, reasonCode: reason },
      });
    if (app.kind === 'trade' && input.decision === 'approved')
      await verifyTradeAccount(tx, app, input.staffUserId);
  });
}

/** Approval of a trade application: the applicant's account becomes (or becomes again) a verified trade account. */
async function verifyTradeAccount(
  tx: Tx,
  app: {
    id: string;
    code: string;
    user_id: string | null;
    business_name: string;
    business_type: TradeBusinessType | null;
    gstin: string | null;
    contact_name: string;
  },
  staffUserId: string,
) {
  if (!app.user_id || !app.business_type) throw new ConflictError('Application has no account', 'NO_ACCOUNT');
  const [existing] = await tx
    .select({ id: tradeAccounts.id, status: tradeAccounts.status, version: tradeAccounts.version })
    .from(tradeAccounts)
    .where(eq(tradeAccounts.userId, app.user_id))
    .for('update')
    .limit(1);
  let accountId: string;
  if (!existing) {
    const [created] = await tx
      .insert(tradeAccounts)
      .values({
        userId: app.user_id,
        status: 'verified',
        businessName: app.business_name,
        businessType: app.business_type,
        gstin: app.gstin,
        applicationId: app.id,
        verifiedAt: new Date(),
        createdBy: staffUserId,
      })
      .returning({ id: tradeAccounts.id });
    if (!created) throw new Error('trade account insert returned no row');
    accountId = created.id;
  } else {
    if (existing.status === 'verified') return;
    tradeAccountMachine.assert('revoked', 'verified', 'admin');
    const ok = await tx
      .update(tradeAccounts)
      .set({
        status: 'verified',
        businessName: app.business_name,
        businessType: app.business_type,
        gstin: app.gstin,
        applicationId: app.id,
        verifiedAt: new Date(),
        revokedAt: null,
        reasonCode: null,
      })
      .where(
        and(
          eq(tradeAccounts.id, existing.id),
          eq(tradeAccounts.status, 'revoked'),
          eq(tradeAccounts.version, existing.version),
        ),
      )
      .returning({ id: tradeAccounts.id });
    if (ok.length === 0) throw new ConflictError('Trade account changed; reload', 'STALE_TRADE_ACCOUNT');
    accountId = existing.id;
  }
  await writeAccountHistory(tx, {
    accountId,
    userId: app.user_id,
    event: 'trade_account_verified',
    reasonCode: null,
    applicationId: app.id,
    staffUserId,
    before: existing?.status ?? null,
    via: 'application',
  });
  await queueEmail(tx, {
    template: 'trade_account_verified',
    entityId: accountId,
    version: (existing?.version ?? 0) + 1,
    audience: 'customer',
    userId: app.user_id,
    payload: { name: app.contact_name, applicationCode: app.code },
  });
}

async function writeAccountHistory(
  tx: Tx,
  h: {
    accountId: string;
    userId: string;
    event: 'trade_account_verified' | 'trade_account_revoked';
    reasonCode: TradeRevokeReason | null;
    applicationId: string | null;
    staffUserId: string;
    before: string | null;
    via: 'application' | 'restored';
  },
) {
  await tx.insert(tradeAccountEvents).values({
    tradeAccountId: h.accountId,
    userId: h.userId,
    event: h.event,
    reasonCode: h.reasonCode,
    applicationId: h.applicationId,
    actorUserId: h.staffUserId,
  });
  await tx.insert(auditLog).values({
    actorUserId: h.staffUserId,
    actorRole: 'staff',
    action: h.event === 'trade_account_verified' ? 'trade_account.verified' : 'trade_account.revoked',
    entity: 'trade_account',
    entityId: h.accountId,
    before: { status: h.before },
    after: {
      status: h.event === 'trade_account_verified' ? 'verified' : 'revoked',
      reasonCode: h.reasonCode,
    },
  });
  if (h.event === 'trade_account_verified')
    await recordServerEvent(tx, 'trade_account_verified', {
      userId: h.staffUserId,
      props: { via: h.via },
    });
  else
    await recordServerEvent(tx, 'trade_account_revoked', {
      userId: h.staffUserId,
      props: { reasonCode: h.reasonCode ?? 'other' },
    });
}

/** Staff take a trade account's verified status back (with a reason code) or restore it; reversible, audited. */
export async function setTradeAccountStanding(
  db: Tx,
  input: {
    scope: CityScope;
    /** The trade application that created the account (what the console shows). */
    code: string;
    expectedVersion: number;
    staffUserId: string;
    to: TradeAccountStatus;
    reasonCode?: TradeRevokeReason | null;
  },
): Promise<void> {
  const reason = input.reasonCode ?? null;
  if (input.to === 'revoked' && (!reason || !TRADE_REVOKE_REASONS.includes(reason)))
    throw new ValidationError('Choose a reason', 'REASON_CODE');
  await db.transaction(async (tx) => {
    const app = await lockApplication(tx, input.scope, input.code);
    if (app.kind !== 'trade' || !app.user_id) throw new NotFoundError('Trade account not found');
    if (app.user_id === input.staffUserId)
      throw new ForbiddenError('You cannot change your own trade account', 'STAFF_SELF_CHANGE');
    const [acc] = await tx
      .select({
        id: tradeAccounts.id,
        status: tradeAccounts.status,
        version: tradeAccounts.version,
      })
      .from(tradeAccounts)
      .where(and(eq(tradeAccounts.userId, app.user_id), eq(tradeAccounts.applicationId, app.id)))
      .for('update')
      .limit(1);
    if (!acc) throw new NotFoundError('Trade account not found');
    const from = acc.status as TradeAccountStatus;
    tradeAccountMachine.assert(from, input.to, 'admin');
    if (acc.version !== input.expectedVersion)
      throw new ConflictError('Someone else changed this account; reload', 'STALE_TRADE_ACCOUNT');
    const ok = await tx
      .update(tradeAccounts)
      .set(
        input.to === 'revoked'
          ? { status: 'revoked', revokedAt: new Date(), reasonCode: reason }
          : { status: 'verified', verifiedAt: new Date(), revokedAt: null, reasonCode: null },
      )
      .where(
        and(
          eq(tradeAccounts.id, acc.id),
          eq(tradeAccounts.status, from),
          eq(tradeAccounts.version, acc.version),
        ),
      )
      .returning({ id: tradeAccounts.id });
    if (ok.length === 0)
      throw new ConflictError('Someone else changed this account; reload', 'STALE_TRADE_ACCOUNT');
    await writeAccountHistory(tx, {
      accountId: acc.id,
      userId: app.user_id,
      event: input.to === 'revoked' ? 'trade_account_revoked' : 'trade_account_verified',
      reasonCode: input.to === 'revoked' ? reason : null,
      applicationId: app.id,
      staffUserId: input.staffUserId,
      before: from,
      via: 'restored',
    });
  });
}

export interface TradeProfile {
  status: TradeStatus;
  /** Only for a verified account (checkout pre-fill); null otherwise. */
  businessName: string | null;
  gstin: string | null;
}

/** The signed-in customer's own trade status: verified/revoked from the account, `pending` while an application waits. */
export async function getTradeProfile(db: Tx, userId: string): Promise<TradeProfile> {
  const [acc] = await db
    .select({
      status: tradeAccounts.status,
      businessName: tradeAccounts.businessName,
      gstin: tradeAccounts.gstin,
    })
    .from(tradeAccounts)
    .where(eq(tradeAccounts.userId, userId))
    .limit(1);
  if (acc?.status === 'verified')
    return { status: 'verified', businessName: acc.businessName, gstin: acc.gstin };
  if (acc) return { status: 'revoked', businessName: null, gstin: null };
  const [open] = await db
    .select({ id: businessApplications.id })
    .from(businessApplications)
    .where(
      and(
        eq(businessApplications.userId, userId),
        eq(businessApplications.kind, 'trade'),
        inArray(businessApplications.status, ['new', 'in_review']),
      ),
    )
    .limit(1);
  return { status: open ? 'pending' : 'none', businessName: null, gstin: null };
}
