import { and, eq, isNull, or } from 'drizzle-orm';
import {
  cleanCompany,
  COMPANY_FIELDS,
  EMPTY_COMPANY,
  readCompany,
  type CompanyDetails,
  type CompanyField,
} from '@mechdost/shared/company';
import {
  cleanHomeLayout,
  DEFAULT_HOME_LAYOUT,
  readHomeLayout,
  type HomeLayout,
} from '@mechdost/shared/site-layout';
import { auditLog, settings } from '../schema';
import { ConflictError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Two whole-site values the admin edits as one document each (hard rule 8; design 2026-11-15 items 6 and 8), stored
 * as rows of the `settings` table (jsonb value, `version`, optional city) and changed only by compare-and-set with an
 * audit row and a server event in the same transaction:
 * - `site.home_layout`: the home page layout (`@mechdost/shared/site-layout`); a city row wins over the global one.
 * - `company.details`: legal facts and the grievance officer (`@mechdost/shared/company`); global only, since the
 *   legal entity does not change by city.
 */
export const HOME_LAYOUT_KEY = 'site.home_layout';
export const COMPANY_KEY = 'company.details';

const scopeWhere = (key: string, cityId: string | null) =>
  and(eq(settings.key, key), cityId ? eq(settings.cityId, cityId) : isNull(settings.cityId));

const STALE = (what: string) =>
  new ConflictError(`Someone else changed the ${what}; reload and try again`, 'STALE_SETTING');

// ── Home layout ──────────────────────────────────────────────────────────────────────────────────────────────

/** The layout the storefront shows for a city (the city's own, else the global one, else the default). */
export async function getHomeLayout(db: Tx, cityId: string | null): Promise<HomeLayout> {
  const rows = await db
    .select({ cityId: settings.cityId, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.key, HOME_LAYOUT_KEY),
        cityId ? or(isNull(settings.cityId), eq(settings.cityId, cityId)) : isNull(settings.cityId),
      ),
    );
  const row =
    (cityId ? rows.find((r) => r.cityId === cityId) : undefined) ?? rows.find((r) => r.cityId === null);
  return row ? readHomeLayout(row.value) : DEFAULT_HOME_LAYOUT;
}

export interface HomeLayoutAdminView {
  layout: HomeLayout;
  /** This scope's own saved row; null = none saved (the layout shown is inherited or the default). */
  version: number | null;
  /** True when a city is chosen and shows the global (or default) layout because it has no override. */
  inherited: boolean;
}

export async function getHomeLayoutForAdmin(db: Tx, cityId: string | null): Promise<HomeLayoutAdminView> {
  const [own] = await db
    .select({ value: settings.value, version: settings.version })
    .from(settings)
    .where(scopeWhere(HOME_LAYOUT_KEY, cityId));
  if (own) return { layout: readHomeLayout(own.value), version: own.version, inherited: false };
  return { layout: await getHomeLayout(db, null), version: null, inherited: cityId !== null };
}

/** Save the global layout or one city's (`expectedVersion` null creates). Live at once; the caller revalidates. */
export async function saveHomeLayout(
  db: Tx,
  input: { cityId: string | null; layout: unknown; expectedVersion: number | null; staffUserId: string },
): Promise<{ version: number; layout: HomeLayout }> {
  const checked = cleanHomeLayout(input.layout);
  if (!checked.ok)
    throw new ValidationError('This layout cannot be saved as written', 'LAYOUT_INVALID', {
      problem: checked.problem,
    });
  const { layout } = checked;
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(scopeWhere(HOME_LAYOUT_KEY, input.cityId));
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(settings)
        .values({ key: HOME_LAYOUT_KEY, cityId: input.cityId, value: layout, updatedBy: input.staffUserId })
        .onConflictDoNothing()
        .returning({ version: settings.version });
    } else {
      [saved] = await tx
        .update(settings)
        .set({ value: layout, updatedBy: input.staffUserId })
        .where(and(scopeWhere(HOME_LAYOUT_KEY, input.cityId), eq(settings.version, input.expectedVersion)))
        .returning({ version: settings.version });
    }
    if (!saved) throw STALE('home layout');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'layout.saved',
      entity: 'layout',
      entityId: input.cityId ? `${HOME_LAYOUT_KEY}@${input.cityId}` : HOME_LAYOUT_KEY,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: layout, version: saved.version },
    });
    await recordServerEvent(tx, 'admin_layout_published', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: {
        scope: input.cityId ? 'city' : 'global',
        action: 'saved',
        hidden: layout.hidden.length,
        tiles: layout.featured?.length ?? 0,
        mapDefault: layout.mapDefault,
      },
    });
    return { version: saved.version, layout };
  });
}

/** Remove the saved layout of a scope (the city inherits the global one; the global one returns to the default). */
export async function resetHomeLayout(
  db: Tx,
  input: { cityId: string | null; expectedVersion: number; staffUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(settings)
      .where(and(scopeWhere(HOME_LAYOUT_KEY, input.cityId), eq(settings.version, input.expectedVersion)))
      .returning({ value: settings.value, version: settings.version });
    if (!gone) throw STALE('home layout');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'layout.reset',
      entity: 'layout',
      entityId: input.cityId ? `${HOME_LAYOUT_KEY}@${input.cityId}` : HOME_LAYOUT_KEY,
      before: { value: gone.value, version: gone.version },
      after: null,
    });
    await recordServerEvent(tx, 'admin_layout_published', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: {
        scope: input.cityId ? 'city' : 'global',
        action: 'reset',
        hidden: 0,
        tiles: 0,
        mapDefault: DEFAULT_HOME_LAYOUT.mapDefault,
      },
    });
  });
}

// ── Company details ──────────────────────────────────────────────────────────────────────────────────────────

/** The company details (every field, '' = not filled). */
export async function getCompany(db: Tx): Promise<{ details: CompanyDetails; version: number | null }> {
  const [row] = await db
    .select({ value: settings.value, version: settings.version })
    .from(settings)
    .where(scopeWhere(COMPANY_KEY, null));
  return row
    ? { details: readCompany(row.value), version: row.version }
    : { details: EMPTY_COMPANY, version: null };
}

/** Save the company details as one document (`expectedVersion` null creates). The caller revalidates the site. */
export async function saveCompany(
  db: Tx,
  input: {
    details: Partial<Record<CompanyField, unknown>>;
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number; details: CompanyDetails }> {
  const checked = cleanCompany(input.details);
  if (!checked.ok)
    throw new ValidationError('A company detail is not in the right form', 'COMPANY_INVALID', {
      field: checked.field,
      problem: checked.problem,
    });
  const { details } = checked;
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(scopeWhere(COMPANY_KEY, null));
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(settings)
        .values({ key: COMPANY_KEY, cityId: null, value: details, updatedBy: input.staffUserId })
        .onConflictDoNothing()
        .returning({ version: settings.version });
    } else {
      [saved] = await tx
        .update(settings)
        .set({ value: details, updatedBy: input.staffUserId })
        .where(and(scopeWhere(COMPANY_KEY, null), eq(settings.version, input.expectedVersion)))
        .returning({ version: settings.version });
    }
    if (!saved) throw STALE('company details');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'company.saved',
      entity: 'company',
      entityId: COMPANY_KEY,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: details, version: saved.version },
    });
    const filled = COMPANY_FIELDS.filter((f) => details[f] !== '').length;
    await recordServerEvent(tx, 'admin_company_saved', {
      userId: input.staffUserId,
      props: {
        filled,
        grievanceShown: Boolean(details.grievanceName || details.grievanceEmail || details.grievancePhone),
      },
    });
    return { version: saved.version, details };
  });
}
