import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { istDateString, istParts } from '@mechdost/shared/time';
import {
  openSlotHours,
  MAX_SLOT_CAPACITY,
  type OpeningHours,
  slotOfHour,
} from '@mechdost/shared/workshop-slots';
import type { ServiceSlot } from '@mechdost/shared/service-requests';
import { auditLog, serviceProposals, workshops, workshopSlots } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Hourly slots with capacity (spec 06 "capacity race", design 2026-11-15). A slot row is made on demand the first time an
 * hour is booked or edited, copying the workshop's `slot_capacity` (default 2). Booking is one conditional UPDATE
 * (`booked < capacity`); the CHECK `0 <= booked <= capacity` is the backstop, so the last place goes to exactly one
 * proposal. Places go back through `releaseRequestSlots`, called from the single request transition function, once per
 * proposal (`slot_released_at`), so a cancel, reschedule, decline or reroute can never release twice.
 */
export interface SlotRow {
  hour: number;
  part: ServiceSlot;
  capacity: number;
  booked: number;
  free: number;
}

interface WorkshopSlotInfo {
  id: string;
  cityId: string;
  hours: OpeningHours;
  slotCapacity: number;
}

async function slotInfo(tx: Tx, workshopId: string, lock: boolean): Promise<WorkshopSlotInfo> {
  const q = tx
    .select({
      id: workshops.id,
      cityId: workshops.cityId,
      hours: workshops.hours,
      slotCapacity: workshops.slotCapacity,
    })
    .from(workshops)
    .where(eq(workshops.id, workshopId))
    .limit(1);
  const [w] = lock ? await q.for('share') : await q;
  if (!w) throw new NotFoundError('Workshop not found');
  return { id: w.id, cityId: w.cityId, hours: w.hours as OpeningHours, slotCapacity: w.slotCapacity };
}

/** The hour must be a whole open hour of that day and not already over (IST). */
export function assertSlotOpen(hours: OpeningHours, date: string, hour: number, now: Date) {
  if (!openSlotHours(hours, date).includes(hour))
    throw new ValidationError('The workshop is closed at that hour', 'SLOT_CLOSED');
  if (date === istDateString(now) && hour <= istParts(now).hour)
    throw new ValidationError('That hour has already started', 'SLOT_PAST');
}

async function ensureRow(tx: Tx, w: WorkshopSlotInfo, date: string, hour: number) {
  await tx
    .insert(workshopSlots)
    .values({ workshopId: w.id, slotDate: date, hour, capacity: w.slotCapacity })
    .onConflictDoNothing({ target: [workshopSlots.workshopId, workshopSlots.slotDate, workshopSlots.hour] });
}

/**
 * Take one place in an hour for a proposal (inside the caller's transaction). 409 `SLOT_FULL` when none is left.
 * Returns the part of the day the hour belongs to.
 */
