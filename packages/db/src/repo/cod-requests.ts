import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  COD_DECISION_REASONS,
  COD_REQUEST_REASONS,
  COD_REVOKE_REASONS,
  codEligibility,
  type CodApprovalFacts,
  type CodDecisionReason,
  type CodEligibility,
  type CodRequestReason,
  type CodRequestState,
  type CodRevokeReason,
  type CodSwitches,
  type CodUstaadFacts,
} from '@mechdost/shared/cod-eligibility';
import { maskPhone } from '@mechdost/shared/contact-mask';
import { OPERATIONAL_SETTINGS, type SettingKey } from '@mechdost/shared/settings';
import { codRequestMachine } from '@mechdost/shared/state';
import { auditLog, codRequestEvents, codRequests, settings, users, ustaadMembers } from '../schema';
import { queueEmail } from './email-notifications';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { rowsOf } from './sql-rows';

/**
 * Cash-on-delivery eligibility and requests (founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility).
 * Settings per city with a global fallback decide which routes are open (everyone · approved customers · verified
 * Ustaad members); `codEligibility` (shared, pure) applies them. Requests move through `codRequestMachine` as
 * conditional UPDATEs on (status, version); each move writes `cod_request_events`, an audit row and an analytics
 * event in the same transaction, and the customer's notice + email go through the outbox. Staff see and decide only
 * requests of the cities their `customers:cod_approve` grant covers (another city's request is a 404).
 */

const COD_SETTING_KEYS = [
  'checkout.cod_everyone',
  'checkout.cod_approved_customers',
  'checkout.cod_ustaad_verified',
  'checkout.cod_ustaad_min_level',
  'checkout.cod_min_order_paise',
  'checkout.cod_min_items',
  'checkout.cod_request_reapply_days',
] as const satisfies readonly SettingKey[];
type CodSettingKey = (typeof COD_SETTING_KEYS)[number];

export interface CodCityRules {
  switches: CodSwitches;
  minOrderPaise: number;
  minItems: number;
  reapplyDays: number;
}

/** Every COD rule for a city in one query (city value, else global, else the registry default). */
export async function codRulesForCity(db: Tx, cityId: string): Promise<CodCityRules> {
  const rows = await db
    .select({ cityId: settings.cityId, key: settings.key, value: settings.value })
    .from(settings)
    .where(
      and(
        inArray(settings.key, [...COD_SETTING_KEYS]),
        or(eq(settings.cityId, cityId), sql`${settings.cityId} is null`),
      ),
    );
  const pick = (key: CodSettingKey): unknown => {
    // The reapply wait is global only (a city row would do nothing).
    const city =
      key === 'checkout.cod_request_reapply_days'
        ? undefined
        : rows.find((r) => r.key === key && r.cityId === cityId);
    return (city ?? rows.find((r) => r.key === key && r.cityId === null))?.value;
  };
  const flag = (key: CodSettingKey): boolean => {
    const v = pick(key);
    const spec = OPERATIONAL_SETTINGS[key];
    return typeof v === 'boolean' ? v : spec.kind === 'boolean' && spec.default;
  };
  const int = (key: CodSettingKey): number => {
    const v = pick(key);
    const spec = OPERATIONAL_SETTINGS[key];
    if (spec.kind !== 'int') return 0;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= spec.min && v <= spec.max) return v;
    return spec.default ?? 0;
  };
  return {
    switches: {
      everyone: flag('checkout.cod_everyone'),
      approved: flag('checkout.cod_approved_customers'),
      ustaad: flag('checkout.cod_ustaad_verified'),
      ustaadMinLevel: int('checkout.cod_ustaad_min_level'),
    },
    minOrderPaise: int('checkout.cod_min_order_paise'),
    minItems: int('checkout.cod_min_items'),
    reapplyDays: int('checkout.cod_request_reapply_days'),
  };
}

