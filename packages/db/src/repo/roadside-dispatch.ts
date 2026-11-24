import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { RsaCancelReason, RsaDeclineReason } from '@mechdost/shared/rsa';
import type { RsaStatus } from '@mechdost/shared/state';
import { rsaOfferMachine } from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import { auditLog, rsaOffers, rsaRequests, workshops } from '../schema';
import { issueArrivalCode, readArrivalCode } from './arrival-code';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { requestRefundForRsa } from './refunds';
import { lockRsa, requireRsaStatus, transitionRsa } from './roadside-core';
import {
  paiseText,
  queueRsaEmail,
  queueRsaOfferWhatsApp,
  queueRsaWhatsApp,
  responderName,
} from './roadside-messages';
import { queueRsaCustomerNotice, queueRsaOfferNotice } from './roadside-notices';
import { getRsaSettings } from './roadside-settings';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * Dispatch (spec 22, manual mode): admin sees "Needs dispatch" with ranked suggestions of workshops that opted in,
 * sends one offer with the city's accept timer, and the request returns to the queue on a decline, a timeout or a
 * withdrawn offer. One active offer per request (partial unique index); the request row is locked first by every
 * writer, so a double accept, an accept racing the timeout sweep and a cancel racing an accept each have one winner.
 * Auto routing (`auto`, `auto_then_manual`) is phase 3: the mode is stored, the offer rows already carry `attempt`.
 */
const inScope = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : inArray(rsaRequests.cityId, [...scope.cityIds]);

const scopedCode = (scope: CityScope, code: string) => and(eq(rsaRequests.code, code), inScope(scope));

