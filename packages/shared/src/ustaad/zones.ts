/**
 * Zones, privacy bands and distance bands (spec 23 § 6.5, § 9.6; SR-29, SR-31). Pure functions, no dependency: a
 * fixed pointy-top hexagonal grid in axial coordinates on a local equirectangular projection centred on Raipur
 * (21.25° N, 81.63° E). Cell id `hx:{q}:{r}`. Edge `ustaad.zones.cell_edge_m` (default 1,400 m ≈ 5.1 km²).
 * Accurate enough for counting across Chhattisgarh (the projection stretches by well under 1 % within the state).
 */

const ORIGIN_LAT = 21.25;
const ORIGIN_LNG = 81.63;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);
const SQRT3 = Math.sqrt(3);

/** Area of one cell in km² for an edge in metres (3√3/2 · s²). */
export function zoneCellAreaKm2(edgeM: number): number {
  return ((3 * SQRT3) / 2) * (edgeM / 1000) ** 2;
}

function cubeRound(qf: number, rf: number): [number, number] {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // -0 would print as "0" anyway; normalise for stable ids.
  return [q + 0, r + 0];
}

/** The cell a point falls in. */
export function zoneCell(lat: number, lng: number, edgeM: number): string {
  const x = (lng - ORIGIN_LNG) * M_PER_DEG_LNG;
  const y = (lat - ORIGIN_LAT) * M_PER_DEG_LAT;
  const qf = ((SQRT3 / 3) * x - y / 3) / edgeM;
  const rf = ((2 / 3) * y) / edgeM;
  const [q, r] = cubeRound(qf, rf);
  return `hx:${String(q)}:${String(r)}`;
}

/** The centre of a cell as { lat, lng } (for the zone map; never a member's position). */
export function zoneCentre(cell: string, edgeM: number): { lat: number; lng: number } {
  const [q, r] = parseCell(cell);
  const x = edgeM * (SQRT3 * q + (SQRT3 / 2) * r);
  const y = edgeM * (1.5 * r);
  return { lat: ORIGIN_LAT + y / M_PER_DEG_LAT, lng: ORIGIN_LNG + x / M_PER_DEG_LNG };
}

const CELL = /^hx:(-?\d+):(-?\d+)$/;
function parseCell(cell: string): [number, number] {
  const m = CELL.exec(cell);
  if (!m) throw new Error(`not a zone cell: ${cell}`);
  return [Number(m[1]), Number(m[2])];
}

const DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** The six cells around one. */
export function zoneNeighbours(cell: string): string[] {
  const [q, r] = parseCell(cell);
  return DIRECTIONS.map(([dq, dr]) => `hx:${String(q + dq)}:${String(r + dr)}`);
}

export type BandedCount =
  { kind: 'few' } | { kind: 'band'; value: number } | { kind: 'exact'; value: number };

/**
 * What a member sees for a count (SR-31): under `hideBelow` "few mechanics nearby", from there to `exactFrom − 1` the
 * band "{hideBelow}+", from `exactFrom` the number (rounded to 5 when `round`). The floor 5 is locked: a lower
 * `hideBelow` is treated as 5, so a bad stored value can never reveal a small count.
 */
export function bandCount(
  n: number,
  rules: { hideBelow: number; exactFrom: number; round: boolean },
): BandedCount {
  const hideBelow = Math.max(5, rules.hideBelow);
  const exactFrom = Math.max(hideBelow + 1, rules.exactFrom);
  if (n < hideBelow) return { kind: 'few' };
  if (n < exactFrom) return { kind: 'band', value: hideBelow };
  return { kind: 'exact', value: rules.round && n > exactFrom ? Math.round(n / 5) * 5 : n };
}

/** Distance bands with locked edges 2 / 5 / 10 km (SR-29): never a number on the wire. */
export const DISTANCE_BANDS = ['lt2', '2to5', '5to10', '10plus'] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export function distanceBand(metres: number): DistanceBand {
  if (metres < 2000) return 'lt2';
  if (metres < 5000) return '2to5';
  if (metres < 10_000) return '5to10';
  return '10plus';
}