const requestView = {
  id: codRequests.id,
  userId: codRequests.userId,
  cityId: codRequests.cityId,
  pincode: codRequests.pincode,
  status: codRequests.status,
  reasonCode: codRequests.reasonCode,
  note: codRequests.note,
  decisionReasonCode: codRequests.decisionReasonCode,
  capPaise: codRequests.capPaise,
  expiresAt: codRequests.expiresAt,
  decidedAt: codRequests.decidedAt,
  revokedAt: codRequests.revokedAt,
  revokeReasonCode: codRequests.revokeReasonCode,
  version: codRequests.version,
  createdAt: codRequests.createdAt,
};

/** What a customer sees of a request (never the staff note). `status` reads `expired` once an approval ran out. */
export interface CodRequestView {
  id: string;
  cityId: string;
  pincode: string;
  status: CodRequestState;
  reasonCode: string;
  note: string | null;
  decisionReasonCode: string | null;
  capPaise: number | null;
  expiresAt: Date | null;
  decidedAt: Date | null;
  revokedAt: Date | null;
  revokeReasonCode: string | null;
  version: number;
  createdAt: Date;
}

type RequestRow = CodRequestView & { userId: string };

const isState = (s: string): s is CodRequestState =>
  ['pending', 'approved', 'rejected', 'withdrawn', 'revoked', 'expired'].includes(s);

/** An approval whose end date has passed reads as expired (the row is closed only when a new decision needs it). */
function effective(row: RequestRow, now: Date): RequestRow {
  const status = isState(row.status) ? row.status : 'withdrawn';
  if (status === 'approved' && row.expiresAt && row.expiresAt.getTime() <= now.getTime())
    return { ...row, status: 'expired' };
  return { ...row, status };
}

/** The request that decides this customer's state in this city: pending (any city) → approved here → newest here. */
async function governingRequest(
  db: Tx,
  userId: string,
  cityId: string,
  now: Date,
): Promise<RequestRow | null> {
  const rows = await db
    .select(requestView)
    .from(codRequests)
    .where(
      and(
        eq(codRequests.userId, userId),
        or(eq(codRequests.cityId, cityId), eq(codRequests.status, 'pending')),
      ),
    )
    .orderBy(desc(codRequests.createdAt))
    .limit(20);
  const list = rows.map((r) => effective(r as RequestRow, now));
  return (
    list.find((r) => r.status === 'pending') ??
    list.find((r) => r.status === 'approved' && r.cityId === cityId) ??
    list.find((r) => r.cityId === cityId && r.status !== 'withdrawn') ??
    null
  );
}

function approvalFacts(row: RequestRow | null, reapplyDays: number): CodApprovalFacts {
  if (!row) return { state: 'none', capPaise: null, canRequestAgainAt: null };
  const decidedAt = row.status === 'revoked' ? row.revokedAt : row.decidedAt;
  const wait =
    (row.status === 'rejected' || row.status === 'revoked') && decidedAt
      ? new Date(decidedAt.getTime() + reapplyDays * 86_400_000)
      : null;
  return {
    state: row.status,
    capPaise: row.status === 'approved' ? row.capPaise : null,
    canRequestAgainAt: wait,
  };
}

async function ustaadFacts(db: Tx, userId: string): Promise<CodUstaadFacts | null> {
  const [m] = await db
    .select({
      verificationState: ustaadMembers.verificationState,
      status: ustaadMembers.status,
      level: ustaadMembers.level,
      restrictedMode: ustaadMembers.restrictedMode,
      perksFrozenUntil: ustaadMembers.perksFrozenUntil,
    })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.userId, userId))
    .limit(1);
  return m ?? null;
}

export interface CodPersonStatus {
  eligibility: CodEligibility;
  rules: CodCityRules;
  request: CodRequestView | null;
}

/** A person's COD state in a city (`userId` null = a guest). */
export async function codStatusInCity(
  db: Tx,
  input: { userId: string | null; cityId: string; now?: Date },
): Promise<CodPersonStatus> {
  const now = input.now ?? new Date();
  const rules = await codRulesForCity(db, input.cityId);
  if (!input.userId) {
    const eligibility = codEligibility({
      switches: rules.switches,
      signedIn: false,
      approval: { state: 'none', capPaise: null, canRequestAgainAt: null },
      ustaad: null,
      now,
    });
    return { eligibility, rules, request: null };
  }
  // The "everyone" route needs no lookups.
  const open = rules.switches.everyone;
  const request = open ? null : await governingRequest(db, input.userId, input.cityId, now);
  const ustaad = open || !rules.switches.ustaad ? null : await ustaadFacts(db, input.userId);
  const eligibility = codEligibility({
    switches: rules.switches,
    signedIn: true,
    approval: approvalFacts(request, rules.reapplyDays),
    ustaad,
    now,
  });
  return { eligibility, rules, request: request ? publicView(request) : null };
}