const inScopeRaw = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`r.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

export type RsaQueueView = 'needs_dispatch' | 'active' | 'closed';

const VIEW: Record<RsaQueueView, SQL> = {
  needs_dispatch: sql`r.status in ('requested', 'offered')`,
  active: sql`r.status in ('accepted', 'en_route', 'arrived', 'in_progress', 'billed')`,
  closed: sql`r.status in ('completed', 'cancelled')`,
};

export interface RsaQueueItem {
  code: string;
  status: RsaStatus;
  version: number;
  vehicleType: string;
  problemType: string | null;
  pincode: string;
  addressLine: string | null;
  advancePaise: number;
  createdAt: string;
  waitingSeconds: number;
  workshopName: string | null;
  offerExpiresAt: string | null;
  attempts: number;
}

export async function listRsaQueue(
  db: Tx,
  scope: CityScope,
  view: RsaQueueView,
  limit = 50,
): Promise<RsaQueueItem[]> {
  const rows = rowsOf<{
    code: string;
    status: string;
    version: unknown;
    vehicle_type: string;
    problem_type: string | null;
    pincode: string;
    address_line: string | null;
    advance_paise: unknown;
    created_at: string;
    waiting_s: unknown;
    workshop_name: string | null;
    offer_expires_at: string | null;
    attempts: unknown;
  }>(
    await db.execute(sql`select r.code, r.status, r.version, r.vehicle_type, r.problem_type, r.pincode, r.address_line,
        r.advance_paise, r.created_at::text as created_at,
        extract(epoch from (now() - r.created_at)) as waiting_s,
        w.name as workshop_name,
        (select o.expires_at::text from rsa_offers o where o.request_id = r.id and o.status = 'offered') as offer_expires_at,
        (select count(*) from rsa_offers o where o.request_id = r.id) as attempts
      from rsa_requests r left join workshops w on w.id = coalesce(r.workshop_id,
        (select o.workshop_id from rsa_offers o where o.request_id = r.id and o.status = 'offered'))
      where ${inScopeRaw(scope)} and ${VIEW[view]}
      order by r.created_at, r.id
      limit ${limit}`),
  );
  return rows.map((r) => ({
    code: r.code,
    status: r.status as RsaStatus,
    version: num(r.version),
    vehicleType: r.vehicle_type,
    problemType: r.problem_type,
    pincode: r.pincode,
    addressLine: r.address_line,
    advancePaise: num(r.advance_paise),
    createdAt: new Date(r.created_at).toISOString(),
    waitingSeconds: Math.floor(num(r.waiting_s)),
    workshopName: r.workshop_name,
    offerExpiresAt: r.offer_expires_at ? new Date(r.offer_expires_at).toISOString() : null,
    attempts: num(r.attempts),
  }));
}

export interface RsaSuggestion {
  workshopId: string;
  name: string;
  nameHi: string | null;
  distanceM: number;
  /** Share of this workshop's recent roadside offers it accepted (1 until it has any). */
  acceptRate: number;
  towing: boolean;
}

/**
 * The eligibility rule, once, in SQL: bookable (published, location verified, approved standing, not busy: a paused,
 * suspended or unpublished workshop is never offered), same city, opted in, serves the vehicle type, handles the
 * problem (or the customer does not know), tows when towing is needed, within its own radius, and has not already
 * declined or timed out on this request. Ranked by distance, then accept rate.
 */
const eligible = (requestId: string, workshopId: SQL) => sql`
  select w.id, w.name, w.name_hi, rr.towing,
    ST_Distance(w.location, r.location)::int as distance_m,
    coalesce(st.accepted::float8 / nullif(st.total, 0), 1) as accept_rate
  from rsa_requests r
  join workshops w on w.city_id = r.city_id
  join rsa_responders rr on rr.workshop_id = w.id and rr.enabled
  left join lateral (
    select count(*) filter (where o.status = 'accepted') as accepted, count(*) as total
    from rsa_offers o
    where o.workshop_id = w.id and o.status in ('accepted', 'declined', 'expired') and o.offered_at > now() - interval '90 days'
  ) st on true
  where r.id = ${requestId}::uuid and ${workshopId}
    and w.published and w.location_verified and w.status = 'approved' and not w.busy
    and r.vehicle_type = any(rr.vehicle_types)
    and (r.problem_type is null or r.problem_type = 'unknown' or r.problem_type = any(rr.problem_types))
    and (r.problem_type is distinct from 'needs_towing' or rr.towing)
    and ST_DWithin(w.location, r.location, rr.radius_km * 1000)
    and not exists (select 1 from rsa_offers o where o.request_id = r.id and o.workshop_id = w.id and o.status in ('declined', 'expired'))
  order by distance_m, accept_rate desc, w.id`;

interface EligibleRow {
  id: string;
  name: string;
  name_hi: string | null;
  towing: boolean;
  distance_m: unknown;
  accept_rate: unknown;
}

export async function suggestRsaResponders(
  db: Tx,
  scope: CityScope,
  code: string,
  limit = 10,
): Promise<RsaSuggestion[]> {
  const [r] = await db
    .select({ id: rsaRequests.id })
    .from(rsaRequests)
    .where(scopedCode(scope, code))
    .limit(1);
  if (!r) throw new NotFoundError('Roadside request not found');
  const rows = rowsOf<EligibleRow>(await db.execute(sql`${eligible(r.id, sql`true`)} limit ${limit}`));
  return rows.map((w) => ({
    workshopId: w.id,
    name: w.name,
    nameHi: w.name_hi,
    distanceM: num(w.distance_m),
    acceptRate: Math.round(num(w.accept_rate) * 100) / 100,
    towing: w.towing,
  }));
}

/** Admin sends the request to one workshop; the timer is the city's. From `requested` only. */
export async function sendRsaOffer(
  db: Tx,
  input: { scope: CityScope; code: string; workshopId: string; expectedVersion: number; staffUserId: string },
): Promise<{ offerId: string; expiresAt: string }> {
  return db.transaction(async (tx) => {
    const r = await lockRsa(tx, scopedCode(input.scope, input.code));
    requireRsaStatus(r, ['requested']);
    // FOR SHARE: a concurrent pause or unpublish waits for this offer (and then applies to it).
    await tx.execute(sql`select id from workshops where id = ${input.workshopId}::uuid for share`);
    const [w] = rowsOf<EligibleRow>(
      await tx.execute(sql`${eligible(r.id, sql`w.id = ${input.workshopId}::uuid`)} limit 1`),
    );
    if (!w) throw new ValidationError('This workshop cannot take this request now', 'WORKSHOP_NOT_ELIGIBLE');
    const settings = await getRsaSettings(tx, r.cityId);
    const [{ n }] = rowsOf<{ n: unknown }>(
      await tx.execute(sql`select count(*) as n from rsa_offers where request_id = ${r.id}::uuid`),
    ) as [{ n: unknown }];
    const attempt = num(n) + 1;
    const [offer] = await tx
      .insert(rsaOffers)
      .values({
        requestId: r.id,
        workshopId: input.workshopId,
        attempt,
        distanceM: num(w.distance_m),
        offeredBy: input.staffUserId,
        expiresAt: sql`now() + make_interval(secs => ${settings.acceptTimerSeconds})`,
      })
      .returning({ id: rsaOffers.id, expiresAt: rsaOffers.expiresAt });
    if (!offer) throw new ConflictError('The offer could not be stored', 'OFFER_NOT_STORED');
    await transitionRsa(tx, {
      request: r,
      to: 'offered',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      payload: { workshopId: input.workshopId, offerId: offer.id, attempt },
      visibleToCustomer: false,
    });
    await queueRsaOfferNotice(tx, {
      requestId: r.id,
      offerId: offer.id,
      workshopId: input.workshopId,
      code: r.code,
      minutes: Math.max(1, Math.ceil(settings.acceptTimerSeconds / 60)),
    });
    await queueRsaOfferWhatsApp(tx, {
      requestId: r.id,
      offerId: offer.id,
      workshopId: input.workshopId,
      code: r.code,
      minutes: Math.max(1, Math.ceil(settings.acceptTimerSeconds / 60)),
    });
    await recordServerEvent(tx, 'rsa_offered', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: input.workshopId, attempt, distanceM: num(w.distance_m) },
    });
    return { offerId: offer.id, expiresAt: offer.expiresAt.toISOString() };
  });
}

/** Closes the one active offer of a request (a conditional UPDATE through the offer machine). */
async function closeOffer(
  tx: Tx,
  input: {
    requestId: string;
    from: 'offered' | 'accepted';
    to: 'declined' | 'expired' | 'withdrawn';
    actor: 'workshop' | 'admin' | 'system';
    reason?: string;
  },
): Promise<{ id: string; workshopId: string; offeredAt: Date } | null> {
  rsaOfferMachine.assert(input.from, input.to, input.actor);
  const [row] = await tx
    .update(rsaOffers)
    .set({
      status: input.to,
      respondedAt: new Date(),
      declineReason: input.to === 'declined' ? (input.reason ?? 'other') : null,
    })
    .where(and(eq(rsaOffers.requestId, input.requestId), eq(rsaOffers.status, input.from)))
    .returning({ id: rsaOffers.id, workshopId: rsaOffers.workshopId, offeredAt: rsaOffers.offeredAt });
  return row ?? null;
}

/** Admin takes the request back from a workshop that has not reached the customer yet (or withdraws a pending offer). */
export async function withdrawRsaOffer(
  db: Tx,
  input: { scope: CityScope; code: string; expectedVersion: number; staffUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await lockRsa(tx, scopedCode(input.scope, input.code));
    requireRsaStatus(r, ['offered', 'accepted', 'en_route']);
    const from = r.status === 'offered' ? 'offered' : 'accepted';
    const closed = await closeOffer(tx, { requestId: r.id, from, to: 'withdrawn', actor: 'admin' });
    await transitionRsa(tx, {
      request: r,
      to: 'requested',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      patch: { workshopId: null },
      payload: { reason: 'withdrawn', offerId: closed?.id ?? null },
      visibleToCustomer: false,
    });
  });
}

/**
 * Admin cancels a request nobody accepted (user ruling 2026-11-24): from `requested`, or from `offered` (the offer is
 * withdrawn). The advance goes back through the refund ledger as ONE refund request per payment (idempotent: a double
 * click or a second cancel finds the first), which finance approves like every refund (decisions 2026-11-15).
 */
export async function cancelRsaByStaff(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    reasonCode: RsaCancelReason;
    note?: string;
    expectedVersion: number;
    staffUserId: string;
  },
): Promise<{ refundId: string | null }> {
  return db.transaction(async (tx) => {
    const r = await lockRsa(tx, scopedCode(input.scope, input.code));
    requireRsaStatus(r, ['requested', 'offered']);
    if (r.status === 'offered')
      await closeOffer(tx, { requestId: r.id, from: 'offered', to: 'withdrawn', actor: 'admin' });
    await transitionRsa(tx, {
      request: r,
      to: 'cancelled',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      patch: { cancelledAt: new Date(), cancelReason: input.reasonCode, cancelNote: input.note ?? null },
      payload: { reasonCode: input.reasonCode },
    });
    const refundId = await requestRefundForRsa(tx, { requestId: r.id, source: 'rsa_cancelled' });
    await queueRsaEmail(tx, {
      template: 'rsa_cancelled',
      requestId: r.id,
      userId: r.userId,
      version: r.version,
      payload: () => ({ requestCode: r.code, amount: paiseText(r.advancePaise) }),
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'rsa.cancelled_by_staff',
      entity: 'rsa_request',
      entityId: r.id,
      after: { reasonCode: input.reasonCode, refundId },
    });
    await recordServerEvent(tx, 'rsa_cancelled', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        by: 'staff',
        reasonCode: input.reasonCode,
        refundRequested: refundId !== null,
      },
    });
    return { refundId };
  });
}

// ── the workshop answers ──────────────────────────────────────────────────────────────────────────────────────

/** The active offer of `code` to one of the caller's workshops, locked after the request row; 404 for anyone else's. */
async function lockOwnOffer(tx: Tx, workshopIds: readonly string[], code: string) {
  if (workshopIds.length === 0) throw new NotFoundError('Roadside request not found');
  const [probe] = await tx
    .select({ id: rsaRequests.id })
    .from(rsaRequests)
    .where(eq(rsaRequests.code, code))
    .limit(1);
  if (!probe) throw new NotFoundError('Roadside request not found');
  const r = await lockRsa(tx, eq(rsaRequests.id, probe.id));
  const [offer] = await tx
    .select({
      id: rsaOffers.id,
      workshopId: rsaOffers.workshopId,
      offeredAt: rsaOffers.offeredAt,
      live: sql<boolean>`${rsaOffers.expiresAt} > now()`,
    })
    .from(rsaOffers)
    .where(
      and(
        eq(rsaOffers.requestId, r.id),
        eq(rsaOffers.status, 'offered'),
        inArray(rsaOffers.workshopId, [...workshopIds]),
      ),
    )
    .for('update')
    .limit(1);
  if (!offer) throw new NotFoundError('Roadside request not found');
  return { r, offer };
}

export async function acceptRsaOffer(
  db: Tx,
  input: { workshopIds: readonly string[]; code: string; staffUserId: string; keyring: Keyring | null },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const { r, offer } = await lockOwnOffer(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['offered']);
    if (!offer.live) throw new ConflictError('This offer has run out of time', 'OFFER_EXPIRED');
    // A workshop paused, suspended, unpublished or marked busy after the offer went out cannot take the job (FOR SHARE: a
    // concurrent pause waits for this accept and then applies to it).
    const [standing] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`select (w.published and w.status = 'approved' and not w.busy) as ok
        from workshops w where w.id = ${offer.workshopId}::uuid for share`),
    );
    if (!standing?.ok)
      throw new ValidationError('This workshop cannot take requests now', 'WORKSHOP_NOT_ELIGIBLE');
    const closed = await tx
      .update(rsaOffers)
      .set({ status: 'accepted', respondedAt: new Date() })
      .where(and(eq(rsaOffers.id, offer.id), eq(rsaOffers.status, 'offered')))
      .returning({ id: rsaOffers.id });
    if (closed.length === 0) throw new ConflictError('This offer was already answered', 'OFFER_ANSWERED');
    const secondsToAccept = Math.max(0, Math.round((Date.now() - offer.offeredAt.getTime()) / 1000));
    const moved = await transitionRsa(tx, {
      request: r,
      to: 'accepted',
      expectedVersion: r.version,
      actor: { type: 'workshop', userId: input.staffUserId },
      patch: { workshopId: offer.workshopId },
      payload: { workshopId: offer.workshopId, offerId: offer.id },
    });
    await issueArrivalCode(tx, input.keyring, r.id, 'rsa');
    const [w] = await tx
      .select({ name: workshops.name })
      .from(workshops)
      .where(eq(workshops.id, offer.workshopId))
      .limit(1);
    await queueRsaCustomerNotice(tx, {
      kind: 'rsa.accepted',
      requestId: r.id,
      userId: r.userId,
      code: r.code,
      workshopName: w?.name ?? '',
      version: moved.version,
    });
    // The arrival code goes in the email only (the customer asked to have it in writing); push and WhatsApp never carry it.
    const arrival = await readArrivalCode(tx, input.keyring, r.id, 'rsa');
    await queueRsaEmail(tx, {
      template: 'rsa_accepted',
      requestId: r.id,
      userId: r.userId,
      version: moved.version,
      payload: async (locale) => ({
        requestCode: r.code,
        workshopName: await responderName(tx, offer.workshopId, locale),
        arrivalCode: arrival?.code ?? '',
      }),
    });
    await queueRsaWhatsApp(tx, {
      event: 'rsa.accepted',
      requestId: r.id,
      userId: r.userId,
      code: r.code,
      version: moved.version,
    });
    await recordServerEvent(tx, 'rsa_accepted', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: offer.workshopId, secondsToAccept },
    });
    return { version: moved.version };
  });
}

export async function declineRsaOffer(
  db: Tx,
  input: { workshopIds: readonly string[]; code: string; staffUserId: string; reasonCode: RsaDeclineReason },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { r, offer } = await lockOwnOffer(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['offered']);
    await closeOffer(tx, {
      requestId: r.id,
      from: 'offered',
      to: 'declined',
      actor: 'workshop',
      reason: input.reasonCode,
    });
    await transitionRsa(tx, {
      request: r,
      to: 'requested',
      expectedVersion: r.version,
      actor: { type: 'workshop', userId: input.staffUserId },
      payload: { reason: 'declined', reasonCode: input.reasonCode, workshopId: offer.workshopId },
      visibleToCustomer: false,
    });
    await recordServerEvent(tx, 'rsa_declined', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: offer.workshopId, reasonCode: input.reasonCode },
    });
  });
}

/** One offer past its timer goes back to the queue; false when it was answered meanwhile. */
export async function expireRsaOffer(db: Tx, offerId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({ requestId: rsaOffers.requestId })
      .from(rsaOffers)
      .where(eq(rsaOffers.id, offerId))
      .limit(1);
    if (!o) return false;
    const r = await lockRsa(tx, eq(rsaRequests.id, o.requestId));
    // Read again under the request lock: an accept that won the lock first leaves nothing to expire.
    const [live] = await tx
      .select({ id: rsaOffers.id, workshopId: rsaOffers.workshopId })
      .from(rsaOffers)
      .where(
        and(eq(rsaOffers.id, offerId), eq(rsaOffers.status, 'offered'), sql`${rsaOffers.expiresAt} <= now()`),
      )
      .for('update');
    if (!live || r.status !== 'offered') return false;
    await closeOffer(tx, { requestId: r.id, from: 'offered', to: 'expired', actor: 'system' });
    await transitionRsa(tx, {
      request: r,
      to: 'requested',
      expectedVersion: r.version,
      actor: { type: 'system', userId: null },
      payload: { reason: 'offer_timeout', workshopId: live.workshopId },
      visibleToCustomer: false,
    });
    await recordServerEvent(tx, 'rsa_timeout', {
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: live.workshopId },
    });
    return true;
  });
}

/** Worker sweep (every 30 s): every offer past its timer, oldest first. One bad row never blocks the rest. */
export async function expireDueRsaOffers(
  db: Tx,
  limit = 50,
): Promise<{ expired: number; failed: { offerId: string; error: unknown }[] }> {
  const due = rowsOf<{ id: string }>(
    await db.execute(sql`select id from rsa_offers where status = 'offered' and expires_at <= now()
      order by expires_at limit ${limit}`),
  );
  let expired = 0;
  const failed: { offerId: string; error: unknown }[] = [];
  for (const d of due) {
    try {
      if (await expireRsaOffer(db, d.id)) expired += 1;
    } catch (error) {
      failed.push({ offerId: d.id, error });
    }
  }
  return { expired, failed };
}
