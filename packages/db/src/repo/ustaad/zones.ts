/**
 * Zone counts (spec 23 § 6.5, § 9.6; SR-31; plan task E2). Built nightly by the worker (`ustaad_zone_counts`) from
 * verified (when `zones.verified_only`), active members who ticked "count me in my area total" and did not hide
 * their location, in enabled reach cities only. Exact numbers stay here and in the staff reader; members get bands
 * (`bandZone`), including per-speciality cells with complementary suppression. No radius counts anywhere.
 */
import { eq, sql } from 'drizzle-orm';
import { bandZone, settingBool, settingInt, type BandedZone } from '@mechdost/shared/ustaad/local';
import { USTAAD_SEGMENT_CODES } from '@mechdost/shared/ustaad/codes';
import { zoneCentre } from '@mechdost/shared/ustaad/zones';
import { ustaadReachCities, ustaadZoneCounts } from '../../schema';
import { recordServerEvent } from '../events';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { readUstaadSettingValues } from './settings';

export interface UstaadZoneExact {
  zoneCell: string;
  members: number;
  bySegment: Record<string, number>;
  center: { lat: number; lng: number };
  computedAt: string;
}

export interface UstaadZoneBanded extends BandedZone {
  zoneCell: string;
  center: { lat: number; lng: number };
}

/**
 * Rebuild every zone count in one transaction under an advisory lock (two workers never overlap; a repeat gives the
 * same table). Returns `ran: false` when another run holds the lock.
 */
export async function buildUstaadZoneCounts(
  db: Tx,
  now = new Date(),
): Promise<{ ran: boolean; zones: number }> {
  return db.transaction(async (tx) => {
    const [lock] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('ustaad_zone_counts')) as ok`),
    );
    if (!lock?.ok) return { ran: false, zones: 0 };
    const s = await readUstaadSettingValues(tx, ['ustaad.zones.verified_only', 'ustaad.zones.cell_edge_m']);
    const verifiedOnly = settingBool(s['ustaad.zones.verified_only'], true);
    const segments = sql.join(
      USTAAD_SEGMENT_CODES.map((c) => sql`${c}`),
      sql`, `,
    );
    const rows = rowsOf<{ zone_cell: string; city_id: string; members: number; by_segment: unknown }>(
      await tx.execute(sql`with counted as (
          select l.member_id, l.zone_cell, m.city_id
          from ustaad_locations l
          join ustaad_members m on m.id = l.member_id
          join ustaad_reach_cities rc on rc.city_id = m.city_id and rc.enabled
          where l.count_in_zone and not l.hidden and m.status = 'active' and m.restricted_mode = 'none'
            and (${!verifiedOnly} or m.verification_state = 'verified')
        ), seg as (
          select c.zone_cell, s.code, count(*)::int as n
          from counted c join ustaad_member_specialities s on s.member_id = c.member_id
          where s.code in (${segments})
          group by c.zone_cell, s.code
        )
        select c.zone_cell, min(c.city_id::text) as city_id, count(*)::int as members,
          coalesce((select jsonb_object_agg(seg.code, seg.n) from seg where seg.zone_cell = c.zone_cell), '{}'::jsonb)
            as by_segment
        from counted c group by c.zone_cell`),
    );
    await tx.delete(ustaadZoneCounts);
    const edge = settingInt(s['ustaad.zones.cell_edge_m'], 1400);
    if (rows.length > 0)
      await tx.insert(ustaadZoneCounts).values(
        rows.map((r) => {
          const c = zoneCentre(r.zone_cell, edge);
          const seg = (typeof r.by_segment === 'string' ? JSON.parse(r.by_segment) : r.by_segment) as Record<
            string,
            number
          >;
          return {
            zoneCell: r.zone_cell,
            cityId: r.city_id,
            computedAt: now,
            members: Number(r.members),
            bySegment: { schema_version: 1, ...seg },
            center: { lng: c.lng, lat: c.lat },
          };
        }),
      );
    await recordServerEvent(tx, 'ustaad_zone_counts_built', {
      userId: null,
      cityId: null,
      props: { zones: rows.length },
    });
    return { ran: true, zones: rows.length };
  });
}

async function readZones(db: Tx, cityId: string): Promise<UstaadZoneExact[]> {
  const [city] = await db
    .select({ enabled: ustaadReachCities.enabled })
    .from(ustaadReachCities)
    .where(eq(ustaadReachCities.cityId, cityId))
    .limit(1);
  // A disabled (or never enabled) city shows no zones (AT-REGION-1, review focus 4).
  if (!city?.enabled) return [];
  const rows = rowsOf<{
    zone_cell: string;
    members: number;
    by_segment: unknown;
    lat: number;
    lng: number;
    computed_at: Date | string;
  }>(
    await db.execute(sql`select zone_cell, members, by_segment, ST_Y(center::geometry) as lat,
        ST_X(center::geometry) as lng, computed_at
      from ustaad_zone_counts where city_id = ${cityId}::uuid order by zone_cell`),
  );
  return rows.map((r) => {
    const raw = (typeof r.by_segment === 'string' ? JSON.parse(r.by_segment) : r.by_segment) as Record<
      string,
      unknown
    >;
    const bySegment: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw))
      if (k !== 'schema_version' && typeof v === 'number') bySegment[k] = v;
    return {
      zoneCell: r.zone_cell,
      members: Number(r.members),
      bySegment,
      center: { lat: Number(r.lat), lng: Number(r.lng) },
      computedAt: new Date(r.computed_at).toISOString(),
    };
  });
}

/** Staff view (`ustaad:read`): exact counts. */
export async function ustaadZonesExact(db: Tx, cityId: string): Promise<UstaadZoneExact[]> {
  return readZones(db, cityId);
}

/** Member view: bands only (SR-31). */
export async function ustaadZonesBanded(db: Tx, cityId: string): Promise<UstaadZoneBanded[]> {
  const s = await readUstaadSettingValues(db, [
    'ustaad.zones.hide_below',
    'ustaad.zones.exact_from',
    'ustaad.zones.round_above_exact',
  ]);
  const rules = {
    hideBelow: settingInt(s['ustaad.zones.hide_below'], 5),
    exactFrom: settingInt(s['ustaad.zones.exact_from'], 20),
    round: settingBool(s['ustaad.zones.round_above_exact'], true),
  };
  const zones = await readZones(db, cityId);
  return zones.map((z) => ({ zoneCell: z.zoneCell, center: z.center, ...bandZone(z, rules) }));
}