function publicView(r: RequestRow): CodRequestView {
  const { userId: _u, ...rest } = r;
  return rest;
}

async function cityOfPincode(db: Tx, pincode: string): Promise<{ cityId: string; cityCode: string }> {
  if (!/^[1-9][0-9]{5}$/.test(pincode))
    throw new ValidationError('Enter a 6-digit PIN code', 'PINCODE_INVALID');
  const [row] = rowsOf<{ city_id: string; city_code: string }>(
    await db.execute(sql`select c.id as city_id, c.code as city_code
      from pincodes pc join cities c on c.id = pc.city_id
      where pc.pincode = ${pincode} and pc.active and c.status = 'live' limit 1`),
  );
  if (!row) throw new ValidationError('We do not deliver to this PIN code yet', 'PINCODE_NOT_SERVICEABLE');
  return { cityId: row.city_id, cityCode: row.city_code };
}

/** The customer's state for the PIN they shop from (Account → Payments, checkout). */
export async function codStatusFor(
  db: Tx,
  input: { userId: string | null; pincode: string; now?: Date },
): Promise<CodPersonStatus & { cityId: string; cityCode: string }> {
  const city = await cityOfPincode(db, input.pincode);
  const status = await codStatusInCity(db, { userId: input.userId, cityId: city.cityId, now: input.now });
  return { ...status, ...city };
}

/** The customer's requests, newest first (bounded). */
export async function myCodRequests(db: Tx, userId: string): Promise<CodRequestView[]> {
  const now = new Date();
  const rows = await db
    .select(requestView)
    .from(codRequests)
    .where(eq(codRequests.userId, userId))
    .orderBy(desc(codRequests.createdAt))
    .limit(20);
  return rows.map((r) => publicView(effective(r as RequestRow, now)));
}

async function writeEvent(
  tx: Tx,
  e: {
    requestId: string;
    from: CodRequestState | null;
    to: CodRequestState;
    actorType: 'customer' | 'admin' | 'system';
    actorId: string | null;
    reasonCode?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  await tx.insert(codRequestEvents).values({
    requestId: e.requestId,
    fromStatus: e.from,
    toStatus: e.to,
    actorType: e.actorType,
    actorId: e.actorId,
    reasonCode: e.reasonCode ?? null,
    payload: e.payload ?? {},
  });
}

async function audit(
  tx: Tx,
  a: {
    actorUserId: string | null;
    actorRole: string;
    action: string;
    requestId: string;
    after: unknown;
    reason?: string | null;
  },
) {
  await tx.insert(auditLog).values({
    actorUserId: a.actorUserId,
    actorRole: a.actorRole,
    action: a.action,
    entity: 'cod_request',
    entityId: a.requestId,
    after: a.after,
    reason: a.reason ?? null,
  });
}

const cleanNote = (note: string | null | undefined, max: number, code: string): string | null => {
  const v = note?.trim() ?? '';
  if (v.length > max) throw new ValidationError(`Keep the note under ${String(max)} characters`, code);
  return v === '' ? null : v;
};

/** A signed-in customer asks for cash on delivery in the city of `pincode`. */
export async function requestCod(
  db: Tx,
  input: { userId: string; pincode: string; reasonCode: CodRequestReason; note: string | null },
): Promise<{ id: string; status: 'pending'; version: number }> {
  if (!COD_REQUEST_REASONS.includes(input.reasonCode))
    throw new ValidationError('Choose a reason', 'COD_REQUEST_REASON');
  const note = cleanNote(input.note, 300, 'COD_NOTE_LENGTH');
  return db.transaction(async (tx) => {
    // One decision at a time per customer: two parallel asks see each other's row.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`cod_request:${input.userId}`}, 0))`,
    );
    const { cityId } = await cityOfPincode(tx, input.pincode);
    const { eligibility, rules } = await codStatusInCity(tx, { userId: input.userId, cityId });
    if (eligibility.eligible)
      throw new ConflictError('Cash on delivery is already available to you', 'COD_ALREADY_AVAILABLE');
    if (eligibility.reason === 'request_pending')
      throw new ConflictError('Your request is already with our team', 'COD_REQUEST_PENDING');
    if (!rules.switches.approved)
      throw new ValidationError('Cash on delivery requests are not taken here', 'COD_REQUESTS_CLOSED');
    if (!eligibility.canRequest)
      throw new ConflictError('You can ask again a little later', 'COD_REQUEST_TOO_SOON');
    let row: { id: string; version: number } | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .insert(codRequests)
          .values({
            userId: input.userId,
            cityId,
            pincode: input.pincode,
            reasonCode: input.reasonCode,
            note,
            createdBy: input.userId,
          })
          .returning({ id: codRequests.id, version: codRequests.version }),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('Your request is already with our team', 'COD_REQUEST_PENDING');
      throw err;
    }
    if (!row) throw new Error('cod request insert returned no row');
    await writeEvent(tx, {
      requestId: row.id,
      from: null,
      to: 'pending',
      actorType: 'customer',
      actorId: input.userId,
      reasonCode: input.reasonCode,
    });
    await audit(tx, {
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'cod_request.created',
      requestId: row.id,
      after: { cityId, reasonCode: input.reasonCode },
    });
    await recordServerEvent(tx, 'cod_requested', {
      userId: input.userId,
      cityId,
      props: { requestId: row.id, reasonCode: input.reasonCode, hasNote: note !== null },
    });
    return { id: row.id, status: 'pending' as const, version: row.version };
  });
}

