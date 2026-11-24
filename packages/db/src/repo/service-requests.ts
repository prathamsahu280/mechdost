import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import type {
  CreateServiceRequestInput,
  EstimateDecisionInput,
  ServiceSlot,
} from '@mechdost/shared/service-requests';
import {
  ESTIMATE_SENDABLE_FROM,
  SERVICE_CUSTOMER_CANCELLABLE,
  serviceRequestMachine,
  type ServiceCancelReason,
  type ServiceMode,
  type ServiceRequestStatus,
} from '@mechdost/shared/state';
import { istDateString } from '@mechdost/shared/time';
import { MAX_RESCHEDULES } from '@mechdost/shared/workshop-slots';
import type { VehicleType } from '@mechdost/shared/vehicles';
import {
  auditLog,
  cities,
  estimateItems,
  estimates,
  pincodes,
  serviceBills,
  serviceEvents,
  serviceMoves,
  serviceProposals,
  serviceRequests,
  users,
  vehicles,
  workshops,
  workshopServices,
} from '../schema';
import type { ActorContext } from './actor';
import { readArrivalCode } from './arrival-code';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import type { Keyring } from '../crypto';
import { assertHomeEligible, loadHomeAddress } from './home-booking';
import { cancelPendingServiceRewards, createServiceReward } from './coins';
import { issueArrivalCode } from './arrival-code';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { queueServiceReceivedEmail, queueServiceStatusEmail } from './email-events';
import { resolveServiceNotices } from './notice-events';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';
import { releaseRequestSlots } from './workshop-slots';

/**
 * Service requests (spec 06), customer side and the shared core. Every status change goes through
 * `transitionRequest`: the machine checks the move and the actor, a conditional UPDATE on (id, status, version)
 * applies it (zero rows → 409 STALE_REQUEST), and the same transaction writes `service_events`, `audit_log` and the
 * analytics event. A transaction locks the **request row first**, then proposals, estimates and bills (spec 14 lock
 * order). Customers reach only their own requests; anything else is 404.
 */
export type ServiceLocale = 'en' | 'hi';
type ServiceActor = ActorContext & { type: 'customer' | 'workshop' | 'admin' | 'system' };

export interface RequestCore {
  id: string;
  code: string;
  userId: string;
  cityId: string;
  workshopId: string | null;
  status: ServiceRequestStatus;
  version: number;
  vehicleKey: string;
  vehicleId: string | null;
  vehicleType: VehicleType;
  serviceMode: ServiceMode;
}

const CORE = {
  id: serviceRequests.id,
  code: serviceRequests.code,
  userId: serviceRequests.userId,
  cityId: serviceRequests.cityId,
  workshopId: serviceRequests.workshopId,
  status: serviceRequests.status,
  version: serviceRequests.version,
  vehicleKey: serviceRequests.vehicleKey,
  vehicleId: serviceRequests.vehicleId,
  vehicleType: serviceRequests.vehicleType,
  serviceMode: serviceRequests.serviceMode,
};

/** The request matching `where`, locked FOR UPDATE (request row first), or 404. */
export async function lockRequest(tx: Tx, where: SQL | undefined): Promise<RequestCore> {
  const [r] = await tx.select(CORE).from(serviceRequests).where(where).limit(1).for('update');
  if (!r) throw new NotFoundError('Service request not found');
  return {
    ...r,
    status: r.status as ServiceRequestStatus,
    vehicleType: r.vehicleType as VehicleType,
    serviceMode: r.serviceMode as ServiceMode,
  };
}

/** Wrong step for the current status: 409 with the status, before any write. */
export function requireStatus(r: RequestCore, allowed: readonly ServiceRequestStatus[]) {
  if (!allowed.includes(r.status))
    throw new ConflictError(`This request is ${r.status.replace(/_/g, ' ')}`, 'WRONG_STEP');
}

type RequestPatch = Partial<
  Pick<
    typeof serviceRequests.$inferInsert,
    | 'workshopId'
    | 'statusReasonCode'
    | 'customerMessage'
    | 'odometerKm'
    | 'receivedAt'
    | 'completedAt'
    | 'visitingMechanic'
    | 'arrivalOverrideReason'
    | 'arrivalOverrideBy'
    | 'preferredDate'
    | 'preferredSlot'
    | 'rescheduleCount'
  >
>;

/** Moves that end or restart a workshop's hold on an hour: its places go back (once per proposal). */
const SLOT_RELEASING: readonly ServiceRequestStatus[] = [
  'awaiting_workshop',
  'needs_routing',
  'cancelled',
  'rejected',
];

/**
 * The only way to change a request's status. `expectedVersion` is the version the caller saw; chained moves in one
 * transaction pass the version the previous move returned.
 */
