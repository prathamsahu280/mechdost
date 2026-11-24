import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import type { RsaProblemType } from '@mechdost/shared/rsa';
import type { CreateRsaRequestInput } from '@mechdost/shared/rsa-api';
import type { RsaStatus } from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import {
  cities,
  pincodes,
  refunds,
  rsaBillLines,
  rsaEvents,
  rsaRequests,
  supportTickets,
  workshops,
} from '../schema';
import { readArrivalCode } from './arrival-code';
import { ConflictError, NotFoundError, ValidationError, pgCode } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { lockRsa, requireRsaStatus, transitionRsa } from './roadside-core';
import { assertRsaServiceable, getRsaSettings } from './roadside-settings';
import { createSupportTicket } from './support';
import { rowsOf } from './sql-rows';

/**
 * The customer's side of a roadside request (spec 22). Create is idempotent per (user, `Idempotency-Key`), snapshots the
 * advance from the city settings (the amount every payment is asserted against later), refuses a location outside the
 * active PIN codes or hours before any Razorpay order exists, and allows one live request per customer (unique index).
 * Every read is scoped to the customer in SQL: another person's code is 404.
 */
export interface RsaCreated {
  code: string;
  status: RsaStatus;
  version: number;
  advancePaise: number;
  replayed: boolean;
}

const CODE_RETRIES = 5;

export async function createRsaRequest(
  db: Tx,
  input: { userId: string; idemKey: string; request: CreateRsaRequestInput; now?: Date },
): Promise<RsaCreated> {
  const b = input.request;
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const find = async (where: ReturnType<typeof and>) => {
      const [row] = await tx
        .select({
          code: rsaRequests.code,
          status: rsaRequests.status,
          version: rsaRequests.version,
          advancePaise: rsaRequests.advancePaise,
        })
        .from(rsaRequests)
        .where(where)
        .limit(1);
      return row ? { ...row, status: row.status as RsaStatus } : null;
    };
    const earlier = await find(
      and(eq(rsaRequests.userId, input.userId), eq(rsaRequests.idemKey, input.idemKey)),
    );
    if (earlier) return { ...earlier, replayed: true };

    const [place] = await tx
      .select({ cityId: pincodes.cityId, cityCode: cities.code })
      .from(pincodes)
      .innerJoin(cities, eq(cities.id, pincodes.cityId))
      .where(and(eq(pincodes.pincode, b.pincode), eq(pincodes.active, true)))
      .limit(1);
    if (!place?.cityId) throw new ValidationError('We do not serve this PIN code yet', 'PINCODE_NOT_SERVED');
    const settings = await getRsaSettings(tx, place.cityId);
    assertRsaServiceable(settings, {
      pincode: b.pincode,
      vehicleType: b.vehicleType,
      problemType: b.problemType ?? null,
      now,
    });
    // The pin must be inside the city (abuse guard: a covered PIN code with a point in another town). Skipped for a city
    // with no centre set.
    const [near] = rowsOf<{ ok: boolean | null }>(
      await tx.execute(sql`select (c.centroid is null or ST_DWithin(c.centroid,
          ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326)::geography, c.radius_km * 1000)) as ok
        from cities c where c.id = ${place.cityId}::uuid`),
    );
    if (near?.ok === false)
      throw new ValidationError('The location is outside this city', 'RSA_LOCATION_OUTSIDE', undefined);
    const advancePaise = settings.advancePaise[b.vehicleType];
    if (advancePaise === undefined || advancePaise <= 0)
      throw new ValidationError(
        'Roadside help is not offered for this vehicle type',
        'RSA_VEHICLE_NOT_OFFERED',
      );

    const live = await find(
      and(eq(rsaRequests.userId, input.userId), sql`${rsaRequests.status} not in ('completed','cancelled')`),
    );
    if (live) throw new ConflictError('You already have a roadside request open', 'RSA_ALREADY_OPEN');

    for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
      const code = publicCode('RSA', place.cityCode, now);
      await tx.execute(sql`savepoint rsa_create`);
      try {
        const [row] = await tx
          .insert(rsaRequests)
          .values({
            code,
            cityId: place.cityId,
            userId: input.userId,
            status: 'awaiting_payment',
            vehicleType: b.vehicleType,
            fuel: b.fuel,
            vehicleLabel: b.vehicleLabel ?? null,
            problemType: b.problemType ?? null,
            note: b.note ?? null,
            location: { lat: b.lat, lng: b.lng },
            pincode: b.pincode,
            addressLine: b.addressLine ?? null,
            advancePaise,
            idemKey: input.idemKey,
            createdBy: input.userId,
          })
          .returning({ id: rsaRequests.id, version: rsaRequests.version });
        if (!row) throw new ConflictError('Request could not be stored', 'RSA_NOT_STORED');
        await tx.execute(sql`release savepoint rsa_create`);
        await tx.insert(rsaEvents).values({
          requestId: row.id,
          fromStatus: null,
          toStatus: 'awaiting_payment',
          actorType: 'customer',
          actorId: input.userId,
          payload: { advancePaise },
        });
        await recordServerEvent(tx, 'rsa_created', {
          userId: input.userId,
          cityId: place.cityId,
          props: {
            requestCode: code,
            vehicleType: b.vehicleType,
            problemType: b.problemType ?? 'skipped',
            advancePaise,
          },
        });
        return {
          code,
          status: 'awaiting_payment' as const,
          version: row.version,
          advancePaise,
          replayed: false,
        };
      } catch (err) {
        await tx.execute(sql`rollback to savepoint rsa_create`);
        // 23505: a code collision (retry) or the one-live-request index (a racing second tap).
        if (pgCode(err) !== '23505') throw err;
        const raced = await find(
          and(eq(rsaRequests.userId, input.userId), eq(rsaRequests.idemKey, input.idemKey)),
        );
        if (raced) return { ...raced, replayed: true };
        const another = await find(
          and(
            eq(rsaRequests.userId, input.userId),
            sql`${rsaRequests.status} not in ('completed','cancelled')`,
          ),
        );
        if (another) throw new ConflictError('You already have a roadside request open', 'RSA_ALREADY_OPEN');
      }
    }
    throw new ConflictError('Could not make a request code, try again', 'RSA_CODE_BUSY');
  });
}

