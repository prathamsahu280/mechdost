import { eq, sql } from 'drizzle-orm';
import {
  DEVANAGARI_RE,
  inIndia,
  isPincode,
  PINCODE_AREA_MAX,
  PINCODE_AREA_MIN,
  PINCODE_INACTIVE_REASONS,
  type PincodeInactiveReason,
} from '@mechdost/shared/geo';
import type { Tx } from './repo/orders';
import { num, numOrNull, rowsOf } from './repo/sql-rows';
import * as s from './schema';

/**
 * Reference PIN codes of a city (spec 15 "PIN codes"; data and sources: docs/research/raipur-pincodes.md). Loaded
 * with `pnpm db:seed:pincodes` — safe to re-run on the launch database:
 * - a PIN not in the database is added (active or switched off with its reason, as the file says);
 * - a row the seed added earlier (`source = 'seed'`) gets the file's area names and centroid when they differ;
 * - a row any person changed in the admin console (`source = 'admin'`) is left exactly as it is;
 * - the seed never switches an existing PIN on or off, never moves it to another city and never deletes a row
 *   (orders, shops and workshops reference PIN codes).
 * The whole file is validated before anything is written; one transaction under an advisory lock.
 */
export interface PincodeSeedRow {
  pincode: string;
  areaEn: string;
  areaHi: string;
  lat: number;
  lng: number;
  active: boolean;
  /** Required when `active` is false. */
  reason?: PincodeInactiveReason | null;
}

export interface PincodeSeedFile {
  state: { code: string; name: string; nameHi: string; gstStateCode: string };
  city: { code: string; slug: string; name: string; nameHi: string; lat: number; lng: number };
  pincodes: PincodeSeedRow[];
}

export interface PincodeSeedResult {
  inserted: number;
  refreshed: number;
  unchanged: number;
  keptAdmin: number;
  /** PINs already listed under another city: left alone, named so a person can look. */
  otherCity: string[];
}

const LOCK = sql`select pg_advisory_xact_lock(hashtextextended('seed:pincodes', 0))`;
const SAME = 1e-7;

/** Every problem in the file, by row; an empty list means it can be loaded. */
export function pincodeFileProblems(f: PincodeSeedFile): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const areaOk = (v: string) =>
    v.trim() === v && v.length >= PINCODE_AREA_MIN && v.length <= PINCODE_AREA_MAX;
  if (!/^[A-Z]{3}$/.test(f.city.code)) problems.push(`city code ${f.city.code}`);
  f.pincodes.forEach((p, i) => {
    const at = `row ${String(i + 1)} (${p.pincode})`;
    if (!isPincode(p.pincode)) problems.push(`${at}: PIN format`);
    if (seen.has(p.pincode)) problems.push(`${at}: duplicate PIN`);
    seen.add(p.pincode);
    if (!areaOk(p.areaEn)) problems.push(`${at}: English area name`);
    if (!areaOk(p.areaHi) || !DEVANAGARI_RE.test(p.areaHi)) problems.push(`${at}: Hindi area name`);
    if (!inIndia(p.lat, p.lng)) problems.push(`${at}: coordinates outside India`);
    if (!p.active && !(p.reason && PINCODE_INACTIVE_REASONS.includes(p.reason)))
      problems.push(`${at}: an inactive PIN needs a reason code`);
    if (p.active && p.reason) problems.push(`${at}: an active PIN has no reason`);
  });
  return problems;
}