/** The customer takes back a pending request (actor-scoped: another customer's id is a 404). */
export async function withdrawCodRequest(
  db: Tx,
  input: { userId: string; requestId: string; expectedVersion: number },
): Promise<{ version: number }> {
  codRequestMachine.assert('pending', 'withdrawn', 'customer');
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(codRequests)
      .set({ status: 'withdrawn' })
      .where(
        and(
          eq(codRequests.id, input.requestId),
          eq(codRequests.userId, input.userId),
          eq(codRequests.status, 'pending'),
          eq(codRequests.version, input.expectedVersion),
        ),
      )
      .returning({ version: codRequests.version, cityId: codRequests.cityId });
    if (!updated) {
      const [mine] = await tx
        .select({ id: codRequests.id })
        .from(codRequests)
        .where(and(eq(codRequests.id, input.requestId), eq(codRequests.userId, input.userId)));
      if (!mine) throw new NotFoundError('Request not found');
      throw new ConflictError('This request changed meanwhile; reload', 'STALE_COD_REQUEST');
    }
    await writeEvent(tx, {
      requestId: input.requestId,
      from: 'pending',
      to: 'withdrawn',
      actorType: 'customer',
      actorId: input.userId,
    });
    await audit(tx, {
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'cod_request.withdrawn',
      requestId: input.requestId,
      after: {},
    });
    await recordServerEvent(tx, 'cod_request_withdrawn', {
      userId: input.userId,
      cityId: updated.cityId,
      props: { requestId: input.requestId },
    });
    return { version: updated.version };
  });
}

const inScope = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : inArray(codRequests.cityId, scope.cityIds);

async function scopedRow(tx: Tx, requestId: string, scope: CityScope): Promise<RequestRow> {
  const [row] = await tx
    .select(requestView)
    .from(codRequests)
    .where(and(eq(codRequests.id, requestId), inScope(scope)))
    .for('update');
  if (!row) throw new NotFoundError('Request not found');
  return row as RequestRow;
}

const MAX_CAP_PAISE = OPERATIONAL_SETTINGS['checkout.cod_cap_paise'].max;

export type CodDecisionInput = {
  requestId: string;
  expectedVersion: number;
  staffUserId: string;
  scope: CityScope;
  staffNote?: string | null;
} & (
  | { decision: 'approve'; capPaise?: number | null; expiresAt?: Date | null; reasonCode?: undefined }
  | { decision: 'reject'; reasonCode?: CodDecisionReason; capPaise?: undefined; expiresAt?: undefined }
);