export interface RsaBillView {
  lines: {
    kind: string;
    description: string;
    quantity: number;
    unitPricePaise: number;
    totalPaise: number;
  }[];
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  overpaidPaise: number;
  balanceMethod: string | null;
  balancePaidAt: string | null;
}

export interface RsaCustomerView {
  code: string;
  status: RsaStatus;
  version: number;
  vehicleType: string;
  fuel: string;
  vehicleLabel: string | null;
  problemType: RsaProblemType | null;
  note: string | null;
  pincode: string;
  addressLine: string | null;
  advancePaise: number;
  advancePaid: boolean;
  createdAt: string;
  cancelReason: string | null;
  responder: { workshopName: string; workshopNameHi: string | null } | null;
  /** Shown to the customer from acceptance until the mechanic is at the vehicle; null after. */
  arrivalCode: string | null;
  arrivalLocked: boolean;
  bill: RsaBillView | null;
  /** A question about the bill is open with support; the balance stays payable meanwhile. */
  disputeOpen: boolean;
  /** Whether the city lets customers question a bill (setting, off by default). */
  disputeAvailable: boolean;
  timeline: { status: RsaStatus; at: string }[];
  refunds: {
    amountPaise: number;
    stage: 'under_review' | 'processing' | 'refunded' | 'declined' | 'failed';
  }[];
}

const stage = (s: string): RsaCustomerView['refunds'][number]['stage'] =>
  s === 'processed'
    ? 'refunded'
    : s === 'rejected'
      ? 'declined'
      : s === 'failed'
        ? 'failed'
        : s === 'requested'
          ? 'under_review'
          : 'processing';

