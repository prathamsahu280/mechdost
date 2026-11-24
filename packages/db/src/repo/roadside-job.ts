import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  RSA_MAX_BILL_PAISE,
  rsaBalancePaise,
  rsaLineTotalPaise,
  rsaOverpaidPaise,
  type RsaBillLineKind,
  type RsaProblemType,
} from '@mechdost/shared/rsa';
import type { RsaStatus } from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import { auditLog, rsaArrivalCodes, rsaBillLines, rsaRequests, workshops } from '../schema';
import { ARRIVAL_CODE_MAX_ATTEMPTS, verifyArrivalCode, type ArrivalCheck } from './arrival-code';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { queueStaffNotice } from './notices';
import { requestRefundForRsa } from './refunds';
import { getRsaSettings } from './roadside-settings';
import { lockRsa, requireRsaStatus, transitionRsa, type RsaCore } from './roadside-core';
import { paiseText, queueRsaEmail, queueRsaWhatsApp, responderName } from './roadside-messages';
import { queueRsaCustomerNotice } from './roadside-notices';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * The responder's job (spec 22): on the way, arrival (the customer's code, 5 tries, audited admin override), start work,
 * the bill (lines -> total -> balance = max(total - advance, 0); a total under the advance raises a refund request for the
 * difference; a zero balance completes at once without a Razorpay order) and cash payment of the balance. Every query is
 * scoped to the workshops in the caller's grants: another workshop's job is 404. The request row is locked first, so a
 * cash mark and an online capture of the balance have exactly one winner.
 */
interface Line {
  kind: RsaBillLineKind;
  description: string;
  quantity: number;
  unitPricePaise: number;
}

interface StepInput {
  workshopIds: readonly string[];
  code: string;
  staffUserId: string;
  expectedVersion: number;
}

async function jobFor(tx: Tx, workshopIds: readonly string[], code: string): Promise<RsaCore> {
  if (workshopIds.length === 0) throw new NotFoundError('Roadside request not found');
  return lockRsa(tx, and(eq(rsaRequests.code, code), inArray(rsaRequests.workshopId, [...workshopIds])));
}

const workshopActor = (userId: string) => ({ type: 'workshop' as const, userId });

async function workshopName(tx: Tx, id: string | null): Promise<string> {
  if (!id) return '';
  const [w] = await tx.select({ name: workshops.name }).from(workshops).where(eq(workshops.id, id)).limit(1);
  return w?.name ?? '';
}

export async function markRsaEnRoute(db: Tx, input: StepInput): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['accepted']);
    const moved = await transitionRsa(tx, {
      request: r,
      to: 'en_route',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
    });
    await recordServerEvent(tx, 'rsa_en_route', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: r.workshopId ?? '' },
    });
    return { version: moved.version };
  });
}

async function arriveInTx(
  tx: Tx,
  r: RsaCore,
  input: {
    expectedVersion: number;
    actorUserId: string;
    actor: 'workshop' | 'admin';
    via: 'code' | 'override';
    reason?: string;
  },
) {
  const moved = await transitionRsa(tx, {
    request: r,
    to: 'arrived',
    expectedVersion: input.expectedVersion,
    actor: { type: input.actor, userId: input.actorUserId },
    payload: { via: input.via, ...(input.reason ? { reason: input.reason } : {}) },
  });
  await queueRsaCustomerNotice(tx, {
    kind: 'rsa.arrived',
    requestId: r.id,
    userId: r.userId,
    code: r.code,
    workshopName: await workshopName(tx, r.workshopId),
    version: moved.version,
  });
  await queueRsaEmail(tx, {
    template: 'rsa_arrived',
    requestId: r.id,
    userId: r.userId,
    version: moved.version,
    payload: async (locale) => ({
      requestCode: r.code,
      workshopName: await responderName(tx, r.workshopId, locale),
    }),
  });
  await queueRsaWhatsApp(tx, {
    event: 'rsa.arrived',
    requestId: r.id,
    userId: r.userId,
    code: r.code,
    version: moved.version,
  });
  await recordServerEvent(tx, 'rsa_arrived', {
    userId: input.actorUserId,
    cityId: r.cityId,
    props: { requestCode: r.code, workshopId: r.workshopId ?? '', via: input.via },
  });
  return { version: moved.version };
}