/** Staff approve (optional personal cap and end date) or reject (reason code) a pending request. */
export async function decideCodRequest(
  db: Tx,
  input: CodDecisionInput,
): Promise<{ status: 'approved' | 'rejected'; version: number }> {
  const to = input.decision === 'approve' ? 'approved' : 'rejected';
  const staffNote = cleanNote(input.staffNote, 500, 'COD_STAFF_NOTE_LENGTH');
  if (input.decision === 'reject' && (!input.reasonCode || !COD_DECISION_REASONS.includes(input.reasonCode)))
    throw new ValidationError('Choose why the request is turned down', 'COD_REASON_REQUIRED');
  const cap = input.decision === 'approve' ? (input.capPaise ?? null) : null;
  if (cap !== null && (!Number.isSafeInteger(cap) || cap <= 0 || cap > MAX_CAP_PAISE))
    throw new ValidationError('The personal limit must be a positive amount', 'COD_CAP_INVALID');
  const expiresAt = input.decision === 'approve' ? (input.expiresAt ?? null) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now() + 60_000)
    throw new ValidationError('The end date must be in the future', 'COD_EXPIRES_AT');
  return db.transaction(async (tx) => {
    const row = await scopedRow(tx, input.requestId, input.scope);
    if (row.userId === input.staffUserId)
      throw new ForbiddenError('Someone else must decide your own request', 'COD_SELF_DECISION');
    if (row.status !== 'pending' || row.version !== input.expectedVersion)
      throw new ConflictError('This request changed meanwhile; reload', 'STALE_COD_REQUEST');
    codRequestMachine.assert('pending', to, 'admin');
    if (to === 'approved') await closeExpiredApprovals(tx, row.userId, row.cityId);
    let updated: { version: number } | undefined;
    try {
      [updated] = await tx.transaction((sp) =>
        sp
          .update(codRequests)
          .set({
            status: to,
            decidedBy: input.staffUserId,
            decidedAt: sql`now()`,
            decisionReasonCode: input.decision === 'reject' ? (input.reasonCode ?? null) : null,
            staffNote,
            capPaise: cap,
            expiresAt,
          })
          .where(
            and(
              eq(codRequests.id, row.id),
              eq(codRequests.status, 'pending'),
              eq(codRequests.version, input.expectedVersion),
            ),
          )
          .returning({ version: codRequests.version }),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('This customer already has cash on delivery here', 'COD_ALREADY_APPROVED');
      throw err;
    }
    if (!updated) throw new ConflictError('This request changed meanwhile; reload', 'STALE_COD_REQUEST');
    const reasonCode = input.decision === 'reject' ? (input.reasonCode ?? null) : null;
    await writeEvent(tx, {
      requestId: row.id,
      from: 'pending',
      to,
      actorType: 'admin',
      actorId: input.staffUserId,
      reasonCode,
      payload: { capSet: cap !== null, expires: expiresAt !== null },
    });
    await audit(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `cod_request.${to}`,
      requestId: row.id,
      after: { customerId: row.userId, cityId: row.cityId, capPaise: cap, expiresAt, reasonCode },
      reason: reasonCode,
    });
    const hoursToDecision = Math.max(0, Math.round((Date.now() - row.createdAt.getTime()) / 3_600_000));
    if (to === 'approved')
      await recordServerEvent(tx, 'cod_request_approved', {
        userId: input.staffUserId,
        cityId: row.cityId,
        props: {
          requestId: row.id,
          customerId: row.userId,
          capSet: cap !== null,
          expires: expiresAt !== null,
          hoursToDecision,
        },
      });
    else
      await recordServerEvent(tx, 'cod_request_rejected', {
        userId: input.staffUserId,
        cityId: row.cityId,
        props: {
          requestId: row.id,
          customerId: row.userId,
          reasonCode: reasonCode ?? 'other',
          hoursToDecision,
        },
      });
    await queueEmail(tx, {
      template: to === 'approved' ? 'cod_approved' : 'cod_rejected',
      userId: row.userId,
      entityId: row.id,
      version: updated.version,
      payload: (locale) => ({
        reason: to === 'rejected' ? codReasonPhrase(reasonCode ?? 'other', locale) : '',
      }),
    });
    return { status: to, version: updated.version };
  });
}