/** Everything the tracking page shows, for the owner only (404 for any other user). */
export async function getCustomerRsa(
  db: Tx,
  input: { userId: string; code: string; keyring: Keyring | null },
): Promise<RsaCustomerView> {
  const [r] = await db
    .select({
      r: rsaRequests,
      workshopName: workshops.name,
      workshopNameHi: workshops.nameHi,
    })
    .from(rsaRequests)
    .leftJoin(workshops, eq(workshops.id, rsaRequests.workshopId))
    .where(and(eq(rsaRequests.code, input.code), eq(rsaRequests.userId, input.userId)))
    .limit(1);
  if (!r) throw new NotFoundError('Roadside request not found');
  const q = r.r;
  const status = q.status as RsaStatus;
  const [lines, events, refundRows] = await Promise.all([
    db
      .select()
      .from(rsaBillLines)
      .where(eq(rsaBillLines.requestId, q.id))
      .orderBy(asc(rsaBillLines.position)),
    db
      .select({ toStatus: rsaEvents.toStatus, createdAt: rsaEvents.createdAt })
      .from(rsaEvents)
      .where(and(eq(rsaEvents.requestId, q.id), eq(rsaEvents.visibleToCustomer, true)))
      .orderBy(asc(rsaEvents.id)),
    db
      .select({ amountPaise: refunds.amountPaise, status: refunds.status })
      .from(refunds)
      .where(eq(refunds.rsaRequestId, q.id))
      .orderBy(desc(refunds.createdAt)),
  ]);
  const showCode = status === 'accepted' || status === 'en_route';
  const code = showCode ? await readArrivalCode(db, input.keyring, q.id, 'rsa') : null;
  return {
    code: q.code,
    status,
    version: q.version,
    vehicleType: q.vehicleType,
    fuel: q.fuel,
    vehicleLabel: q.vehicleLabel,
    problemType: q.problemType as RsaProblemType | null,
    note: q.note,
    pincode: q.pincode,
    addressLine: q.addressLine,
    advancePaise: q.advancePaise,
    advancePaid: q.advancePaidAt !== null,
    createdAt: q.createdAt.toISOString(),
    cancelReason: q.cancelReason,
    responder: r.workshopName ? { workshopName: r.workshopName, workshopNameHi: r.workshopNameHi } : null,
    arrivalCode: code?.code ?? null,
    arrivalLocked: code?.locked ?? false,
    bill:
      q.totalPaise === null
        ? null
        : {
            lines: lines.map((l) => ({
              kind: l.kind,
              description: l.description,
              quantity: l.quantity,
              unitPricePaise: l.unitPricePaise,
              totalPaise: l.totalPaise,
            })),
            totalPaise: q.totalPaise,
            advancePaise: q.advancePaise,
            balancePaise: q.balancePaise ?? 0,
            overpaidPaise: q.overpaidPaise ?? 0,
            balanceMethod: q.balanceMethod,
            balancePaidAt: q.balancePaidAt ? q.balancePaidAt.toISOString() : null,
          },
    disputeOpen: await hasOpenDispute(db, q.id),
    disputeAvailable: (await getRsaSettings(db, q.cityId)).billDisputeEnabled,
    timeline: events.map((e) => ({ status: e.toStatus as RsaStatus, at: e.createdAt.toISOString() })),
    refunds: refundRows.map((x) => ({ amountPaise: x.amountPaise, stage: stage(x.status) })),
  };
}

export interface RsaSummary {
  code: string;
  status: RsaStatus;
  vehicleType: string;
  problemType: string | null;
  createdAt: string;
}

