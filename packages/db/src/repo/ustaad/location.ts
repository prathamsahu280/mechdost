/**
 * Garage pin (spec 23 § 4 flow 10, § 9.6; SR-29–32; plan task E1). The only writer of `ustaad_locations` and
 * `ustaad_pin_changes`. The exact point never leaves this file except for staff (`ustaad:location_exact`, audited by
 * the route) or a member who opted in (later, D/E UI). Distances are computed here from stored pins only (never a
 * client point) and returned as band codes after stable per-pair noise (HMAC of the two member ids).
 */
import { createHmac, randomInt } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  accuracyBand,
  noisyDistanceBand,
  pinChangeDecision,
  settingBool,
  settingInt,
  type PinChangeDecision,
} from '@mechdost/shared/ustaad/local';
import { zoneCell, type DistanceBand } from '@mechdost/shared/ustaad/zones';
import { ustaadLocations, ustaadMembers, ustaadPinChanges } from '../../schema';
import { NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { num, rowsOf } from '../sql-rows';
import { recordUstaadEvent } from './events';
import { readUstaadSettingValues } from './settings';

export interface UstaadLocationInput {
  lat: number;
  lng: number;
  accuracyM: number;
  source: 'gps' | 'manual';
  landmark: string | null;
  mockSuspected: boolean;
  useForVerify: boolean;
  countInZone: boolean;
  shareExact: boolean;
  exactAudience: 'connections' | 'all_verified';
  hidden: boolean;
}

/** What the member sees of their own pin (their own exact point is theirs to see). */
export interface MyUstaadLocation {
  lat: number;
  lng: number;
  accuracyM: number;
  source: 'gps' | 'manual';
  landmark: string | null;
  zoneCell: string;
  useForVerify: boolean;
  countInZone: boolean;
  shareExact: boolean;
  exactAudience: 'connections' | 'all_verified';
  hidden: boolean;
  verified: boolean;
  confirmedAt: string;
  version: number;
}

export type SaveUstaadLocationResult =
  | { ok: true; location: MyUstaadLocation }
  | { ok: false; code: Exclude<PinChangeDecision, { ok: true }>['code'] };

const point = (lng: number, lat: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
const DAY_MS = 86_400_000;

/** A fixed per-member circle offset of 0–150 m (spec § 6.5), drawn once with real randomness. */
function circleOffset(): { dNorthM: number; dEastM: number } {
  const r = randomInt(0, 151);
  const a = (randomInt(0, 3600) / 3600) * 2 * Math.PI;
  return { dNorthM: r * Math.cos(a), dEastM: r * Math.sin(a) };
}

async function readMine(tx: Tx, memberId: string): Promise<MyUstaadLocation | null> {
  const [row] = rowsOf<{
    lat: unknown;
    lng: unknown;
    accuracy_m: unknown;
    source: 'gps' | 'manual';
    landmark: string | null;
    zone_cell: string;
    use_for_verify: boolean;
    count_in_zone: boolean;
    share_exact: boolean;
    exact_audience: 'connections' | 'all_verified';
    hidden: boolean;
    verified_at: Date | string | null;
    confirmed_at: Date | string;
    version: unknown;
  }>(
    await tx.execute(sql`select ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, accuracy_m, source,
      landmark, zone_cell, use_for_verify, count_in_zone, share_exact, exact_audience, hidden, verified_at,
      confirmed_at, version from ustaad_locations where member_id = ${memberId}::uuid`),
  );
  if (!row) return null;
  return {
    lat: num(row.lat),
    lng: num(row.lng),
    accuracyM: num(row.accuracy_m),
    source: row.source,
    landmark: row.landmark,
    zoneCell: row.zone_cell,
    useForVerify: row.use_for_verify,
    countInZone: row.count_in_zone,
    shareExact: row.share_exact,
    exactAudience: row.exact_audience,
    hidden: row.hidden,
    verified: row.verified_at !== null,
    confirmedAt: new Date(row.confirmed_at).toISOString(),
    version: num(row.version),
  };
}

export async function myUstaadLocation(db: Tx, memberId: string): Promise<MyUstaadLocation | null> {
  return readMine(db, memberId);
}

/**
 * Put or move the garage pin (plus the three choices) in one transaction. The pin must lie inside the member's city
 * (enabled reach city, `ST_DWithin` of its centre and radius; AT-REGION-1). Limits per `pinChangeDecision`.
 * Home/roadside members may save a pin for verification, but it is never displayed as a point (display rules live
 * in the readers).
 */
export async function saveUstaadLocation(
  db: Tx,
  actor: { memberId: string; userId: string },
  input: UstaadLocationInput,
  now = new Date(),
): Promise<SaveUstaadLocationResult> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: ustaadMembers.id, cityId: ustaadMembers.cityId })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, actor.memberId))
      .for('update')
      .limit(1);
    if (!member) throw new NotFoundError();
    const s = await readUstaadSettingValues(tx, [
      'ustaad.loc.pin_changes_per_day',
      'ustaad.loc.pin_changes_per_30d',
      'ustaad.loc.gps_max_m',
      'ustaad.loc.big_move_m',
      'ustaad.loc.big_move_accuracy_m',
      'ustaad.loc.allow_exact_optin',
      'ustaad.zones.cell_edge_m',
    ]);
    const [inside] = rowsOf<{ ok: boolean | null; enabled: boolean | null }>(
      // City centre + radius when set; otherwise within 15 km of one of the city's PIN code centres (fail closed).
      await tx.execute(sql`select (case when c.centroid is not null
            then ST_DWithin(c.centroid, ${point(input.lng, input.lat)}, c.radius_km * 1000)
            else exists (select 1 from pincodes p where p.city_id = c.id and p.active and p.centroid is not null
              and ST_DWithin(p.centroid, ${point(input.lng, input.lat)}, 15000)) end) as ok, rc.enabled
        from cities c left join ustaad_reach_cities rc on rc.city_id = c.id where c.id = ${member.cityId}::uuid`),
    );
    if (!inside?.ok || inside.enabled === false)
      throw new ValidationError('This place is outside your city', 'USTAAD_REGION');

    const [prev] = rowsOf<{ move_m: unknown; circle_dn: unknown; circle_de: unknown }>(
      await tx.execute(sql`select ST_Distance(location, ${point(input.lng, input.lat)})::int as move_m,
          (ST_Y(circle_center::geometry) - ST_Y(location::geometry)) * 110574 as circle_dn,
          (ST_X(circle_center::geometry) - ST_X(location::geometry)) * 111320 * cos(radians(ST_Y(location::geometry))) as circle_de
        from ustaad_locations where member_id = ${actor.memberId}::uuid for update`),
    );
    const recent = await tx
      .select({ at: ustaadPinChanges.changedAt })
      .from(ustaadPinChanges)
      .where(
        and(
          eq(ustaadPinChanges.memberId, actor.memberId),
          gte(ustaadPinChanges.changedAt, new Date(now.getTime() - 30 * DAY_MS)),
        ),
      );
    const decision = pinChangeDecision(
      {
        source: input.source,
        accuracyM: input.accuracyM,
        moveM: prev ? num(prev.move_m) : null,
        recentChanges: recent.map((r) => r.at),
        now,
      },
      {
        perDay: settingInt(s['ustaad.loc.pin_changes_per_day'], 3),
        per30d: settingInt(s['ustaad.loc.pin_changes_per_30d'], 6),
        gpsMaxM: settingInt(s['ustaad.loc.gps_max_m'], 100),
        bigMoveM: settingInt(s['ustaad.loc.big_move_m'], 1000),
        bigMoveAccuracyM: settingInt(s['ustaad.loc.big_move_accuracy_m'], 50),
      },
    );
    if (!decision.ok) return decision;

    // The circle offset is fixed per member: kept on a move, drawn once for the first pin.
    const off = prev ? { dNorthM: num(prev.circle_dn), dEastM: num(prev.circle_de) } : circleOffset();
    const cLat = input.lat + off.dNorthM / 110_574;
    const cLng = input.lng + off.dEastM / (111_320 * Math.cos((input.lat * Math.PI) / 180));
    const cell = zoneCell(input.lat, input.lng, settingInt(s['ustaad.zones.cell_edge_m'], 1400));
    const shareExact = input.shareExact && settingBool(s['ustaad.loc.allow_exact_optin'], false);
    const values = {
      location: { lng: input.lng, lat: input.lat },
      accuracyM: Math.round(input.accuracyM),
      source: input.source,
      landmark: input.landmark,
      mockSuspected: input.mockSuspected,
      circleCenter: { lng: cLng, lat: cLat },
      zoneCell: cell,
      shareExact,
      exactAudience: input.exactAudience,
      countInZone: input.countInZone,
      useForVerify: input.useForVerify,
      hidden: input.hidden,
      confirmedAt: now,
    };
    if (prev) {
      const moved = decision.counts;
      await tx
        .update(ustaadLocations)
        .set({
          ...values,
          // A real move drops an earlier signboard check (staff check the new place again).
          ...(moved ? { verifiedAt: null, signboardMediaId: null } : {}),
        })
        .where(eq(ustaadLocations.memberId, actor.memberId));
      if (moved)
        await tx.insert(ustaadPinChanges).values({
          memberId: actor.memberId,
          changedAt: now,
          distanceM: num(prev.move_m),
          accuracyM: Math.min(32_767, Math.round(input.accuracyM)),
        });
    } else {
      await tx.insert(ustaadLocations).values({ memberId: actor.memberId, ...values });
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: actor.memberId,
        kind: prev ? 'location_moved' : 'location_confirmed',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: member.cityId,
        props: {
          source: input.source,
          accuracy_band: accuracyBand(input.accuracyM),
          counted: decision.counts,
        },
      },
      {
        name: 'ustaad_location_confirmed',
        memberId: actor.memberId,
        userId: actor.userId,
        props: { source: input.source, accuracyBand: accuracyBand(input.accuracyM) },
      },
    );
    const mine = await readMine(tx, actor.memberId);
    if (!mine) throw new NotFoundError();
    return { ok: true as const, location: mine };
  });
}

