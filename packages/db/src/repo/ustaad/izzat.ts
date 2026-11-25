/**
 * Izzat ledger (spec 23 § 9.1; plan task B5). Workstream A shipped the signature; workstream B made it real. Callers in
 * C, D and E call it inside their own transaction. Append-only ledger: one row per earning event (`idem_key` unique);
 * the counter moves only when a row was really inserted (no read-then-write). Izzat is never money and never Coins.
 */
import { eq, sql } from 'drizzle-orm';
import type { UstaadIzzatReason } from '@mechdost/shared/ustaad/codes';
import { IZZAT_SETTING_FOR, izzatPoints } from '@mechdost/shared/ustaad/izzat';
import { ustaadIzzatLedger, ustaadMemberCounters } from '../../schema';
import type { Tx } from '../orders';
import { readUstaadSettingValues } from './settings';

export interface IzzatRecordInput {
  memberId: string;
  reason: UstaadIzzatReason;
  /** What earned it: `answer`, `question`, `follow`, `learning_resource`, `strike`, … */
  source: { type: string; id: string | null };
  /** Unique per earning event (e.g. `best:<answerId>`); a replay writes nothing. */
  idemKey: string;
  /** Only for `strike`, `reversal` and `correction`; other reasons take their points from the settings. */
  delta?: number;
  /** Sponsored or MechDost-authored content earns nothing (locked). */
  sponsored?: boolean;
}

/** Record Izzat for a member (idempotent). Returns the points written (0 when replayed or not earned). */
export async function recordIzzat(
  tx: Tx,
  actor: { userId: string | null },
  input: IzzatRecordInput,
): Promise<number> {
  const key = IZZAT_SETTING_FOR[input.reason];
  const values = key ? await readUstaadSettingValues(tx, [key]) : {};
  const points = izzatPoints(input.reason, values, {
    ...(input.delta === undefined ? {} : { delta: input.delta }),
    ...(input.sponsored ? { sponsored: true } : {}),
  });
  if (points === 0) return 0;
  const [row] = await tx
    .insert(ustaadIzzatLedger)
    .values({
      memberId: input.memberId,
      delta: points,
      reasonCode: input.reason,
      sourceType: input.source.type,
      sourceId: input.source.id,
      idemKey: input.idemKey,
      actorId: actor.userId,
    })
    .onConflictDoNothing({ target: ustaadIzzatLedger.idemKey })
    .returning({ id: ustaadIzzatLedger.id });
  if (!row) return 0;
  await tx
    .update(ustaadMemberCounters)
    .set({ izzat: sql`${ustaadMemberCounters.izzat} + ${points}` })
    .where(eq(ustaadMemberCounters.memberId, input.memberId));
  return points;
}