/** The customer's own requests, newest first (a small list: no cursor needed under the live-request rule). */
export async function listCustomerRsa(db: Tx, userId: string, limit = 20): Promise<RsaSummary[]> {
  const rows = await db
    .select({
      code: rsaRequests.code,
      status: rsaRequests.status,
      vehicleType: rsaRequests.vehicleType,
      problemType: rsaRequests.problemType,
      createdAt: rsaRequests.createdAt,
    })
    .from(rsaRequests)
    .where(eq(rsaRequests.userId, userId))
    .orderBy(desc(rsaRequests.createdAt), desc(rsaRequests.id))
    .limit(limit);
  return rows.map((r) => ({
    code: r.code,
    status: r.status as RsaStatus,
    vehicleType: r.vehicleType,
    problemType: r.problemType,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The customer drops a request they never paid for (the only customer cancellation at launch). */
export async function cancelUnpaidRsa(db: Tx, input: { userId: string; code: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await lockRsa(tx, and(eq(rsaRequests.code, input.code), eq(rsaRequests.userId, input.userId)));
    requireRsaStatus(r, ['awaiting_payment']);
    await transitionRsa(tx, {
      request: r,
      to: 'cancelled',
      expectedVersion: r.version,
      actor: { type: 'customer', userId: input.userId },
      patch: { cancelledAt: new Date(), cancelReason: 'customer_abandoned' },
      payload: { reason: 'customer_abandoned' },
    });
    await recordServerEvent(tx, 'rsa_cancelled', {
      userId: input.userId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        by: 'customer',
        reasonCode: 'customer_abandoned',
        refundRequested: false,
      },
    });
  });
}

/** The worker closes requests whose advance was not paid within the window (nothing was charged, so no refund). */
export async function expireUnpaidRsa(
  db: Tx,
  input: { olderThanMinutes: number; limit?: number },
): Promise<{ closed: number; failed: { requestId: string; error: unknown }[] }> {
  const due = rowsOf<{ id: string }>(
    await db.execute(sql`select id from rsa_requests
      where status = 'awaiting_payment' and created_at < now() - make_interval(mins => ${input.olderThanMinutes})
      order by created_at limit ${input.limit ?? 50}`),
  );
  let closed = 0;
  const failed: { requestId: string; error: unknown }[] = [];
  for (const d of due) {
    try {
      await db.transaction(async (tx) => {
        const r = await lockRsa(tx, eq(rsaRequests.id, d.id));
        if (r.status !== 'awaiting_payment') return;
        await transitionRsa(tx, {
          request: r,
          to: 'cancelled',
          expectedVersion: r.version,
          actor: { type: 'system', userId: null },
          patch: { cancelledAt: new Date(), cancelReason: 'payment_window_expired' },
          payload: { reason: 'payment_window_expired' },
        });
        await recordServerEvent(tx, 'rsa_cancelled', {
          cityId: r.cityId,
          props: {
            requestCode: r.code,
            by: 'system',
            reasonCode: 'payment_window_expired',
            refundRequested: false,
          },
        });
        closed += 1;
      });
    } catch (error) {
      // One bad row never blocks the rest; the caller logs it and the next sweep tries it again.
      failed.push({ requestId: d.id, error });
    }
  }
  return { closed, failed };
}

const OPEN_TICKET = ['open', 'in_review', 'awaiting_customer'];

/** Is a question about this request's bill open with support? */
export async function hasOpenDispute(db: Tx, requestId: string): Promise<boolean> {
  const n = await db.$count(
    supportTickets,
    and(
      eq(supportTickets.rsaRequestId, requestId),
      eq(supportTickets.kind, 'rsa_bill_dispute'),
      inArray(supportTickets.status, OPEN_TICKET),
    ),
  );
  return n > 0;
}

/**
 * The customer questions a bill that is ready (spec 22): a support request linked to the roadside request (kind
 * `rsa_bill_dispute`, one open per bill). Nothing else changes: the balance stays payable while it is open, staff see it
 * in the support inbox, and a refund still goes through the refund queue.
 */
export async function openRsaBillDispute(
  db: Tx,
  input: { userId: string; code: string; note?: string; defaultCityCode: string },
): Promise<{ ticketCode: string }> {
  const [own] = await db
    .select({ cityId: rsaRequests.cityId })
    .from(rsaRequests)
    .where(and(eq(rsaRequests.code, input.code), eq(rsaRequests.userId, input.userId)))
    .limit(1);
  if (!own) throw new NotFoundError('Roadside request not found');
  if (!(await getRsaSettings(db, own.cityId)).billDisputeEnabled)
    throw new ConflictError('Questioning a bill is not switched on here', 'RSA_DISPUTE_OFF');
  const out = await createSupportTicket(db, {
    userId: input.userId,
    kind: 'rsa_bill_dispute',
    orderCode: null,
    rsaCode: input.code,
    body: input.note ?? 'The customer questions this roadside bill.',
    defaultCityCode: input.defaultCityCode,
  });
  await db.transaction(async (tx) => {
    const [q] = await tx
      .select({ cityId: rsaRequests.cityId, totalPaise: rsaRequests.totalPaise })
      .from(rsaRequests)
      .where(and(eq(rsaRequests.code, input.code), eq(rsaRequests.userId, input.userId)))
      .limit(1);
    if (q)
      await recordServerEvent(tx, 'rsa_bill_disputed', {
        userId: input.userId,
        cityId: q.cityId,
        props: { requestCode: input.code, totalPaise: q.totalPaise ?? 0 },
      });
  });
  return { ticketCode: out.code };
}