/** Attach a signboard photo for "Verified location" (staff check it; F/B review queue reads `signboard_media_id`). */
export async function setUstaadSignboard(
  db: Tx,
  actor: { memberId: string; userId: string },
  mediaId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [media] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`select true as ok from ustaad_media where id = ${mediaId}::uuid
        and owner_member_id = ${actor.memberId}::uuid and kind = 'image' and status = 'verified'`),
    );
    if (!media) throw new NotFoundError();
    const done = await tx
      .update(ustaadLocations)
      .set({ signboardMediaId: mediaId, verifiedAt: null })
      .where(eq(ustaadLocations.memberId, actor.memberId))
      .returning({ id: ustaadLocations.memberId });
    if (done.length === 0) throw new ValidationError('Pin your garage first', 'USTAAD_PIN_REQUIRED');
    await recordUstaadEvent(tx, {
      entityType: 'member',
      entityId: actor.memberId,
      kind: 'location_signboard_added',
      actorId: actor.userId,
      actorRole: 'member',
    });
  });
}

/** Stable noise in [0, 1) for a pair (order-free), keyed by a server secret so it cannot be precomputed. */
export function ustaadPairNoise(secret: string, a: string, b: string): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  const h = createHmac('sha256', secret).update(`${x}|${y}`).digest();
  return h.readUInt32BE(0) / 2 ** 32;
}

/**
 * Distance bands from the viewer to other members (SR-29): stored pins only; members who hid their location, or
 * home/roadside members, get no band (AT-LOC-3). Never a number on the way out.
 */
export async function ustaadDistanceBands(
  db: Tx,
  viewerMemberId: string,
  otherMemberIds: readonly string[],
  secret: string,
): Promise<Map<string, DistanceBand>> {
  const out = new Map<string, DistanceBand>();
  if (otherMemberIds.length === 0) return out;
  const list = sql.join(
    otherMemberIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const real = rowsOf<{ member_id: string; metres: unknown }>(
    await db.execute(sql`select o.member_id, ST_Distance(v.location, o.location)::int as metres
      from ustaad_locations v
      join ustaad_locations o on o.member_id in (${list})
      join ustaad_members m on m.id = o.member_id
      where v.member_id = ${viewerMemberId}::uuid and not v.hidden and not o.hidden
        and m.work_place <> 'home_roadside' and m.status = 'active'`),
  );
  for (const r of real)
    out.set(
      r.member_id,
      noisyDistanceBand(num(r.metres), ustaadPairNoise(secret, viewerMemberId, r.member_id)),
    );
  return out;
}
