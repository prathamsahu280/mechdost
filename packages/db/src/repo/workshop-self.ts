import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkshopChangeInput, WorkshopSelfEditInput } from '@mechdost/shared/service-requests';
import { auditLog, workshopChangeRequests, workshops } from '../schema';
import { ConflictError, mapPgError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { cityOfPincode, getAdminWorkshop, saveMenu, type AdminWorkshop } from './workshops';

/**
 * A self-service pin change stays in the workshop's own city (ruling 2026-11-15, security review): a PIN of another
 * city would move the workshop out of the approver's scope without its `city_id`. Unserved PINs are refused too.
 */
async function assertPinInCity(tx: Tx, pincode: string | null | undefined, cityId: string) {
  if (!pincode) return;
  if ((await cityOfPincode(tx, pincode)) !== cityId)
    throw new ValidationError('That PIN code is in another city', 'PINCODE_OTHER_CITY');
}

/**
 * "My workshop" (spec 07, workshops tier 1; design 2026-11-15): the owner edits the profile text (English and Hindi),
 * opening hours, menu prices (low to high ranges), busy mode and the default capacity of an hour. Those changes are
 * audited and live at once. The location pin and the GSTIN are not: the owner files a change request, the live values
 * stay as they are, and staff with `partners:approve` decide (spec 07 "verified"). Every id comes from the caller's
 * grants (`workshopIds`); any other id is 404 (spec 13).
 */
export interface WorkshopProfile {
  workshop: AdminWorkshop;
  slotCapacity: number;
  pending: { id: string; kind: 'location' | 'gstin'; payload: unknown; createdAt: Date }[];
}

export async function getWorkshopProfiles(
  db: Tx,
  workshopIds: readonly string[],
): Promise<WorkshopProfile[]> {
  if (workshopIds.length === 0) return [];
  const caps = await db
    .select({ id: workshops.id, slotCapacity: workshops.slotCapacity })
    .from(workshops)
    .where(inArray(workshops.id, [...workshopIds]))
    .orderBy(asc(workshops.name), asc(workshops.id));
  const pending = await db
    .select()
    .from(workshopChangeRequests)
    .where(
      and(
        inArray(workshopChangeRequests.workshopId, [...workshopIds]),
        eq(workshopChangeRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(workshopChangeRequests.createdAt));
  const out: WorkshopProfile[] = [];
  for (const c of caps)
    out.push({
      workshop: await getAdminWorkshop(db, { all: true }, c.id),
      slotCapacity: c.slotCapacity,
      pending: pending
        .filter((p) => p.workshopId === c.id)
        .map((p) => ({
          id: p.id,
          kind: p.kind as 'location' | 'gstin',
          payload: p.payload,
          createdAt: p.createdAt,
        })),
    });
  return out;
}

/** Save the self-editable fields (compare-and-set on the workshop's `version`). */
export async function saveWorkshopProfile(
  db: Tx,
  input: { workshopIds: readonly string[]; workshopId: string; userId: string; edit: WorkshopSelfEditInput },
): Promise<{ version: number }> {
  if (!input.workshopIds.includes(input.workshopId)) throw new NotFoundError('Workshop not found');
  const p = input.edit;
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ id: workshops.id, cityId: workshops.cityId })
      .from(workshops)
      .where(eq(workshops.id, input.workshopId))
      .limit(1)
      .for('update');
    if (!cur) throw new NotFoundError('Workshop not found');
    const set: Partial<typeof workshops.$inferInsert> = {
      ...(p.name !== undefined && { name: p.name }),
      ...(p.nameHi !== undefined && { nameHi: p.nameHi }),
      ...(p.addressLine !== undefined && { addressLine: p.addressLine }),
      ...(p.addressLineHi !== undefined && { addressLineHi: p.addressLineHi }),
      ...(p.area !== undefined && { area: p.area }),
      ...(p.areaHi !== undefined && { areaHi: p.areaHi }),
      ...(p.phone !== undefined && { phone: p.phone }),
      ...(p.hours !== undefined && { hours: p.hours }),
      ...(p.busy !== undefined && { busy: p.busy }),
      ...(p.slotCapacity !== undefined && { slotCapacity: p.slotCapacity }),
    };
    let row: { version: number } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .update(workshops)
          .set({ ...set, updatedAt: new Date() })
          .where(and(eq(workshops.id, cur.id), eq(workshops.version, p.version)))
          .returning({ version: workshops.version }),
      );
    } catch (err) {
      mapPgError(err);
    }
    if (!row)
      throw new ConflictError('The workshop changed meanwhile; reload and try again', 'STALE_WORKSHOP');
    if (p.menu) await saveMenu(tx, cur.id, p.menu);
    const fields = [...Object.keys(set), ...(p.menu ? ['menu'] : [])];
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'workshop',
      action: 'workshop.profile_saved',
      entity: 'workshop',
      entityId: cur.id,
      after: { fields, menu: p.menu?.length ?? null },
    });
    await recordServerEvent(tx, 'workshop_profile_saved', {
      userId: input.userId,
      cityId: cur.cityId,
      props: { workshopId: cur.id, fields, busy: p.busy ?? false, by: 'workshop' },
    });
    return row;
  });
}

