import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  OPERATIONAL_SETTINGS,
  isGlobalOnly,
  needsCoinGuard,
  SETTING_KEYS,
  settingProblem,
  type SettingKey,
} from '@mechdost/shared/settings';
import { auditLog, cities, settings } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * Admin settings (hard rule 8; registry `@mechdost/shared/settings`). A global value per key, optionally
 * overridden per city; the city value wins. Writes are validated against the registry, compare-and-set on
 * `version`, and audited (before/after) in the same transaction. Clearing a city override falls back to global.
 */
export interface SettingRow {
  key: SettingKey;
  default: unknown;
  global: { value: unknown; version: number } | null;
  city: { value: unknown; version: number } | null;
  /** What the system uses for this city (or globally when no city is given). */
  effective: unknown;
}

export async function listOperationalSettings(db: Tx, cityId: string | null): Promise<SettingRow[]> {
  const rows = await db
    .select({ key: settings.key, cityId: settings.cityId, value: settings.value, version: settings.version })
    .from(settings)
    .where(cityId ? or(isNull(settings.cityId), eq(settings.cityId, cityId)) : isNull(settings.cityId));
  return SETTING_KEYS.map((key) => {
    const g = rows.find((r) => r.key === key && r.cityId === null);
    const c = cityId ? rows.find((r) => r.key === key && r.cityId === cityId) : undefined;
    const fallback = OPERATIONAL_SETTINGS[key].default;
    return {
      key,
      default: fallback,
      global: g ? { value: g.value, version: g.version } : null,
      city: c ? { value: c.value, version: c.version } : null,
      effective: c ? c.value : g ? g.value : fallback,
    };
  });
}

const scopeWhere = (key: string, cityId: string | null) =>
  and(eq(settings.key, key), cityId ? eq(settings.cityId, cityId) : isNull(settings.cityId));

/** A whole-site number setting: the admin's global value, else the registry default. */
export async function globalIntSetting(db: Tx, key: SettingKey): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.cityId)))
    .limit(1);
  const v = row?.value;
  const spec = OPERATIONAL_SETTINGS[key];
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
  return spec.kind === 'int' && typeof spec.default === 'number' ? spec.default : 0;
}

/** A whole-site yes/no setting: the admin's global value, else the registry default. */
export async function globalFlagSetting(db: Tx, key: SettingKey): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.cityId)))
    .limit(1);
  if (typeof row?.value === 'boolean') return row.value;
  const spec = OPERATIONAL_SETTINGS[key];
  return spec.kind === 'boolean' && spec.default;
}

/** Create (`expectedVersion` null) or change the global value or one city's override. */
export async function saveOperationalSetting(
  db: Tx,
  input: {
    key: SettingKey;
    cityId: string | null;
    value: unknown;
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number }> {
  if (input.cityId && isGlobalOnly(input.key))
    throw new ValidationError(
      `${input.key} applies to every city; set the global value`,
      'SETTING_GLOBAL_ONLY',
    );
  const problem = settingProblem(input.key, input.value);
  if (problem)
    throw new ValidationError(
      `Invalid value for ${input.key}`,
      problem === 'range' ? 'SETTING_RANGE' : 'SETTING_TYPE',
    );
  // Order rewards can be farmed until an anti-abuse guard is chosen (user 2026-11-14: "decide when enabling").
  if (needsCoinGuard(input.key, input.value))
    throw new ValidationError(
      `${input.key} stays 0 until an anti-abuse guard for order rewards is chosen`,
      'COIN_GUARD_REQUIRED',
    );
  // `value` is a NOT NULL jsonb column: a null setting is stored as JSON null, not SQL NULL.
  const stored = input.value === null ? sql`'null'::jsonb` : input.value;
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(scopeWhere(input.key, input.cityId));
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(settings)
        .values({ key: input.key, cityId: input.cityId, value: stored, updatedBy: input.staffUserId })
        .onConflictDoNothing()
        .returning({ version: settings.version });
    } else {
      [saved] = await tx
        .update(settings)
        .set({ value: stored, updatedBy: input.staffUserId })
        .where(and(scopeWhere(input.key, input.cityId), eq(settings.version, input.expectedVersion)))
        .returning({ version: settings.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this setting; reload and try again', 'STALE_SETTING');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'setting.saved',
      entity: 'setting',
      entityId: input.cityId ? `${input.key}@${input.cityId}` : input.key,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: input.value, version: saved.version },
    });
    return saved;
  });
}

/** Remove one city's override (the global value applies again). */
export async function clearCitySetting(
  db: Tx,
  input: { key: SettingKey; cityId: string; expectedVersion: number; staffUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(settings)
      .where(and(scopeWhere(input.key, input.cityId), eq(settings.version, input.expectedVersion)))
      .returning({ value: settings.value, version: settings.version });
    if (!gone)
      throw new ConflictError('Someone else changed this setting; reload and try again', 'STALE_SETTING');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'setting.cleared',
      entity: 'setting',
      entityId: `${input.key}@${input.cityId}`,
      before: { value: gone.value, version: gone.version },
      after: null,
    });
  });
}

/** City id by its public code (RPR), or 404. */
export async function cityIdByCode(db: Tx, code: string): Promise<string> {
  const [row] = await db.select({ id: cities.id }).from(cities).where(eq(cities.code, code)).limit(1);
  if (!row) throw new NotFoundError('City not found');
  return row.id;
}
