/**
 * Ustaad identity jobs for the worker timer (spec 23 § 8 "Worker jobs", § 6.9, § 9.2–9.3; plan task B5). Each step is
 * idempotent (conditional UPDATEs, unique keys), so two workers running it at once are harmless; one member failing
 * never stops the rest. The repo has no pg-boss queue for these yet (the worker runs `setInterval` timers, like the
 * zone and job-expiry jobs), so "singleton" is the per-process busy flag plus idempotent SQL.
 *
 * - hourly: attestation expiry; qualified followers for members whose followers changed (follow events, D2 contract
 *   in `UstaadFollowChangeSource`; the cursor lives in memory, a restart just does the next nightly full pass).
 * - nightly: ring check (SR-10) → counter reconcile (drift logged) → 30-day counters → qualified followers for every
 *   active member → level recompute → badge awards → evidence purge (`verify.evidence_retention_days`).
 */
import {
  awardUstaadBadges,
  expireUstaadAttestations,
  purgeUstaadAttestationEvidence,
  recomputeUstaadLevel,
  reconcileUstaadCounters,
  refreshUstaadCounters30d,
  refreshUstaadQualifiedFollowers,
  runUstaadRingDetect,
  ustaadEventFollowSource,
  ustaadMembersForLevelJob,
  type Tx,
  type UstaadFollowChangeSource,
} from '@mechdost/db/repo';

type Db = Tx;
type Log = (level: 'info' | 'error', event: string, data: Record<string, unknown>) => void;

export interface UstaadHourlyState {
  followCursor: Date | null;
}

export interface UstaadJobReport {
  expired: number;
  qualifiedChanged: number;
}

/** Hourly part: attestation expiry and qualified followers for members whose followers changed since the cursor. */
export async function runUstaadHourly(
  db: Db,
  state: UstaadHourlyState,
  source: UstaadFollowChangeSource = ustaadEventFollowSource,
): Promise<UstaadJobReport> {
  const expired = await expireUstaadAttestations(db);
  const { memberIds, until } = await source.changedFollowees(db, state.followCursor, 1000);
  const qualifiedChanged =
    memberIds.length > 0 ? await db.transaction((tx) => refreshUstaadQualifiedFollowers(tx, memberIds)) : 0;
  state.followCursor = until;
  return { expired, qualifiedChanged };
}

export interface UstaadNightlyReport {
  ringsFlagged: number;
  drifted: number;
  rolling: number;
  qualifiedChanged: number;
  badges: number;
  purged: number;
  failed: number;
}

/** Nightly part, in order (each member in its own transaction). */
export async function runUstaadNightly(db: Db, log: Log): Promise<UstaadNightlyReport> {
  const rings = await runUstaadRingDetect(db);
  const { drifted } = await db.transaction((tx) => reconcileUstaadCounters(tx));
  if (drifted > 0) log('info', 'ustaad_counter_drift', { members: drifted });
  const rolling = await db.transaction((tx) => refreshUstaadCounters30d(tx));
  const ids = await ustaadMembersForLevelJob(db);
  let qualifiedChanged = 0;
  let badges = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      qualifiedChanged += await db.transaction((tx) => refreshUstaadQualifiedFollowers(tx, [id]));
      await db.transaction((tx) => recomputeUstaadLevel(tx, id));
      badges += (await db.transaction((tx) => awardUstaadBadges(tx, id))).length;
    } catch {
      failed += 1;
    }
  }
  const purged = await db.transaction((tx) => purgeUstaadAttestationEvidence(tx));
  return { ringsFlagged: rings.flagged, drifted, rolling, qualifiedChanged, badges, purged, failed };
}