/** The owner asks to move the pin or change the GSTIN; the live values stay until staff decide. */
export async function requestWorkshopChange(
  db: Tx,
  input: { workshopIds: readonly string[]; workshopId: string; userId: string; change: WorkshopChangeInput },
): Promise<{ id: string }> {
  if (!input.workshopIds.includes(input.workshopId)) throw new NotFoundError('Workshop not found');
  const c = input.change;
  const payload =
    c.kind === 'location' ? { lat: c.lat, lng: c.lng, pincode: c.pincode ?? null } : { gstin: c.gstin };
  return db.transaction(async (tx) => {
    const [w] = await tx
      .select({ id: workshops.id, cityId: workshops.cityId })
      .from(workshops)
      .where(eq(workshops.id, input.workshopId))
      .for('update');
    if (!w) throw new NotFoundError('Workshop not found');
    if (c.kind === 'location') await assertPinInCity(tx, c.pincode, w.cityId);
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(workshopChangeRequests)
          .values({ workshopId: w.id, kind: c.kind, payload, requestedBy: input.userId })
          .returning({ id: workshopChangeRequests.id }),
      );
    } catch (err) {
      try {
        mapPgError(err);
      } catch (mapped) {
        if (mapped instanceof ConflictError && mapped.code === 'UNIQUE_VIOLATION')
          throw new ConflictError('A request of this kind is already waiting for review', 'CHANGE_PENDING');
        throw mapped;
      }
    }
    if (!row) throw new ConflictError('Could not file the request', 'CHANGE_FAILED');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'workshop',
      action: 'workshop.change_requested',
      entity: 'workshop',
      entityId: w.id,
      after: { kind: c.kind },
    });
    await recordServerEvent(tx, 'workshop_change_requested', {
      userId: input.userId,
      cityId: w.cityId,
      props: { workshopId: w.id, kind: c.kind },
    });
    return row;
  });
}

/** The owner withdraws their waiting request. */
export async function cancelWorkshopChange(
  db: Tx,
  input: { workshopIds: readonly string[]; changeId: string; userId: string },
): Promise<void> {
  const [row] = await db
    .delete(workshopChangeRequests)
    .where(
      and(
        eq(workshopChangeRequests.id, input.changeId),
        eq(workshopChangeRequests.status, 'pending'),
        inArray(workshopChangeRequests.workshopId, [...input.workshopIds]),
      ),
    )
    .returning({ id: workshopChangeRequests.id });
  if (!row) throw new NotFoundError('Request not found');
}

export interface ChangeRequestRow {
  id: string;
  workshopId: string;
  workshopName: string;
  kind: 'location' | 'gstin';
  payload: unknown;
  status: 'pending' | 'approved' | 'rejected';
  version: number;
  createdAt: Date;
}

/** Staff: the waiting requests in the caller's cities, oldest first. */
export async function listWorkshopChanges(db: Tx, scope: CityScope): Promise<ChangeRequestRow[]> {
  const rows = await db
    .select({
      id: workshopChangeRequests.id,
      workshopId: workshopChangeRequests.workshopId,
      workshopName: workshops.name,
      kind: workshopChangeRequests.kind,
      payload: workshopChangeRequests.payload,
      status: workshopChangeRequests.status,
      version: workshopChangeRequests.version,
      createdAt: workshopChangeRequests.createdAt,
    })
    .from(workshopChangeRequests)
    .innerJoin(workshops, eq(workshops.id, workshopChangeRequests.workshopId))
    .where(
      and(
        eq(workshopChangeRequests.status, 'pending'),
        scope.all ? undefined : inArray(workshops.cityId, scope.cityIds),
      ),
    )
    .orderBy(asc(workshopChangeRequests.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r,
    kind: r.kind as 'location' | 'gstin',
    status: r.status as 'pending',
  }));
}