/** Approvals of this customer and city whose end date passed hold the unique slot: close them (system move). */
async function closeExpiredApprovals(tx: Tx, userId: string, cityId: string) {
  codRequestMachine.assert('approved', 'expired', 'system');
  const closed = await tx
    .update(codRequests)
    .set({ status: 'expired' })
    .where(
      and(
        eq(codRequests.userId, userId),
        eq(codRequests.cityId, cityId),
        eq(codRequests.status, 'approved'),
        sql`${codRequests.expiresAt} <= now()`,
      ),
    )
    .returning({ id: codRequests.id });
  for (const c of closed) {
    await writeEvent(tx, {
      requestId: c.id,
      from: 'approved',
      to: 'expired',
      actorType: 'system',
      actorId: null,
    });
    await audit(tx, {
      actorUserId: null,
      actorRole: 'system',
      action: 'cod_request.expired',
      requestId: c.id,
      after: {},
    });
  }
}

/** Staff take an approval back with a reason code. */
export async function revokeCodApproval(
  db: Tx,
  input: {
    requestId: string;
    expectedVersion: number;
    reasonCode: CodRevokeReason;
    staffNote?: string | null;
    staffUserId: string;
    scope: CityScope;
  },
): Promise<{ version: number }> {
  if (!COD_REVOKE_REASONS.includes(input.reasonCode))
    throw new ValidationError('Choose why cash on delivery is taken back', 'COD_REASON_REQUIRED');
  const staffNote = cleanNote(input.staffNote, 500, 'COD_STAFF_NOTE_LENGTH');
  codRequestMachine.assert('approved', 'revoked', 'admin');
  return db.transaction(async (tx) => {
    const row = await scopedRow(tx, input.requestId, input.scope);
    if (row.userId === input.staffUserId)
      throw new ForbiddenError('Someone else must decide your own request', 'COD_SELF_DECISION');
    const [updated] = await tx
      .update(codRequests)
      .set({
        status: 'revoked',
        revokedBy: input.staffUserId,
        revokedAt: sql`now()`,
        revokeReasonCode: input.reasonCode,
        ...(staffNote ? { staffNote } : {}),
      })
      .where(
        and(
          eq(codRequests.id, row.id),
          eq(codRequests.status, 'approved'),
          eq(codRequests.version, input.expectedVersion),
        ),
      )
      .returning({ version: codRequests.version });
    if (!updated) throw new ConflictError('This approval changed meanwhile; reload', 'STALE_COD_REQUEST');
    await writeEvent(tx, {
      requestId: row.id,
      from: 'approved',
      to: 'revoked',
      actorType: 'admin',
      actorId: input.staffUserId,
      reasonCode: input.reasonCode,
    });
    await audit(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'cod_request.revoked',
      requestId: row.id,
      after: { customerId: row.userId, cityId: row.cityId, reasonCode: input.reasonCode },
      reason: input.reasonCode,
    });
    await recordServerEvent(tx, 'cod_approval_revoked', {
      userId: input.staffUserId,
      cityId: row.cityId,
      props: { requestId: row.id, customerId: row.userId, reasonCode: input.reasonCode },
    });
    await queueEmail(tx, {
      template: 'cod_revoked',
      userId: row.userId,
      entityId: row.id,
      version: updated.version,
      payload: (locale) => ({ reason: codReasonPhrase(input.reasonCode, locale) }),
    });
    return { version: updated.version };
  });
}