/** The responder is at the vehicle and enters the customer's code. A wrong try is returned (and counted), not thrown. */
export async function confirmRsaArrival(
  db: Tx,
  input: StepInput & { arrivalCode: string; keyring: Keyring | null },
): Promise<ArrivalCheck | { ok: true; version: number }> {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['accepted', 'en_route']);
    const check = await verifyArrivalCode(tx, input.keyring, r.id, input.arrivalCode, 'rsa');
    if (!check.ok) return check;
    const out = await arriveInTx(tx, r, {
      expectedVersion: input.expectedVersion,
      actorUserId: input.staffUserId,
      actor: 'workshop',
      via: 'code',
    });
    return { ok: true as const, ...out };
  });
}

/** Staff let a job continue without the code (a locked code, a customer who lost their phone): audited with a reason. */
export async function overrideRsaArrival(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    reason: string;
    expectedVersion: number;
    staffUserId: string;
    /**
     * Where the caller may edit roadside settings (super admin / city admin): there an override works even before the
     * code is locked. Checked against this request's own city after the row lock (security review 2026-11-24).
     * Everyone else needs the 5-try lock first.
     */
    bypassScope?: CityScope;
  },
): Promise<{ version: number }> {
  if (input.reason.trim().length < 5)
    throw new ValidationError('Give a reason of at least 5 characters', 'REASON_REQUIRED');
  return db.transaction(async (tx) => {
    const r = await lockRsa(
      tx,
      and(
        eq(rsaRequests.code, input.code),
        input.scope.all
          ? sql`true`
          : input.scope.cityIds.length === 0
            ? sql`false`
            : inArray(rsaRequests.cityId, [...input.scope.cityIds]),
      ),
    );
    requireRsaStatus(r, ['accepted', 'en_route']);
    const [code] = await tx
      .select({ attempts: rsaArrivalCodes.attempts })
      .from(rsaArrivalCodes)
      .where(eq(rsaArrivalCodes.requestId, r.id))
      .limit(1);
    const bypass =
      input.bypassScope !== undefined &&
      (input.bypassScope.all || input.bypassScope.cityIds.includes(r.cityId));
    if (!bypass && (code?.attempts ?? 0) < ARRIVAL_CODE_MAX_ATTEMPTS)
      throw new ConflictError('The arrival code is not locked yet', 'ARRIVAL_CODE_NOT_LOCKED');
    const out = await arriveInTx(tx, r, {
      expectedVersion: input.expectedVersion,
      actorUserId: input.staffUserId,
      actor: 'admin',
      via: 'override',
      reason: input.reason.trim(),
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'rsa.arrival_override',
      entity: 'rsa_request',
      entityId: r.id,
      after: { reason: input.reason.trim() },
    });
    return out;
  });
}

export async function startRsaWork(db: Tx, input: StepInput): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['arrived']);
    const moved = await transitionRsa(tx, {
      request: r,
      to: 'in_progress',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
    });
    return { version: moved.version };
  });
}

export interface RsaBilled {
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  overpaidPaise: number;
  completed: boolean;
  refundId: string | null;
}

/**
 * The responder enters the bill once. Money maths lives in `rsaBalancePaise` / `rsaOverpaidPaise` and again in the
 * table CHECK. Lines are append-only (trigger), so a bill can never be edited after the customer has seen it.
 */
