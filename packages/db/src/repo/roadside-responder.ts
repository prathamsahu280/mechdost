import { and, asc, eq, inArray } from 'drizzle-orm';
import type { RsaProblemType } from '@mechdost/shared/rsa';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { auditLog, rsaResponders, workshops } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * A workshop's roadside opt-in (spec 22, spec 07): on/off, radius, vehicle types, problem types, towing. The owner edits
 * it in the workshop portal (`roadside:respond`, scoped to their workshops: another id is 404), compare-and-set on the
 * row's `version`, audited. Only a workshop responder exists today; a mechanic gets the same shape in phase 2.
 */
export interface RsaOptIn {
  workshopId: string;
  name: string;
  nameHi: string | null;
  enabled: boolean;
  radiusKm: number;
  vehicleTypes: VehicleType[];
  problemTypes: RsaProblemType[];
  towing: boolean;
  version: number;
}

const DEFAULT = {
  enabled: false,
  radiusKm: 10,
  vehicleTypes: ['2W', '4W'] as VehicleType[],
  problemTypes: ['dead_battery', 'flat_tyre', 'out_of_fuel', 'minor_fix', 'unknown'] as RsaProblemType[],
  towing: false,
  version: 0,
};

export async function getRsaOptIns(db: Tx, workshopIds: readonly string[]): Promise<RsaOptIn[]> {
  if (workshopIds.length === 0) return [];
  const rows = await db
    .select({ w: workshops, r: rsaResponders })
    .from(workshops)
    .leftJoin(rsaResponders, eq(rsaResponders.workshopId, workshops.id))
    .where(inArray(workshops.id, [...workshopIds]))
    .orderBy(asc(workshops.name), asc(workshops.id));
  return rows.map(({ w, r }) => ({
    workshopId: w.id,
    name: w.name,
    nameHi: w.nameHi,
    enabled: r?.enabled ?? DEFAULT.enabled,
    radiusKm: r?.radiusKm ?? DEFAULT.radiusKm,
    vehicleTypes: (r?.vehicleTypes ?? DEFAULT.vehicleTypes) as VehicleType[],
    problemTypes: (r?.problemTypes ?? DEFAULT.problemTypes) as RsaProblemType[],
    towing: r?.towing ?? DEFAULT.towing,
    version: r?.version ?? DEFAULT.version,
  }));
}

export async function saveRsaOptIn(
  db: Tx,
  input: {
    workshopIds: readonly string[];
    workshopId: string;
    staffUserId: string;
    optIn: {
      enabled: boolean;
      radiusKm: number;
      vehicleTypes: readonly VehicleType[];
      problemTypes: readonly RsaProblemType[];
      towing: boolean;
      version: number;
    };
  },
): Promise<{ version: number }> {
  if (!input.workshopIds.includes(input.workshopId)) throw new NotFoundError('Workshop not found');
  const o = input.optIn;
  return db.transaction(async (tx) => {
    const [w] = await tx
      .select({ id: workshops.id, cityId: workshops.cityId })
      .from(workshops)
      .where(eq(workshops.id, input.workshopId))
      .limit(1)
      .for('update');
    if (!w) throw new NotFoundError('Workshop not found');
    const values = {
      enabled: o.enabled,
      radiusKm: o.radiusKm,
      vehicleTypes: [...o.vehicleTypes],
      problemTypes: [...o.problemTypes],
      towing: o.towing,
    };
    let row: { version: number } | undefined;
    if (o.version === 0) {
      [row] = await tx
        .insert(rsaResponders)
        .values({ workshopId: w.id, ...values })
        .onConflictDoNothing()
        .returning({ version: rsaResponders.version });
    } else {
      [row] = await tx
        .update(rsaResponders)
        .set(values)
        .where(and(eq(rsaResponders.workshopId, w.id), eq(rsaResponders.version, o.version)))
        .returning({ version: rsaResponders.version });
    }
    if (!row) throw new ConflictError('Your roadside settings changed meanwhile; reload', 'STALE_OPT_IN');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'workshop',
      action: 'workshop.rsa_opt_in',
      entity: 'workshop',
      entityId: w.id,
      after: { ...values },
    });
    await recordServerEvent(tx, 'workshop_rsa_opt_in_saved', {
      userId: input.staffUserId,
      cityId: w.cityId,
      props: { workshopId: w.id, enabled: o.enabled },
    });
    return row;
  });
}
