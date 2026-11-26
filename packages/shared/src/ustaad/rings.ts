/**
 * Ring detection (spec 23 § 14 (a), SR-10, AT-VOUCH-1; plan task B5). Pure: the nightly `ustaad_ring_detect` job reads
 * the follow edges of the window, calls `detectRings()`, then sets `ustaad_follows.counted = false` on the returned
 * edges and writes one `ustaad_events` row per flagged member for the community manager's review card.
 *
 * Two signals: (1) reciprocal-burst share: of a member's new followers in the window, the share followed back within
 * 24 h is above `reciprocityPct` (only for members with ≥ `minFollowers` new followers); (2) a dense cluster: a
 * connected group of ≥ 3 members joined by mutual 24-hour bursts where ≥ 60 % of the possible pairs are bursts.
 */
export interface FollowEdge {
  followerId: string;
  followeeId: string;
  createdAt: Date;
}

export interface RingOptions {
  now: Date;
  windowDays: number;
  reciprocityPct: number;
  minFollowers: number;
}

export interface RingResult {
  flaggedMembers: string[];
  /** Edges (both directions of each burst touching a flagged member) to mark `counted = false`. */
  uncountedEdges: { followerId: string; followeeId: string }[];
}

/** Defaults the nightly job uses (spec § 14: "> 30 %"); the window is the 30-day counting window. */
export const RING_DEFAULTS = { windowDays: 30, reciprocityPct: 30, minFollowers: 5 } as const;

const DAY_MS = 86_400_000;
const BURST_MS = DAY_MS;
const CLUSTER_MIN = 3;
const CLUSTER_DENSITY = 0.6;

const pairKey = (a: string, b: string) => `${a}|${b}`;

function bursts(edges: readonly FollowEdge[]): Map<string, Set<string>> {
  const at = new Map<string, number>();
  for (const e of edges) at.set(pairKey(e.followerId, e.followeeId), e.createdAt.getTime());
  const out = new Map<string, Set<string>>();
  for (const e of edges) {
    const back = at.get(pairKey(e.followeeId, e.followerId));
    if (back === undefined || Math.abs(back - e.createdAt.getTime()) > BURST_MS) continue;
    let s = out.get(e.followeeId);
    if (!s) {
      s = new Set();
      out.set(e.followeeId, s);
    }
    s.add(e.followerId);
  }
  return out;
}

function denseClusters(burst: Map<string, Set<string>>): string[] {
  const flagged: string[] = [];
  const seen = new Set<string>();
  for (const start of burst.keys()) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    seen.add(start);
    for (let m = stack.pop(); m !== undefined; m = stack.pop()) {
      group.push(m);
      for (const n of burst.get(m) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
    }
    if (group.length < CLUSTER_MIN) continue;
    let ends = 0;
    for (const m of group) ends += burst.get(m)?.size ?? 0;
    const possible = (group.length * (group.length - 1)) / 2;
    if (ends / 2 / possible >= CLUSTER_DENSITY) flagged.push(...group);
  }
  return flagged;
}

export function detectRings(edges: readonly FollowEdge[], o: RingOptions): RingResult {
  const from = o.now.getTime() - o.windowDays * DAY_MS;
  const recent = edges.filter((e) => e.createdAt.getTime() >= from && e.followerId !== e.followeeId);
  const burst = bursts(recent);

  const flagged = new Set<string>();
  const newFollowers = new Map<string, number>();
  for (const e of recent) newFollowers.set(e.followeeId, (newFollowers.get(e.followeeId) ?? 0) + 1);
  for (const [member, n] of newFollowers) {
    const mutual = burst.get(member)?.size ?? 0;
    if (n >= o.minFollowers && (mutual * 100) / n > o.reciprocityPct) flagged.add(member);
  }
  for (const m of denseClusters(burst)) flagged.add(m);

  const out = new Map<string, { followerId: string; followeeId: string }>();
  for (const m of flagged)
    for (const n of burst.get(m) ?? []) {
      out.set(pairKey(m, n), { followerId: m, followeeId: n });
      out.set(pairKey(n, m), { followerId: n, followeeId: m });
    }
  return { flaggedMembers: [...flagged], uncountedEdges: [...out.values()] };
}