export async function billRsa(db: Tx, input: StepInput & { lines: readonly Line[] }): Promise<RsaBilled> {
  const lines = input.lines.map((l) => ({
    ...l,
    totalPaise: rsaLineTotalPaise(l.quantity, l.unitPricePaise),
  }));
  const totalPaise = lines.reduce((n, l) => n + l.totalPaise, 0);
  if (lines.length === 0 || totalPaise <= 0)
    throw new ValidationError('The bill needs a total above zero', 'BILL_EMPTY'); // Absolute ceiling; the city's own (admin) ceiling is checked under the lock below.
  if (totalPaise > RSA_MAX_BILL_PAISE)
    throw new ValidationError('The bill is above the limit', 'BILL_TOO_LARGE');
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['in_progress']);
    const { maxBillPaise } = await getRsaSettings(tx, r.cityId);
    if (totalPaise > maxBillPaise)
      throw new ValidationError('The bill is above the limit for this city', 'BILL_TOO_LARGE', {
        maxPaise: maxBillPaise,
      });
    const balancePaise = rsaBalancePaise(totalPaise, r.advancePaise);
    const overpaidPaise = rsaOverpaidPaise(totalPaise, r.advancePaise);
    const rows = lines.map((l, i) => ({
      requestId: r.id,
      position: i + 1,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      totalPaise: l.totalPaise,
      createdBy: input.staffUserId,
    }));
    await tx.insert(rsaBillLines).values(rows);
    const moved = await transitionRsa(tx, {
      request: r,
      to: 'billed',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      patch: { totalPaise, balancePaise, overpaidPaise, billedAt: new Date() },
      payload: { totalPaise, balancePaise, overpaidPaise, lines: rows.length },
    });
    await recordServerEvent(tx, 'rsa_billed', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        workshopId: r.workshopId ?? '',
        totalPaise,
        lines: rows.length,
        balancePaise,
      },
    });
    const refundId =
      overpaidPaise > 0
        ? await requestRefundForRsa(tx, {
            requestId: r.id,
            source: 'rsa_overpaid',
            amountPaise: overpaidPaise,
          })
        : null;
    if (balancePaise === 0) {
      // The advance covers the bill: nothing to pay, so no Razorpay order (a zero amount is refused by CHECK).
      await finishRsa(tx, r, { method: 'none', actor: { type: 'system', userId: null } });
      return {
        totalPaise,
        advancePaise: r.advancePaise,
        balancePaise,
        overpaidPaise,
        completed: true,
        refundId,
      };
    }
    await queueRsaEmail(tx, {
      template: 'rsa_bill_ready',
      requestId: r.id,
      userId: r.userId,
      version: moved.version,
      payload: async (locale) => ({
        requestCode: r.code,
        workshopName: await responderName(tx, r.workshopId, locale),
        total: paiseText(totalPaise),
        advance: paiseText(Math.min(r.advancePaise, totalPaise)),
        balance: paiseText(balancePaise),
      }),
    });
    await queueRsaWhatsApp(tx, {
      event: 'rsa.bill_ready',
      requestId: r.id,
      userId: r.userId,
      code: r.code,
      version: moved.version,
    });
    await queueRsaCustomerNotice(tx, {
      kind: 'rsa.bill_ready',
      requestId: r.id,
      userId: r.userId,
      code: r.code,
      workshopName: await workshopName(tx, r.workshopId),
      version: moved.version,
    });
    return {
      totalPaise,
      advancePaise: r.advancePaise,
      balancePaise,
      overpaidPaise,
      completed: false,
      refundId,
    };
  });
}

/** billed -> completed; the single place a roadside job is finished (online capture, cash, or a covered bill). */
export async function finishRsa(
  tx: Tx,
  r: RsaCore,
  how: { method: 'online' | 'cash' | 'none'; actor: { type: 'system' | 'workshop'; userId: string | null } },
): Promise<void> {
  await transitionRsa(tx, {
    request: r,
    to: 'completed',
    expectedVersion: r.version,
    actor: how.actor,
    patch: {
      balanceMethod: how.method,
      completedAt: new Date(),
      ...(how.method === 'none' ? {} : { balancePaidAt: new Date() }),
    },
    payload: { method: how.method },
  });
  await queueRsaEmail(tx, {
    template: 'rsa_completed',
    requestId: r.id,
    userId: r.userId,
    version: r.version,
    payload: async (locale) => ({
      requestCode: r.code,
      workshopName: await responderName(tx, r.workshopId, locale),
      total: paiseText(r.totalPaise ?? 0),
    }),
  });
  await recordServerEvent(tx, 'rsa_completed', {
    userId: how.actor.userId,
    cityId: r.cityId,
    props: {
      requestCode: r.code,
      workshopId: r.workshopId,
      totalPaise: r.totalPaise ?? 0,
      via: how.method === 'none' ? 'advance_covers' : how.method,
    },
  });
}

/** The customer paid the balance in cash: the responder marks it. Refused when nothing is owed (it completed at billing). */
export async function markRsaBalanceCash(db: Tx, input: StepInput): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await jobFor(tx, input.workshopIds, input.code);
    requireRsaStatus(r, ['billed']);
    if (r.version !== input.expectedVersion)
      throw new ConflictError('This request changed meanwhile; reload it and try again', 'STALE_REQUEST');
    if ((r.balancePaise ?? 0) <= 0) throw new ConflictError('Nothing is left to pay', 'NOTHING_TO_PAY');
    const amountPaise = r.balancePaise ?? 0;
    await finishRsa(tx, r, { method: 'cash', actor: workshopActor(input.staffUserId) });
    // A cash balance is the one payment nobody but the workshop saw: ops are told, whatever the amount (spec 22).
    await queueStaffNotice(tx, {
      kind: 'staff.rsa_cash',
      cityId: r.cityId,
      entityId: r.id,
      version: r.version,
      params: { requestCode: r.code },
    });
    await recordServerEvent(tx, 'rsa_cash_marked', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: r.workshopId ?? '', amountPaise },
    });
  });
}