export async function transitionRequest(
  tx: Tx,
  args: {
    request: RequestCore;
    to: ServiceRequestStatus;
    expectedVersion: number;
    actor: ServiceActor;
    patch?: RequestPatch;
    payload?: Record<string, unknown>;
    visibleToCustomer?: boolean;
    reasonCode?: string | null;
  },
): Promise<{ status: ServiceRequestStatus; version: number }> {
  const { request: r } = args;
  const fromStatus = r.status;
  serviceRequestMachine.assert(r.status, args.to, args.actor.type);
  const [row] = await tx
    .update(serviceRequests)
    .set({ status: args.to, ...args.patch })
    .where(
      and(
        eq(serviceRequests.id, r.id),
        eq(serviceRequests.status, r.status),
        eq(serviceRequests.version, args.expectedVersion),
      ),
    )
    .returning({ status: serviceRequests.status, version: serviceRequests.version });
  if (!row)
    throw new ConflictError('This request changed meanwhile; reload it and try again', 'STALE_REQUEST');
  await tx.insert(serviceEvents).values({
    requestId: r.id,
    fromStatus: r.status,
    toStatus: args.to,
    actorType: args.actor.type,
    actorId: args.actor.userId ?? null,
    visibleToCustomer: args.visibleToCustomer ?? true,
    payload: args.payload ?? {},
  });
  await tx.insert(auditLog).values({
    actorUserId: args.actor.userId ?? null,
    actorRole: args.actor.type,
    action: `service_request.${args.to}`,
    entity: 'service_request',
    entityId: r.id,
    before: { status: r.status },
    after: { status: args.to, ...args.payload },
  });
  await recordServerEvent(tx, 'service_status_changed', {
    userId: args.actor.userId ?? null,
    cityId: r.cityId,
    props: {
      requestCode: r.code,
      workshopId: args.patch?.workshopId ?? r.workshopId,
      from: r.status,
      to: args.to,
      by: args.actor.type,
      reasonCode: args.reasonCode ?? null,
      mode: r.serviceMode,
    },
  });
  // The hour held by the workshop's proposal goes back when the booking is cancelled, rerouted, declined or moved.
  if (SLOT_RELEASING.includes(args.to)) await releaseRequestSlots(tx, r.id);
  // A paid workshop booking earns the admin-set coins (spec 20, Q24), pending until the unlock days pass.
  if (args.to === 'paid')
    await createServiceReward(tx, {
      requestId: r.id,
      userId: r.userId,
      cityId: r.cityId,
      workshopId: args.patch?.workshopId ?? r.workshopId,
    });
  // Any later move that undoes a payment cancels the pending booking reward (security review 2026-11-14).
  else if ((r.status === 'paid' || r.status === 'completed') && args.to !== 'completed')
    await cancelPendingServiceRewards(tx, { serviceRequestId: r.id, reasonCode: 'request_cancelled' });
  // Later moves in the same transaction start from here.
  r.status = row.status as ServiceRequestStatus;
  r.version = row.version;
  if (args.patch?.workshopId !== undefined) r.workshopId = args.patch.workshopId;
  // Asks that are moot now are cleared first, so the new milestone's own notice is never touched.
  await resolveServiceNotices(tx, { requestId: r.id, from: fromStatus, to: args.to });
  // Customer email for the milestone (spec 10, design 2026-11-15), same transaction: a rolled-back move sends nothing.
  await queueServiceStatusEmail(tx, { request: r, to: args.to, version: row.version, payload: args.payload });
  return { status: r.status, version: row.version };
}

/** Open proposals of a request are withdrawn when it leaves the proposal stage another way. */
export async function withdrawPendingProposals(tx: Tx, requestId: string) {
  await tx
    .update(serviceProposals)
    .set({ status: 'withdrawn', decidedAt: new Date() })
    .where(and(eq(serviceProposals.requestId, requestId), eq(serviceProposals.status, 'pending')));
}

// ---------------------------------------------------------------------------------------------------------------
// Views

/** Statuses after the customer confirmed a visit, while it is still live: contact details are shared. */
const CONTACT_SHARED: readonly ServiceRequestStatus[] = [
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
  'ready',
  'billed',
  'paid',
  'completed',
];

export interface ServiceSnapshotLine {
  key: string;
  title: string;
  lowPaise: number;
  highPaise: number;
}

export interface EstimateView {
  id: string;
  revision: number;
  status: 'sent' | 'decided';
  items: {
    id: string;
    lineNo: number;
    description: string;
    serviceKey: string | null;
    qty: number;
    unitPaise: number;
    gstRateBp: number;
    decision: 'pending' | 'approved' | 'declined';
  }[];
}

export interface BillView {
  lines: {
    id: string;
    description: string;
    qty: number;
    unitPaise: number;
    gstRateBp: number;
    taxablePaise: number;
    gstPaise: number;
  }[];
  gstRegistered: boolean;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  billedAt: Date;
  /** Days of labour promise frozen on the bill (user 2026-11-15); null = none. */
  labourPromiseDays: number | null;
  paidAt: Date | null;
  method: string | null;
}

/** Home servicing details of a request (null when it was booked at the workshop). */
export interface HomeVisitView {
  /** Visit fee the customer saw when booking (paise), kept after a move to the workshop unless waived. */
  visitFeePaise: number;
  /** Whether the workshop charges GST (the fee then carries GST on the bill, shown next to it). */
  gstRegistered: boolean;
  feeWaivedReason: string | null;
  mechanicName: string | null;
  /** Where the mechanic goes: the customer, the workshop and staff see it once the visit is confirmed. */
  address: { line1: string; line2: string | null; landmark: string | null } | null;
  /** The code the customer shows at the door: the customer only, while the visit is confirmed. */
  arrivalCode: string | null;
  arrivalLocked: boolean;
  arrivedVia: 'code' | 'override' | null;
  /** The latest offer to move the job to the workshop. */
  move: {
    id: string;
    reasonCode: string;
    transport: string;
    status: 'proposed' | 'accepted' | 'declined';
  } | null;
}