/** Plain words for a reject/revoke reason in an email (the customer never sees codes). */
function codReasonPhrase(code: string, locale: 'en' | 'hi'): string {
  const en: Record<string, string> = {
    insufficient_history: 'we need a few delivered orders first',
    unverified_details: 'your account details need to be verified first',
    rto_history: 'earlier cash parcels were not accepted',
    area_not_supported: 'cash collection is not set up for your area yet',
    risk_signals: 'we could not confirm the request',
    cod_refused: 'a cash parcel was not accepted at the door',
    misuse: 'cash on delivery was not used as agreed',
    customer_request: 'you asked us to',
    other: 'our team will explain if you contact support',
  };
  const hi: Record<string, string> = {
    insufficient_history: 'पहले कुछ ऑर्डर डिलीवर होने ज़रूरी हैं',
    unverified_details: 'पहले आपके खाते की जानकारी सत्यापित होनी चाहिए',
    rto_history: 'पहले के नकद पार्सल स्वीकार नहीं किए गए थे',
    area_not_supported: 'आपके इलाके में अभी नकद लेने की व्यवस्था नहीं है',
    risk_signals: 'हम अनुरोध की पुष्टि नहीं कर पाए',
    cod_refused: 'एक नकद पार्सल दरवाज़े पर स्वीकार नहीं किया गया',
    misuse: 'कैश ऑन डिलीवरी तय तरीके से इस्तेमाल नहीं हुआ',
    customer_request: 'आपने ऐसा करने को कहा था',
    other: 'सहायता से संपर्क करने पर हमारी टीम कारण बताएगी',
  };
  return (locale === 'hi' ? hi : en)[code] ?? (locale === 'hi' ? hi.other : en.other) ?? '';
}

export interface AdminCodRequestItem extends CodRequestView {
  customerId: string;
  customerName: string | null;
  /** Masked unless the viewer may read personal data (the API decides). */
  customerPhone: string | null;
  deliveredOrders: number;
  cancelledOrders: number;
  ustaadVerified: boolean;
}

/**
 * The staff queue (Customers → COD requests): one status at a time, in the staff member's cities. Pending requests
 * oldest first (first come, first decided); decided ones newest first. Keyset cursor on (created_at, id).
 */
export async function listCodRequests(
  db: Tx,
  input: {
    scope: CityScope;
    status: CodRequestState;
    cursor?: string | null;
    limit: number;
    canReadPii?: boolean;
  },
): Promise<{ items: AdminCodRequestItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit, 1), 100);
  const oldestFirst = input.status === 'pending';
  let after: SQL | undefined;
  if (input.cursor) {
    const [at, id] = input.cursor.split('|');
    const when = at ? new Date(at) : null;
    if (!when || Number.isNaN(when.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id))
      throw new ValidationError('Invalid cursor', 'CURSOR');
    after = oldestFirst
      ? or(gt(codRequests.createdAt, when), and(eq(codRequests.createdAt, when), gt(codRequests.id, id)))
      : or(lt(codRequests.createdAt, when), and(eq(codRequests.createdAt, when), lt(codRequests.id, id)));
  }
  const rows = await db
    .select({
      ...requestView,
      customerName: users.name,
      customerPhone: users.phone,
      deliveredOrders: sql<number>`(select count(*)::int from orders o join order_groups g on g.id = o.group_id
        where g.user_id = ${codRequests.userId} and o.status = 'delivered')`,
      cancelledOrders: sql<number>`(select count(*)::int from orders o join order_groups g on g.id = o.group_id
        where g.user_id = ${codRequests.userId} and o.status in ('cancelled','rejected'))`,
      ustaadVerified: sql<boolean>`exists (select 1 from ustaad_members m where m.user_id = ${codRequests.userId}
        and m.verification_state = 'verified' and m.status = 'active')`,
    })
    .from(codRequests)
    .innerJoin(users, eq(users.id, codRequests.userId))
    .where(and(eq(codRequests.status, input.status), inScope(input.scope), after))
    .orderBy(
      oldestFirst ? asc(codRequests.createdAt) : desc(codRequests.createdAt),
      oldestFirst ? asc(codRequests.id) : desc(codRequests.id),
    )
    .limit(limit + 1);
  const now = new Date();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const {
        userId,
        customerName,
        customerPhone,
        deliveredOrders,
        cancelledOrders,
        ustaadVerified,
        ...rest
      } = r;
      return {
        ...publicView(effective({ ...rest, userId } as RequestRow, now)),
        customerId: userId,
        customerName,
        customerPhone: input.canReadPii ? customerPhone : maskPhone(customerPhone),
        deliveredOrders,
        cancelledOrders,
        ustaadVerified,
      };
    }),
    nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  };
}