export async function bookSlot(
  tx: Tx,
  input: { workshopId: string; date: string; hour: number; now?: Date },
): Promise<ServiceSlot> {
  const w = await slotInfo(tx, input.workshopId, true);
  assertSlotOpen(w.hours, input.date, input.hour, input.now ?? new Date());
  await ensureRow(tx, w, input.date, input.hour);
  const [row] = await tx
    .update(workshopSlots)
    .set({ booked: sql`${workshopSlots.booked} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(workshopSlots.workshopId, input.workshopId),
        eq(workshopSlots.slotDate, input.date),
        eq(workshopSlots.hour, input.hour),
        sql`${workshopSlots.booked} < ${workshopSlots.capacity}`,
      ),
    )
    .returning({ id: workshopSlots.id });
  if (!row) throw new ConflictError('That hour is fully booked; pick another', 'SLOT_FULL');
  return slotOfHour(input.hour);
}

/**
 * Give back every place held for a request's proposals. Idempotent: each proposal is marked released first
 * (`slot_released_at is null` is the guard), then its hour loses one booking. Returns how many places went back.
 */
export async function releaseRequestSlots(tx: Tx, requestId: string): Promise<number> {
  const held = await tx
    .update(serviceProposals)
    .set({ slotReleasedAt: sql`now()` })
    .where(
      and(
        eq(serviceProposals.requestId, requestId),
        isNotNull(serviceProposals.slotHour),
        isNull(serviceProposals.slotReleasedAt),
      ),
    )
    .returning({
      workshopId: serviceProposals.workshopId,
      date: serviceProposals.proposedDate,
      hour: serviceProposals.slotHour,
    });
  for (const h of held)
    if (h.hour !== null)
      await tx
        .update(workshopSlots)
        .set({ booked: sql`${workshopSlots.booked} - 1`, updatedAt: new Date() })
        .where(
          and(
            eq(workshopSlots.workshopId, h.workshopId),
            eq(workshopSlots.slotDate, h.date),
            eq(workshopSlots.hour, h.hour),
            sql`${workshopSlots.booked} > 0`,
          ),
        );
  return held.length;
}

/** The hours of one day with their capacity and bookings (rows not made yet show the workshop's default). */
export async function listSlots(
  db: Tx,
  input: { workshopIds: readonly string[]; workshopId: string; date: string },
): Promise<SlotRow[]> {
  if (!input.workshopIds.includes(input.workshopId)) throw new NotFoundError('Workshop not found');
  const w = await slotInfo(db, input.workshopId, false);
  const rows = await db
    .select({ hour: workshopSlots.hour, capacity: workshopSlots.capacity, booked: workshopSlots.booked })
    .from(workshopSlots)
    .where(and(eq(workshopSlots.workshopId, w.id), eq(workshopSlots.slotDate, input.date)));
  return openSlotHours(w.hours, input.date).map((hour) => {
    const r = rows.find((x) => x.hour === hour);
    const capacity = r?.capacity ?? w.slotCapacity;
    const booked = r?.booked ?? 0;
    return { hour, part: slotOfHour(hour), capacity, booked, free: capacity - booked };
  });
}

/**
 * The owner changes one hour's capacity (0 closes the hour to new bookings). Never below what is already booked
 * (`CAPACITY_BELOW_BOOKED`): the conditional UPDATE is the check, so a booking cannot slip in between.
 */
export async function setSlotCapacity(
  db: Tx,
  input: {
    workshopIds: readonly string[];
    workshopId: string;
    date: string;
    hour: number;
    capacity: number;
    userId: string;
    now?: Date;
  },
): Promise<SlotRow> {
  if (!input.workshopIds.includes(input.workshopId)) throw new NotFoundError('Workshop not found');
  if (input.capacity < 0 || input.capacity > MAX_SLOT_CAPACITY)
    throw new ValidationError('Capacity is out of range', 'CAPACITY_RANGE');
  return db.transaction(async (tx) => {
    const w = await slotInfo(tx, input.workshopId, true);
    assertSlotOpen(w.hours, input.date, input.hour, input.now ?? new Date());
    await ensureRow(tx, w, input.date, input.hour);
    const [row] = await tx
      .update(workshopSlots)
      .set({ capacity: input.capacity, updatedAt: new Date() })
      .where(
        and(
          eq(workshopSlots.workshopId, w.id),
          eq(workshopSlots.slotDate, input.date),
          eq(workshopSlots.hour, input.hour),
          sql`${workshopSlots.booked} <= ${input.capacity}`,
        ),
      )
      .returning({ capacity: workshopSlots.capacity, booked: workshopSlots.booked });
    if (!row) throw new ConflictError('More places are already booked than that', 'CAPACITY_BELOW_BOOKED');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'workshop',
      action: 'workshop.slot_capacity',
      entity: 'workshop',
      entityId: w.id,
      after: { date: input.date, hour: input.hour, capacity: input.capacity },
    });
    await recordServerEvent(tx, 'workshop_slot_capacity_set', {
      userId: input.userId,
      cityId: w.cityId,
      props: { workshopId: w.id, hour: input.hour, capacity: input.capacity },
    });
    return {
      hour: input.hour,
      part: slotOfHour(input.hour),
      capacity: row.capacity,
      booked: row.booked,
      free: row.capacity - row.booked,
    };
  });
}