export interface ServiceRequestView {
  code: string;
  serviceMode: ServiceMode;
  home: HomeVisitView | null;
  status: ServiceRequestStatus;
  version: number;
  routingMode: 'chosen' | 'mechdost';
  workshop: {
    id: string;
    slug: string;
    name: string;
    area: string;
    phone: string | null;
    ratingAvg: number | null;
    ratingCount: number;
  } | null;
  vehicle: { type: VehicleType; text: string; vehicleId: string | null };
  services: ServiceSnapshotLine[];
  concern: string | null;
  pincode: string;
  preferredDate: string;
  preferredSlot: ServiceSlot;
  pickup: boolean;
  odometerKm: number | null;
  reasonCode: string | null;
  customerMessage: string | null;
  proposal: {
    id: string;
    date: string;
    slot: ServiceSlot;
    lowPaise: number;
    highPaise: number;
    note: string | null;
    /** The hourly slot (IST start hour) of the proposal; null on older proposals. */
    hour: number | null;
    status: 'pending' | 'accepted';
  } | null;
  /** Customer reschedules (spec 06): how many were used, and while the workshop answers one, the time it replaces. */
  reschedule: {
    count: number;
    max: number;
    from: { date: string; slot: ServiceSlot } | null;
  };
  estimate: EstimateView | null;
  bill: BillView | null;
  /** Customer contact for the workshop (after the visit is confirmed) and staff; null otherwise. */
  customer: { name: string | null; phone: string | null } | null;
  timeline: { from: string | null; to: string; actor: string; at: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

interface SnapshotJson {
  key: string;
  title: string;
  titleHi?: string | null;
  lowPaise: number;
  highPaise: number;
}

/** The time a pending reschedule replaces: the latest "moved by the customer" event's `from`. */
function rescheduleFrom(
  events: { to: string; payload: unknown }[],
): { date: string; slot: ServiceSlot } | null {
  const last = events.filter((e) => e.to === 'awaiting_workshop').at(-1);
  const p = last?.payload as { reschedule?: boolean; fromDate?: string; fromSlot?: ServiceSlot } | undefined;
  return p?.reschedule && p.fromDate && p.fromSlot ? { date: p.fromDate, slot: p.fromSlot } : null;
}

/** One request with its proposal, current estimate, bill and timeline, shaped for `audience`. */
export async function loadRequestView(
  db: Tx,
  requestId: string,
  audience: 'customer' | 'workshop' | 'admin',
  locale: ServiceLocale,
  keyring: Keyring | null = null,
): Promise<ServiceRequestView> {
  const [r] = await db
    .select({
      req: serviceRequests,
      wId: workshops.id,
      wSlug: workshops.slug,
      wName: workshops.name,
      wNameHi: workshops.nameHi,
      wArea: workshops.area,
      wAreaHi: workshops.areaHi,
      wPhone: workshops.phone,
      wGstRegistered: workshops.gstRegistered,
      wRatingAvg: workshops.ratingAvg,
      wRatingCount: workshops.ratingCount,
      customerName: users.name,
      customerPhone: users.phone,
    })
    .from(serviceRequests)
    .leftJoin(workshops, eq(workshops.id, serviceRequests.workshopId))
    .innerJoin(users, eq(users.id, serviceRequests.userId))
    .where(eq(serviceRequests.id, requestId))
    .limit(1);
  if (!r) throw new NotFoundError('Service request not found');
  const req = r.req;
  const status = req.status as ServiceRequestStatus;
  const shared = CONTACT_SHARED.includes(status);
  const [proposal] = await db
    .select()
    .from(serviceProposals)
    .where(
      and(eq(serviceProposals.requestId, req.id), inArray(serviceProposals.status, ['pending', 'accepted'])),
    )
    .orderBy(desc(serviceProposals.createdAt))
    .limit(1);
  const [estimate] = await db
    .select()
    .from(estimates)
    .where(and(eq(estimates.requestId, req.id), ne(estimates.status, 'superseded')))
    .limit(1);
  const items = estimate
    ? await db
        .select()
        .from(estimateItems)
        .where(eq(estimateItems.estimateId, estimate.id))
        .orderBy(asc(estimateItems.lineNo))
    : [];
  const [move] = await db
    .select()
    .from(serviceMoves)
    .where(eq(serviceMoves.requestId, req.id))
    .orderBy(desc(serviceMoves.createdAt))
    .limit(1);
  const [bill] = await db.select().from(serviceBills).where(eq(serviceBills.requestId, req.id)).limit(1);
  const timeline = await db
    .select({
      from: serviceEvents.fromStatus,
      to: serviceEvents.toStatus,
      actor: serviceEvents.actorType,
      at: serviceEvents.createdAt,
      visible: serviceEvents.visibleToCustomer,
      payload: serviceEvents.payload,
    })
    .from(serviceEvents)
    .where(eq(serviceEvents.requestId, req.id))
    .orderBy(asc(serviceEvents.id));
  const codeRow = req.visitFeePaise === null ? null : await readArrivalCode(db, keyring, req.id);
  const homeAddress = req.homeAddress as {
    line1: string;
    line2?: string | null;
    landmark?: string | null;
  } | null;
  const seesAddress = audience === 'customer' || audience === 'admin' || shared;
  const arrived = req.arrivalOverrideBy
    ? 'override'
    : req.receivedAt && req.serviceMode === 'home'
      ? 'code'
      : null;
  const home: HomeVisitView | null =
    req.visitFeePaise === null
      ? null
      : {
          visitFeePaise: req.visitFeePaise,
          gstRegistered: r.wGstRegistered ?? false,
          feeWaivedReason: req.visitFeeWaivedReason,
          mechanicName: req.visitingMechanic,
          address:
            homeAddress && seesAddress
              ? {
                  line1: homeAddress.line1,
                  line2: homeAddress.line2 ?? null,
                  landmark: homeAddress.landmark ?? null,
                }
              : null,
          arrivalCode: audience === 'customer' && status === 'confirmed' ? (codeRow?.code ?? null) : null,
          arrivalLocked: codeRow?.locked ?? false,
          arrivedVia: arrived,
          move: move
            ? {
                id: move.id,
                reasonCode: move.reasonCode,
                transport: move.transport,
                status: move.status as 'proposed' | 'accepted' | 'declined',
              }
            : null,
        };
  return {
    code: req.code,
    serviceMode: req.serviceMode as ServiceMode,
    home,
    status,
    version: req.version,
    routingMode: req.routingMode as 'chosen' | 'mechdost',
    workshop:
      r.wId && r.wSlug && r.wName && r.wArea
        ? {
            id: r.wId,
            slug: r.wSlug,
            name: localized(r.wName, r.wNameHi, locale),
            area: localized(r.wArea, r.wAreaHi, locale),
            phone: shared ? r.wPhone : null,
            ratingAvg: r.wRatingAvg === null ? null : Number(r.wRatingAvg),
            ratingCount: r.wRatingCount ?? 0,
          }
        : null,
    vehicle: { type: req.vehicleType as VehicleType, text: req.vehicleText, vehicleId: req.vehicleId },
    services: (req.services as SnapshotJson[]).map((s) => ({
      key: s.key,
      title: localized(s.title, s.titleHi, locale),
      lowPaise: s.lowPaise,
      highPaise: s.highPaise,
    })),
    concern: req.concern,
    pincode: req.pincode,
    preferredDate: req.preferredDate,
    preferredSlot: req.preferredSlot as ServiceSlot,
    pickup: req.pickupRequested,
    odometerKm: req.odometerKm,
    reasonCode: req.statusReasonCode,
    customerMessage: req.customerMessage,
    proposal: proposal
      ? {
          id: proposal.id,
          date: proposal.proposedDate,
          slot: proposal.slot as ServiceSlot,
          lowPaise: proposal.lowPaise,
          highPaise: proposal.highPaise,
          note: proposal.note,
          hour: proposal.slotHour,
          status: proposal.status as 'pending' | 'accepted',
        }
      : null,
    reschedule: {
      count: req.rescheduleCount,
      max: MAX_RESCHEDULES,
      from: status === 'awaiting_workshop' ? rescheduleFrom(timeline) : null,
    },
    estimate: estimate
      ? {
          id: estimate.id,
          revision: estimate.revision,
          status: estimate.status as 'sent' | 'decided',
          items: items.map((i) => ({
            id: i.id,
            lineNo: i.lineNo,
            description: i.description,
            serviceKey: i.serviceKey,
            qty: i.qty,
            unitPaise: i.unitPaise,
            gstRateBp: i.gstRateBp,
            decision: i.decision as 'pending' | 'approved' | 'declined',
          })),
        }
      : null,
    bill: bill
      ? {
          lines: bill.lines as BillView['lines'],
          gstRegistered: bill.gstRegistered,
          taxablePaise: bill.taxablePaise,
          cgstPaise: bill.cgstPaise,
          sgstPaise: bill.sgstPaise,
          roundOffPaise: bill.roundOffPaise,
          totalPaise: bill.totalPaise,
          billedAt: bill.billedAt,
          labourPromiseDays: bill.labourPromiseDays,
          paidAt: bill.paidAt,
          method: bill.method,
        }
      : null,
    customer:
      audience === 'admin'
        ? { name: r.customerName, phone: null }
        : audience === 'workshop' && shared
          ? { name: r.customerName, phone: r.customerPhone }
          : null,
    timeline: timeline
      .filter((e) => audience !== 'customer' || e.visible)
      .map((e) => ({ from: e.from, to: e.to, actor: e.actor, at: e.at })),
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
  };
}

export interface ServiceRequestSummary {
  code: string;
  status: ServiceRequestStatus;
  version: number;
  workshop: { slug: string; name: string } | null;
  vehicle: { type: VehicleType; text: string };
  services: ServiceSnapshotLine[];
  preferredDate: string;
  preferredSlot: ServiceSlot;
  pincode: string;
  /** The customer has something to decide (a proposal, an estimate or an offer to move a home job): the account badge. */
  waitingForCustomer: boolean;
  serviceMode: ServiceMode;
  createdAt: Date;
  updatedAt: Date;
}

interface SummaryRow {
  id: string;
  code: string;
  status: ServiceRequestStatus;
  version: unknown;
  w_slug: string | null;
  w_name: string | null;
  w_name_hi: string | null;
  vehicle_type: VehicleType;
  vehicle_text: string;
  services: SnapshotJson[] | string;
  preferred_date: string | Date;
  preferred_slot: ServiceSlot;
  pincode: string;
  service_mode: ServiceMode;
  move_pending: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  sort_key: string;
}

export const SUMMARY_SELECT = sql.raw(`r.id, r.code, r.status, r.version, w.slug as w_slug, w.name as w_name,
  w.name_hi as w_name_hi, r.vehicle_type, r.vehicle_text, r.services, r.preferred_date::text as preferred_date,
  r.preferred_slot, r.pincode, r.service_mode, r.created_at, r.updated_at,
  exists (select 1 from service_moves m where m.request_id = r.id and m.status = 'proposed') as move_pending`);

export function toSummary(row: SummaryRow, locale: ServiceLocale): ServiceRequestSummary {
  const services =
    typeof row.services === 'string' ? (JSON.parse(row.services) as SnapshotJson[]) : row.services;
  return {
    code: row.code,
    status: row.status,
    version: Number(row.version),
    workshop:
      row.w_slug && row.w_name
        ? { slug: row.w_slug, name: localized(row.w_name, row.w_name_hi, locale) }
        : null,
    vehicle: { type: row.vehicle_type, text: row.vehicle_text },
    services: services.map((s) => ({
      key: s.key,
      title: localized(s.title, s.titleHi, locale),
      lowPaise: s.lowPaise,
      highPaise: s.highPaise,
    })),
    preferredDate: String(row.preferred_date),
    preferredSlot: row.preferred_slot,
    pincode: row.pincode,
    waitingForCustomer: row.status === 'proposed' || row.status === 'estimate_sent' || row.move_pending,
    serviceMode: row.service_mode,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Keyset page (newest first) of summaries matching `where`; `sortColumn` is created_at or updated_at. */
export async function pageSummaries(
  db: Tx,
  where: SQL,
  sortColumn: 'created_at' | 'updated_at',
  page: { cursor?: string | null; limit?: number },
  locale: ServiceLocale,
): Promise<{ items: ServiceRequestSummary[]; nextCursor: string | null }> {
  const limit = pageSize(page.limit, 20, 50);
  const after = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const col = sql.raw(`r.${sortColumn}`);
  const rows = rowsOf<SummaryRow>(
    await db.execute(sql`
      select ${SUMMARY_SELECT}, ${col}::text as sort_key
      from service_requests r left join workshops w on w.id = r.workshop_id
      where ${where}
        ${after ? sql`and (${col}, r.id) < (cast(${after.k} as timestamptz), cast(${after.id} as uuid))` : sql``}
      order by ${col} desc, r.id desc
      limit ${limit + 1}`),
  );
  const more = rows.length > limit;
  const pageRows = more ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((r) => toSummary(r, locale)),
    nextCursor: more && last ? encodeCursor({ k: last.sort_key, id: last.id }) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Customer

const MAX_DAYS_AHEAD = 30;

/** `date` must be today (IST) up to `days` days ahead. */
export function assertBookableDate(date: string, days: number, now = new Date()) {
  const today = istDateString(now);
  const last = istDateString(new Date(now.getTime() + days * 86_400_000));
  if (date < today || date > last)
    throw new ValidationError(`Pick a date from today up to ${String(days)} days ahead`, 'DATE_OUT_OF_RANGE');
}

const vehicleKeyOf = (vehicleId: string | null | undefined, text: string) =>
  vehicleId ?? `text:${text.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/**
 * A customer's new request. The same `idempotencyKey` returns the request already made (double taps, retries).
 * With a workshop: it must be bookable, in the PIN's city, serve the vehicle type and offer every chosen menu key
 * (snapshotted). Without one ("Let MechDost choose"): a concern is required and the request waits for routing.
 */
export async function createServiceRequest(
  db: Tx,
  input: { userId: string; idempotencyKey: string; request: CreateServiceRequestInput; now?: Date },
): Promise<{ code: string; status: ServiceRequestStatus; version: number; replayed: boolean }> {
  const b = input.request;
  assertBookableDate(b.preferredDate, MAX_DAYS_AHEAD, input.now);
  return db.transaction(async (tx) => {
    const replay = async () => {
      const [existing] = await tx
        .select({
          code: serviceRequests.code,
          status: serviceRequests.status,
          version: serviceRequests.version,
        })
        .from(serviceRequests)
        .where(
          and(
            eq(serviceRequests.userId, input.userId),
            eq(serviceRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      return existing
        ? { ...existing, status: existing.status as ServiceRequestStatus, replayed: true }
        : null;
    };
    const earlier = await replay();
    if (earlier) return earlier;

    const [place] = await tx
      .select({ cityId: pincodes.cityId, cityCode: cities.code })
      .from(pincodes)
      .innerJoin(cities, eq(cities.id, pincodes.cityId))
      // An inactive PIN is not serviceable (spec 15 "PIN codes").
      .where(and(eq(pincodes.pincode, b.pincode), eq(pincodes.active, true)))
      .limit(1);
    if (!place?.cityId) throw new ValidationError('We do not serve this PIN code yet', 'PINCODE_NOT_SERVED');

    if (b.vehicleId) {
      const [v] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.id, b.vehicleId),
            eq(vehicles.userId, input.userId),
            sql`${vehicles.deletedAt} is null`,
          ),
        )
        .limit(1);
      if (!v) throw new NotFoundError('Vehicle not found');
    }

    // Home visit: a pinned saved address of this customer decides the place (and the PIN must be the address's).
    const mode = b.mode ?? 'workshop';
    const address =
      mode === 'home' && b.addressId ? await loadHomeAddress(tx, input.userId, b.addressId) : null;
    if (mode === 'home' && !address)
      throw new ValidationError('A home visit needs a saved address', 'ADDRESS_REQUIRED');
    if (address && address.pincode !== b.pincode)
      throw new ValidationError('The PIN code is not the address PIN code', 'PINCODE_MISMATCH');
    const inRadius = address
      ? sql`ST_DWithin(w.location, ST_SetSRID(ST_MakePoint(${address.lng}, ${address.lat}), 4326)::geography,
          w.home_radius_km * 1000)`
      : sql`false`;
    let visitFeePaise: number | null = null;
    let workshopId: string | null = null;
    let services: SnapshotJson[] = [];
    if (b.workshopSlug) {
      const [w] = rowsOf<{
        id: string;
        city_id: string;
        vehicle_types: string[];
        home_service: boolean;
        home_radius_km: unknown;
        home_visit_fee_paise: unknown;
        in_radius: boolean;
      }>(
        await tx.execute(sql`select w.id, w.city_id, w.vehicle_types, w.home_service, w.home_radius_km,
            w.home_visit_fee_paise, ${inRadius} as in_radius from workshops w
          where w.slug = ${b.workshopSlug} and w.published and w.location_verified and w.status = 'approved'
            and not w.busy
          for share`),
      );
      if (!w) throw new NotFoundError('Workshop not found');
      if (w.city_id !== place.cityId)
        throw new ValidationError('This workshop does not serve that PIN code', 'WORKSHOP_OUT_OF_AREA');
      if (!w.vehicle_types.includes(b.vehicleType))
        throw new ValidationError('This workshop does not service that vehicle type', 'VEHICLE_NOT_SERVED');
      const keys = [...new Set(b.serviceKeys)];
      const menu =
        keys.length === 0
          ? []
          : await tx
              .select()
              .from(workshopServices)
              .where(
                and(
                  eq(workshopServices.workshopId, w.id),
                  eq(workshopServices.active, true),
                  inArray(workshopServices.key, keys),
                ),
              );
      const fits = menu.filter((m) => m.vehicleType === null || m.vehicleType === b.vehicleType);
      if (fits.length !== keys.length)
        throw new ValidationError('A chosen service is not offered for this vehicle', 'UNKNOWN_SERVICE');
      if (mode === 'home')
        visitFeePaise = await assertHomeEligible(tx, {
          w,
          cityId: place.cityId,
          seenFeePaise: b.visitFeePaise ?? -1,
          serviceCount: keys.length,
          allHomeAvailable: fits.every((m) => m.homeAvailable),
        });
      services = keys.map((k) => {
        const m = fits.find((x) => x.key === k);
        if (!m) throw new ValidationError('A chosen service is not offered', 'UNKNOWN_SERVICE');
        return {
          key: m.key,
          title: m.title,
          titleHi: m.titleHi,
          lowPaise: m.lowPaise,
          highPaise: m.highPaise,
        };
      });
      workshopId = w.id;
    } else if (!b.concern) {
      throw new ValidationError('Describe the concern so we can choose a workshop', 'CONCERN_REQUIRED');
    }

    const values = {
      userId: input.userId,
      cityId: place.cityId,
      workshopId,
      routingMode: workshopId ? 'chosen' : 'mechdost',
      vehicleId: b.vehicleId ?? null,
      vehicleType: b.vehicleType,
      vehicleText: b.vehicle,
      vehicleKey: vehicleKeyOf(b.vehicleId, b.vehicle),
      services,
      concern: b.concern ?? null,
      pincode: b.pincode,
      location: address
        ? { lat: address.lat, lng: address.lng }
        : typeof b.lat === 'number' && typeof b.lng === 'number'
          ? { lat: b.lat, lng: b.lng }
          : null,
      serviceMode: mode,
      addressId: address ? b.addressId : null,
      homeAddress: address
        ? { line1: address.line1, line2: address.line2, landmark: address.landmark }
        : null,
      visitFeePaise,
      preferredDate: b.preferredDate,
      preferredSlot: b.preferredSlot,
      pickupRequested: b.pickup,
      idempotencyKey: input.idempotencyKey,
    };
    let created: RequestCore | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      try {
        created = await tx.transaction(async (sp) => {
          const [row] = await sp
            .insert(serviceRequests)
            .values({ ...values, code: publicCode('SR', place.cityCode) })
            .returning(CORE);
          if (!row) throw new Error('service request insert returned no row');
          return {
            ...row,
            status: row.status as ServiceRequestStatus,
            vehicleType: row.vehicleType as VehicleType,
            serviceMode: row.serviceMode as ServiceMode,
          };
        });
      } catch (err) {
        if (pgCode(err) !== '23505') throw err;
        const raced = await replay(); // the same key won a parallel insert
        if (raced) return raced;
      }
    }
    if (!created)
      throw new ConflictError('Could not allocate a request code, please retry', 'CODE_COLLISION');

    const actor = { type: 'customer' as const, userId: input.userId };
    await tx.insert(serviceEvents).values({
      requestId: created.id,
      fromStatus: null,
      toStatus: 'requested',
      actorType: 'customer',
      actorId: input.userId,
    });
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'service_request.requested',
      entity: 'service_request',
      entityId: created.id,
      after: { code: created.code, workshopId, services: services.length },
    });
    await recordServerEvent(tx, 'service_requested', {
      userId: actor.userId,
      cityId: place.cityId,
      props: {
        requestCode: created.code,
        workshopId,
        routing: workshopId ? 'chosen' : 'mechdost',
        services: services.length,
        mode,
      },
    });
    const moved = await transitionRequest(tx, {
      request: created,
      to: workshopId ? 'awaiting_workshop' : 'needs_routing',
      expectedVersion: created.version,
      actor: { type: 'system', userId: null },
    });
    await queueServiceReceivedEmail(tx, {
      id: created.id,
      code: created.code,
      userId: created.userId,
      workshopId,
    });
    return { code: created.code, status: moved.status, version: moved.version, replayed: false };
  });
}

const own = (userId: string, code: string) =>
  and(eq(serviceRequests.userId, userId), eq(serviceRequests.code, code));

export async function listMyServiceRequests(
  db: Tx,
  userId: string,
  page: { cursor?: string | null; limit?: number },
  locale: ServiceLocale,
) {
  return pageSummaries(db, sql`r.user_id = ${userId}`, 'created_at', page, locale);
}

export async function getMyServiceRequest(
  db: Tx,
  userId: string,
  code: string,
  locale: ServiceLocale,
  keyring: Keyring | null = null,
) {
  const [r] = await db
    .select({ id: serviceRequests.id })
    .from(serviceRequests)
    .where(own(userId, code))
    .limit(1);
  if (!r) throw new NotFoundError('Service request not found');
  return loadRequestView(db, r.id, 'customer', locale, keyring);
}

/** Cancel before the vehicle reaches the workshop, with a reason code (spec 06). */
export async function cancelMyServiceRequest(
  db: Tx,
  input: { userId: string; code: string; reasonCode: ServiceCancelReason; expectedVersion: number },
) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, own(input.userId, input.code));
    requireStatus(r, SERVICE_CUSTOMER_CANCELLABLE);
    const out = await transitionRequest(tx, {
      request: r,
      to: 'cancelled',
      expectedVersion: input.expectedVersion,
      actor: { type: 'customer', userId: input.userId },
      patch: { statusReasonCode: input.reasonCode },
      payload: { reasonCode: input.reasonCode },
      reasonCode: input.reasonCode,
    });
    await withdrawPendingProposals(tx, r.id);
    return out;
  });
}

/**
 * Move a booking before the vehicle arrives (spec 06, workshops tier 1): the customer picks a new date and part of the
 * day, the held hour goes back, and the request returns to the workshop (awaiting_workshop), which answers with a
 * proposal for the new time. At most `MAX_RESCHEDULES` times. The event keeps the old and the new time, so the
 * history is never lost; home visits follow the same rules (a new arrival code is issued when the visit is confirmed again).
 */
export async function rescheduleMyServiceRequest(
  db: Tx,
  input: {
    userId: string;
    code: string;
    date: string;
    slot: ServiceSlot;
    expectedVersion: number;
    now?: Date;
  },
) {
  assertBookableDate(input.date, MAX_DAYS_AHEAD, input.now);
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, own(input.userId, input.code));
    requireStatus(r, ['proposed', 'confirmed']);
    const [cur] = await tx
      .select({
        count: serviceRequests.rescheduleCount,
        date: serviceRequests.preferredDate,
        slot: serviceRequests.preferredSlot,
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, r.id));
    if (!cur) throw new NotFoundError('Service request not found');
    if (cur.count >= MAX_RESCHEDULES)
      throw new ConflictError('This booking was already moved the most times allowed', 'RESCHEDULE_LIMIT');
    const [live] = await tx
      .update(serviceProposals)
      .set({ status: 'withdrawn', decidedAt: new Date() })
      .where(
        and(eq(serviceProposals.requestId, r.id), inArray(serviceProposals.status, ['pending', 'accepted'])),
      )
      .returning({ date: serviceProposals.proposedDate, slot: serviceProposals.slot });
    const fromDate = live?.date ?? cur.date;
    const fromSlot = (live?.slot ?? cur.slot) as ServiceSlot;
    if (fromDate === input.date && fromSlot === input.slot)
      throw new ValidationError('Pick a different date or time', 'RESCHEDULE_SAME');
    const out = await transitionRequest(tx, {
      request: r,
      to: 'awaiting_workshop',
      expectedVersion: input.expectedVersion,
      actor: { type: 'customer', userId: input.userId },
      patch: { preferredDate: input.date, preferredSlot: input.slot, rescheduleCount: cur.count + 1 },
      payload: {
        reschedule: true,
        fromDate,
        fromSlot,
        toDate: input.date,
        toSlot: input.slot,
        count: cur.count + 1,
        from: r.status,
      },
    });
    await recordServerEvent(tx, 'service_rescheduled', {
      userId: input.userId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        workshopId: r.workshopId ?? '',
        count: cur.count + 1,
        fromDate,
        toDate: input.date,
      },
    });
    return out;
  });
}

/** Accept the workshop's slot + expected cost (→ confirmed) or turn it down (→ the workshop proposes again). */
export async function decideProposal(
  db: Tx,
  input: { userId: string; code: string; accept: boolean; expectedVersion: number; keyring?: Keyring | null },
) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, own(input.userId, input.code));
    requireStatus(r, ['proposed']);
    // Home visit: confirming issues the arrival code the customer shows at the door (no keyring = refuse, no silent skip).
    if (input.accept && r.serviceMode === 'home') await issueArrivalCode(tx, input.keyring ?? null, r.id);
    const [p] = await tx
      .update(serviceProposals)
      .set({ status: input.accept ? 'accepted' : 'declined', decidedAt: new Date() })
      .where(and(eq(serviceProposals.requestId, r.id), eq(serviceProposals.status, 'pending')))
      .returning({ id: serviceProposals.id });
    if (!p) throw new ConflictError('There is no proposal waiting for you', 'NO_PROPOSAL');
    return transitionRequest(tx, {
      request: r,
      to: input.accept ? 'confirmed' : 'awaiting_workshop',
      expectedVersion: input.expectedVersion,
      actor: { type: 'customer', userId: input.userId },
      payload: { proposalId: p.id },
    });
  });
}

/**
 * The customer decides every line of the current estimate (consent required by the schema). A stale revision is
 * refused; ≥ 1 approved line → approved, otherwise no_work_approved.
 */
export async function decideEstimate(
  db: Tx,
  input: { userId: string; code: string; decision: EstimateDecisionInput },
) {
  const d = input.decision;
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, own(input.userId, input.code));
    requireStatus(r, ['estimate_sent']);
    const [est] = await tx
      .select({ id: estimates.id, revision: estimates.revision, version: estimates.version })
      .from(estimates)
      .where(and(eq(estimates.requestId, r.id), eq(estimates.status, 'sent')))
      .limit(1)
      .for('update');
    if (est?.revision !== d.revision)
      throw new ConflictError('The workshop sent a newer estimate; review it again', 'STALE_ESTIMATE');
    const lines = await tx
      .select({ id: estimateItems.id })
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, est.id));
    const given = new Set(d.decisions.map((x) => x.itemId));
    if (lines.length !== given.size || lines.some((l) => !given.has(l.id)))
      throw new ValidationError('Approve or decline every item', 'DECISION_INCOMPLETE');
    const approved = d.decisions.filter((x) => x.decision === 'approved').map((x) => x.itemId);
    const declined = d.decisions.filter((x) => x.decision === 'declined').map((x) => x.itemId);
    for (const [ids, decision] of [
      [approved, 'approved'],
      [declined, 'declined'],
    ] as const)
      if (ids.length > 0)
        await tx
          .update(estimateItems)
          .set({ decision })
          .where(and(eq(estimateItems.estimateId, est.id), inArray(estimateItems.id, [...ids])));
    const [decided] = await tx
      .update(estimates)
      .set({ status: 'decided', decidedAt: new Date(), decidedBy: input.userId })
      .where(and(eq(estimates.id, est.id), eq(estimates.status, 'sent'), eq(estimates.version, est.version)))
      .returning({ id: estimates.id });
    if (!decided) throw new ConflictError('The estimate changed meanwhile', 'STALE_ESTIMATE');
    const out = await transitionRequest(tx, {
      request: r,
      to: approved.length > 0 ? 'approved' : 'no_work_approved',
      expectedVersion: d.version,
      actor: { type: 'customer', userId: input.userId },
      payload: { revision: est.revision, approved: approved.length, declined: declined.length },
    });
    await recordServerEvent(tx, 'service_estimate_decided', {
      userId: input.userId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        revision: est.revision,
        approved: approved.length,
        declined: declined.length,
      },
    });
    return out;
  });
}

/** Statuses a workshop may send an estimate from (re-exported for the job card). */
export const ESTIMATE_FROM: readonly ServiceRequestStatus[] = ESTIMATE_SENDABLE_FROM;
