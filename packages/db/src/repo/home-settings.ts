import { and, asc, eq, inArray } from 'drizzle-orm';
import type { HomeSettingsInput } from '@mechdost/shared/service-requests';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { auditLog, workshops, workshopServices } from '../schema';
import { settingOr } from './checkout';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * A workshop's home servicing settings (spec 06/07, design 2026-11-15): on/off, travel radius, its own visit fee (up to
 * the per-city maximum `service.home_fee_max_paise`) and which menu lines it does at home. The owner edits them in the
 * workshop portal (`service_menu:write`, scoped to their workshop), staff in the admin workshop editor; both write an
 * audit row and use the workshop's `version` as the compare-and-set.
 */
export async function homeFeeCap(tx: Tx, cityId: string): Promise<number> {
  return settingOr(tx, cityId, {
    key: 'service.home_fee_max_paise',
    fallback: OPERATIONAL_SETTINGS['service.home_fee_max_paise'].default,
  });
}

export async function assertHomeFeeWithinCap(tx: Tx, cityId: string, feePaise: number): Promise<void> {
  const cap = await homeFeeCap(tx, cityId);
  if (feePaise > cap)
    throw new ValidationError('The visit fee is above the limit for this city', 'FEE_ABOVE_CAP', {
      maxPaise: cap,
    });
}

export interface HomeSettingsView {
  workshopId: string;
  name: string;
  homeService: boolean;
  homeRadiusKm: number;
  homeVisitFeePaise: number;
  maxFeePaise: number;
  gstRegistered: boolean;
  version: number;
  services: { key: string; title: string; titleHi: string | null; homeAvailable: boolean }[];
}

/** The home settings of every workshop the caller may edit (their own grants; others are simply absent). */
export async function getWorkshopHomeSettings(
  db: Tx,
  workshopIds: readonly string[],
): Promise<HomeSettingsView[]> {
  if (workshopIds.length === 0) return [];
  const rows = await db
    .select()
    .from(workshops)
    .where(inArray(workshops.id, [...workshopIds]))
    .orderBy(asc(workshops.name), asc(workshops.id));
  const menu = await db
    .select()
    .from(workshopServices)
    .where(and(inArray(workshopServices.workshopId, [...workshopIds]), eq(workshopServices.active, true)))
    .orderBy(asc(workshopServices.sortOrder), asc(workshopServices.key));
  const out: HomeSettingsView[] = [];
  for (const w of rows)
    out.push({
      workshopId: w.id,
      name: w.name,
      homeService: w.homeService,
      homeRadiusKm: w.homeRadiusKm,
      homeVisitFeePaise: w.homeVisitFeePaise,
      maxFeePaise: await homeFeeCap(db, w.cityId),
      gstRegistered: w.gstRegistered,
      version: w.version,
      services: menu
        .filter((m) => m.workshopId === w.id)
        .map((m) => ({ key: m.key, title: m.title, titleHi: m.titleHi, homeAvailable: m.homeAvailable })),
    });
  return out;
}

/**
 * Save a workshop's home settings (portal). `workshopIds` is what the caller's grants cover: any other id is 404.
 * `homeServiceKeys` is the full set of menu lines done at home (the rest are switched off).
 */
export async function saveWorkshopHomeSettings(
  db: Tx,
  input: {
    workshopIds: readonly string[];
    workshopId: string;
    staffUserId: string;
    settings: HomeSettingsInput;
  },
): Promise<{ version: number }> {
  const s = input.settings;
  if (!input.workshopIds.includes(input.workshopId)) throw new NotFoundError('Workshop not found');
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ id: workshops.id, cityId: workshops.cityId })
      .from(workshops)
      .where(eq(workshops.id, input.workshopId))
      .limit(1)
      .for('update');
    if (!cur) throw new NotFoundError('Workshop not found');
    await assertHomeFeeWithinCap(tx, cur.cityId, s.homeVisitFeePaise);
    const keys = [...new Set(s.homeServiceKeys)];
    if (keys.length > 0) {
      const found = await tx
        .select({ key: workshopServices.key })
        .from(workshopServices)
        .where(
          and(
            eq(workshopServices.workshopId, cur.id),
            eq(workshopServices.active, true),
            inArray(workshopServices.key, keys),
          ),
        );
      if (found.length !== keys.length)
        throw new ValidationError('A chosen service is not on your menu', 'UNKNOWN_SERVICE');
    }
    const [row] = await tx
      .update(workshops)
      .set({
        homeService: s.homeService,
        homeRadiusKm: s.homeRadiusKm,
        homeVisitFeePaise: s.homeVisitFeePaise,
      })
      .where(and(eq(workshops.id, cur.id), eq(workshops.version, s.version)))
      .returning({ version: workshops.version });
    if (!row)
      throw new ConflictError('The workshop changed meanwhile; reload and try again', 'STALE_WORKSHOP');
    await tx
      .update(workshopServices)
      .set({ homeAvailable: false })
      .where(and(eq(workshopServices.workshopId, cur.id), eq(workshopServices.homeAvailable, true)));
    if (keys.length > 0)
      await tx
        .update(workshopServices)
        .set({ homeAvailable: true })
        .where(and(eq(workshopServices.workshopId, cur.id), inArray(workshopServices.key, keys)));
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'workshop',
      action: 'workshop.home_settings',
      entity: 'workshop',
      entityId: cur.id,
      after: {
        homeService: s.homeService,
        radiusKm: s.homeRadiusKm,
        feePaise: s.homeVisitFeePaise,
        services: keys,
      },
    });
    await recordServerEvent(tx, 'workshop_home_settings_saved', {
      userId: input.staffUserId,
      cityId: cur.cityId,
      props: {
        workshopId: cur.id,
        homeService: s.homeService,
        radiusKm: s.homeRadiusKm,
        feePaise: s.homeVisitFeePaise,
        homeServices: keys.length,
        by: 'workshop',
      },
    });
    return row;
  });
}
