/**
 * Ustaad Network settings (spec 23 § 15; registry `@mechdost/shared/ustaad/settings`). Global rows of the existing
 * `settings` table under `ustaad.*`. A save checks type → invariants on the whole set (SR-40) → range, then
 * compare-and-sets on `version` and writes `audit_log` (`setting.saved`) and the analytics event in one transaction.
 * A refused invariant is recorded too (`admin_ustaad_invariant_refused`), outside the refused transaction.
 */
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type { UstaadAccessMode } from '@mechdost/shared/ustaad/codes';
import {
  USTAAD_SETTINGS,
  USTAAD_SETTING_KEYS,
  ustaadSettingInvariant,
  ustaadSettingProblem,
  ustaadValuesFrom,
  type UstaadSettingKey,
  type UstaadSettingValue,
  type UstaadSettingValues,
} from '@mechdost/shared/ustaad/settings';
import { auditLog, settings, ustaadWordLists } from '../../schema';
import { ConflictError, ValidationError } from '../errors';
import { recordServerEvent } from '../events';
import type { Tx } from '../orders';

export interface UstaadSettingsView {
  values: UstaadSettingValues;
  /** Stored version per key (absent = never saved, the default applies). */
  versions: Partial<Record<UstaadSettingKey, number>>;
}

export async function readUstaadSettings(db: Tx): Promise<UstaadSettingsView> {
  const rows = await db
    .select({ key: settings.key, value: settings.value, version: settings.version })
    .from(settings)
    .where(and(isNull(settings.cityId), like(settings.key, 'ustaad.%')));
  const stored: Record<string, unknown> = {};
  const versions: Partial<Record<UstaadSettingKey, number>> = {};
  for (const r of rows) {
    stored[r.key] = r.value;
    if ((USTAAD_SETTING_KEYS as readonly string[]).includes(r.key))
      versions[r.key as UstaadSettingKey] = r.version;
  }
  return { values: ustaadValuesFrom(stored), versions };
}

/** A few keys at once (hot paths read only what they need). */
export async function readUstaadSettingValues<K extends UstaadSettingKey>(
  db: Tx,
  keys: readonly K[],
): Promise<Pick<UstaadSettingValues, K>> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(isNull(settings.cityId), inArray(settings.key, [...keys])));
  const stored: Record<string, unknown> = {};
  for (const r of rows) stored[r.key] = r.value;
  return ustaadValuesFrom(stored);
}

/** Who may reach the network now (`ustaad.access`). */
export async function readUstaadAccess(db: Tx): Promise<UstaadAccessMode> {
  const v = await readUstaadSettingValues(db, ['ustaad.access']);
  return v['ustaad.access'] as UstaadAccessMode;
}

export interface SaveUstaadSettingInput {
  key: UstaadSettingKey;
  value: unknown;
  expectedVersion: number | null;
  staffUserId: string;
  /** The saver's role code (super_admin may raise the video length above 180 s with a reason). */
  actorRole: string;
  reasonCode?: string;
}

async function activeProtectedWords(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ustaadWordLists)
    .where(and(eq(ustaadWordLists.list, 'protected'), eq(ustaadWordLists.active, true)));
  return row?.n ?? 0;
}

export async function saveUstaadSetting(db: Tx, input: SaveUstaadSettingInput): Promise<{ version: number }> {
  const problem = ustaadSettingProblem(input.key, input.value);
  if (problem === 'type') throw new ValidationError(`Invalid value for ${input.key}`, 'SETTING_TYPE');
  const value = input.value as UstaadSettingValue;
  const current = await readUstaadSettings(db);
  const next = { ...current.values, [input.key]: value };
  const invariant = ustaadSettingInvariant(next, input.actorRole, {
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    protectedWords: await activeProtectedWords(db),
  });
  if (invariant) {
    await recordServerEvent(db, 'admin_ustaad_invariant_refused', {
      userId: input.staffUserId,
      props: { key: invariant.key },
    });
    throw new ValidationError(`${invariant.key} breaks a network rule`, invariant.code, {
      key: invariant.key,
    });
  }
  if (problem === 'range') throw new ValidationError(`Invalid value for ${input.key}`, 'SETTING_RANGE');
  return db.transaction(async (tx) => {
    const where = and(eq(settings.key, input.key), isNull(settings.cityId));
    const [before] = await tx.select().from(settings).where(where);
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(settings)
        .values({ key: input.key, cityId: null, value, updatedBy: input.staffUserId })
        .onConflictDoNothing()
        .returning({ version: settings.version });
    } else {
      [saved] = await tx
        .update(settings)
        .set({ value, updatedBy: input.staffUserId })
        .where(and(where, eq(settings.version, input.expectedVersion)))
        .returning({ version: settings.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this setting; reload and try again', 'STALE_SETTING');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'setting.saved',
      entity: 'setting',
      entityId: input.key,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value, version: saved.version },
      reason: input.reasonCode ?? null,
    });
    await recordServerEvent(tx, 'admin_ustaad_settings_saved', {
      userId: input.staffUserId,
      props: { keys: [input.key] },
    });
    if (input.key === 'ustaad.access') {
      const from = (before?.value ?? USTAAD_SETTINGS['ustaad.access'].default) as UstaadAccessMode;
      await recordServerEvent(tx, 'admin_ustaad_access_changed', {
        userId: input.staffUserId,
        props: { from, to: value as UstaadAccessMode },
      });
    }
    return saved;
  });
}