export async function upsertPincodes(db: Tx, f: PincodeSeedFile): Promise<PincodeSeedResult> {
  const problems = pincodeFileProblems(f);
  if (problems.length > 0) throw new Error(`PIN code file refused: ${problems.join('; ')}`);
  return db.transaction(async (tx) => {
    await tx.execute(LOCK);
    await tx
      .insert(s.states)
      .values({
        code: f.state.code,
        name: f.state.name,
        nameHi: f.state.nameHi,
        gstStateCode: f.state.gstStateCode,
      })
      .onConflictDoNothing({ target: s.states.code });
    const [state] = await tx
      .select({ id: s.states.id })
      .from(s.states)
      .where(eq(s.states.code, f.state.code));
    if (!state) throw new Error('PIN seed: state missing');
    // A new city starts "coming soon": going live is the admin's decision (spec 15 launch playbook).
    await tx
      .insert(s.cities)
      .values({
        stateId: state.id,
        code: f.city.code,
        slug: f.city.slug,
        name: f.city.name,
        nameHi: f.city.nameHi,
        status: 'coming_soon',
        centroid: { lng: f.city.lng, lat: f.city.lat },
      })
      .onConflictDoNothing({ target: s.cities.code });
    const [city] = await tx.select({ id: s.cities.id }).from(s.cities).where(eq(s.cities.code, f.city.code));
    if (!city) throw new Error('PIN seed: city missing');

    const existing = new Map(
      rowsOf<{
        pincode: string;
        city_id: string | null;
        locality: string | null;
        locality_hi: string | null;
        lat: unknown;
        lng: unknown;
        source: string;
      }>(
        await tx.execute(sql`select pincode, city_id, locality, locality_hi, ST_Y(centroid::geometry) as lat,
            ST_X(centroid::geometry) as lng, source
          from pincodes where pincode in (${sql.join(
            f.pincodes.map((p) => sql`${p.pincode}`),
            sql`, `,
          )}) for update`),
      ).map((r) => [r.pincode, r]),
    );

    const result: PincodeSeedResult = {
      inserted: 0,
      refreshed: 0,
      unchanged: 0,
      keptAdmin: 0,
      otherCity: [],
    };
    for (const p of f.pincodes) {
      const row = existing.get(p.pincode);
      const after = { areaEn: p.areaEn, areaHi: p.areaHi, lat: p.lat, lng: p.lng };
      if (!row) {
        await tx.insert(s.pincodes).values({
          pincode: p.pincode,
          stateId: state.id,
          cityId: city.id,
          locality: p.areaEn,
          localityHi: p.areaHi,
          centroid: { lng: p.lng, lat: p.lat },
          active: p.active,
          inactiveReason: p.active ? null : (p.reason ?? null),
          source: 'seed',
        });
        await audit(tx, p.pincode, null, { ...after, active: p.active, reason: p.reason ?? null });
        result.inserted++;
        continue;
      }
      if (row.source !== 'seed') {
        result.keptAdmin++;
        continue;
      }
      if (row.city_id !== null && row.city_id !== city.id) {
        result.otherCity.push(p.pincode);
        continue;
      }
      const lat = numOrNull(row.lat);
      const lng = numOrNull(row.lng);
      const same =
        row.city_id === city.id &&
        row.locality === p.areaEn &&
        row.locality_hi === p.areaHi &&
        lat !== null &&
        lng !== null &&
        Math.abs(num(lat) - p.lat) < SAME &&
        Math.abs(num(lng) - p.lng) < SAME;
      if (same) {
        result.unchanged++;
        continue;
      }
      await tx
        .update(s.pincodes)
        .set({
          cityId: city.id,
          locality: p.areaEn,
          localityHi: p.areaHi,
          centroid: { lng: p.lng, lat: p.lat },
        })
        .where(eq(s.pincodes.pincode, p.pincode));
      await audit(tx, p.pincode, { areaEn: row.locality, areaHi: row.locality_hi, lat, lng }, after);
      result.refreshed++;
    }
    return result;
  });
}

async function audit(tx: Tx, pincode: string, before: unknown, after: unknown) {
  await tx.insert(s.auditLog).values({
    actorUserId: null,
    actorRole: 'system',
    action: 'pincode.seeded',
    entity: 'pincode',
    entityId: pincode,
    before,
    after,
  });
}