/**
 * Staff decide a change request (`partners:approve` covering the workshop's city). Approving a pin applies it and marks the
 * location verified; approving a GSTIN applies it (and the GST-registered flag, which the bill follows). Compare-and-set on
 * the request's `version`; the decision and the applied change are one audited transaction.
 */
export async function decideWorkshopChange(
  db: Tx,
  input: {
    scope: CityScope;
    changeId: string;
    approve: boolean;
    note: string | null;
    version: number;
    staffUserId: string;
  },
): Promise<{ status: 'approved' | 'rejected' }> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        id: workshopChangeRequests.id,
        workshopId: workshopChangeRequests.workshopId,
        kind: workshopChangeRequests.kind,
        payload: workshopChangeRequests.payload,
        status: workshopChangeRequests.status,
        cityId: workshops.cityId,
      })
      .from(workshopChangeRequests)
      .innerJoin(workshops, eq(workshops.id, workshopChangeRequests.workshopId))
      .where(eq(workshopChangeRequests.id, input.changeId))
      .for('update', { of: workshopChangeRequests });
    if (!c || (!input.scope.all && !input.scope.cityIds.includes(c.cityId)))
      throw new NotFoundError('Request not found');
    if (c.status !== 'pending')
      throw new ConflictError('This request was already decided', 'ALREADY_DECIDED');
    const note = input.note?.trim() ?? null;
    if (!input.approve && (note === null || note.length < 5))
      throw new ValidationError('Say why it was turned down (5 to 300 characters)', 'NOTE_REQUIRED');
    if (input.approve) {
      const p = c.payload as { lat?: number; lng?: number; pincode?: string | null; gstin?: string | null };
      if (c.kind === 'location') await assertPinInCity(tx, p.pincode, c.cityId);
      try {
        if (c.kind === 'location' && p.lat !== undefined && p.lng !== undefined) {
          const location = { lat: p.lat, lng: p.lng };
          await tx.transaction(async (sp) =>
            sp
              .update(workshops)
              .set({
                location,
                locationVerified: true,
                ...(p.pincode ? { pincode: p.pincode } : {}),
                updatedAt: new Date(),
              })
              .where(eq(workshops.id, c.workshopId)),
          );
        } else if (c.kind === 'gstin') {
          const gstin = p.gstin ?? null;
          await tx.transaction(async (sp) =>
            sp
              .update(workshops)
              .set({ gstin, gstRegistered: gstin !== null, updatedAt: new Date() })
              .where(eq(workshops.id, c.workshopId)),
          );
        }
      } catch (err) {
        mapPgError(err);
      }
    }
    const [row] = await tx
      .update(workshopChangeRequests)
      .set({
        status: input.approve ? 'approved' : 'rejected',
        decidedBy: input.staffUserId,
        decidedAt: sql`now()`,
        decisionNote: note,
      })
      .where(
        and(
          eq(workshopChangeRequests.id, c.id),
          eq(workshopChangeRequests.status, 'pending'),
          eq(workshopChangeRequests.version, input.version),
        ),
      )
      .returning({ status: workshopChangeRequests.status });
    if (!row)
      throw new ConflictError('This request changed meanwhile; reload and try again', 'STALE_REQUEST');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'admin',
      action: input.approve ? 'workshop.change_approved' : 'workshop.change_rejected',
      entity: 'workshop',
      entityId: c.workshopId,
      after: { kind: c.kind },
      reason: note,
    });
    await recordServerEvent(tx, 'workshop_change_decided', {
      userId: input.staffUserId,
      cityId: c.cityId,
      props: { workshopId: c.workshopId, kind: c.kind as 'location' | 'gstin', approved: input.approve },
    });
    return { status: input.approve ? 'approved' : 'rejected' };
  });
}