// ── the responder's list ──────────────────────────────────────────────────────────────────────────────────────

export interface RsaWorkshopOffer {
  code: string;
  vehicleType: string;
  fuel: string;
  problemType: RsaProblemType | null;
  pincode: string;
  distanceM: number | null;
  expiresAt: string;
  workshopId: string;
}

export interface RsaWorkshopJob {
  code: string;
  status: RsaStatus;
  version: number;
  workshopId: string;
  vehicleType: string;
  fuel: string;
  vehicleLabel: string | null;
  problemType: RsaProblemType | null;
  note: string | null;
  pincode: string;
  addressLine: string | null;
  lat: number;
  lng: number;
  advancePaise: number;
  totalPaise: number | null;
  balancePaise: number | null;
  arrivalLocked: boolean;
}

/** Offers waiting for the caller's workshops and the jobs they hold. Never the customer's phone or name. */
export async function listWorkshopRsa(
  db: Tx,
  workshopIds: readonly string[],
): Promise<{ offers: RsaWorkshopOffer[]; jobs: RsaWorkshopJob[] }> {
  if (workshopIds.length === 0) return { offers: [], jobs: [] };
  const ids = sql.join(
    workshopIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const offers = rowsOf<{
    code: string;
    vehicle_type: string;
    fuel: string;
    problem_type: string | null;
    pincode: string;
    distance_m: unknown;
    expires_at: string;
    workshop_id: string;
  }>(
    await db.execute(sql`select r.code, r.vehicle_type, r.fuel, r.problem_type, r.pincode,
        o.distance_m, o.expires_at::text as expires_at, o.workshop_id
      from rsa_offers o join rsa_requests r on r.id = o.request_id
      where o.workshop_id in (${ids}) and o.status = 'offered' and o.expires_at > now()
      order by o.expires_at, o.id limit 50`),
  );
  const jobs = rowsOf<{
    code: string;
    status: string;
    version: unknown;
    workshop_id: string;
    vehicle_type: string;
    fuel: string;
    vehicle_label: string | null;
    problem_type: string | null;
    note: string | null;
    pincode: string;
    address_line: string | null;
    lat: unknown;
    lng: unknown;
    advance_paise: unknown;
    total_paise: unknown;
    balance_paise: unknown;
    locked: boolean;
  }>(
    await db.execute(sql`select r.code, r.status, r.version, r.workshop_id, r.vehicle_type, r.fuel, r.vehicle_label,
        r.problem_type, r.note, r.pincode, r.address_line, ST_Y(r.location::geometry) as lat, ST_X(r.location::geometry) as lng,
        r.advance_paise, r.total_paise, r.balance_paise,
        coalesce((select c.attempts >= 5 from rsa_arrival_codes c where c.request_id = r.id), false) as locked
      from rsa_requests r
      where r.workshop_id in (${ids}) and r.status in ('accepted', 'en_route', 'arrived', 'in_progress', 'billed')
      order by r.created_at, r.id limit 50`),
  );
  return {
    offers: offers.map((o) => ({
      code: o.code,
      vehicleType: o.vehicle_type,
      fuel: o.fuel,
      problemType: o.problem_type as RsaProblemType | null,
      pincode: o.pincode,
      distanceM: o.distance_m === null ? null : num(o.distance_m),
      expiresAt: new Date(o.expires_at).toISOString(),
      workshopId: o.workshop_id,
    })),
    jobs: jobs.map((j) => ({
      code: j.code,
      status: j.status as RsaStatus,
      version: num(j.version),
      workshopId: j.workshop_id,
      vehicleType: j.vehicle_type,
      fuel: j.fuel,
      vehicleLabel: j.vehicle_label,
      problemType: j.problem_type as RsaProblemType | null,
      note: j.note,
      pincode: j.pincode,
      addressLine: j.address_line,
      lat: num(j.lat),
      lng: num(j.lng),
      advancePaise: num(j.advance_paise),
      totalPaise: j.total_paise === null ? null : num(j.total_paise),
      balancePaise: j.balance_paise === null ? null : num(j.balance_paise),
      arrivalLocked: j.locked,
    })),
  };
}
