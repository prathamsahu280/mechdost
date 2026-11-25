/**
 * Izzat ledger and level engine hooks (spec 23 § 9.1–9.2). STUBS from workstream A with the final signatures
 * (plan "Interface stubs"): workstream B implements them in this file and in `levels.ts`. Callers in C, D and E call
 * them inside their own transaction from day one, so B's real versions slot in without touching those callers.
 */
import type { UstaadIzzatReason } from '@mechdost/shared/ustaad/codes';
import type { Tx } from '../orders';

export interface IzzatRecordInput {
  memberId: string;
  reason: UstaadIzzatReason;
  /** What earned it: `answer`, `question`, `follow`, `learning_resource`, `strike`, … */
  source: { type: string; id: string | null };
  /** Unique per earning event (e.g. `best:<answerId>`); a replay writes nothing. */
  idemKey: string;
  /** Only for `strike`, `reversal` and `correction`; other reasons take their points from the settings. */
  delta?: number;
}

/** Record Izzat for a member (idempotent). Returns the points written (0 when replayed or not earned). */
export async function recordIzzat(
  _tx: Tx,
  _actor: { userId: string | null },
  _input: IzzatRecordInput,
): Promise<number> {
  // Workstream B: insert into ustaad_izzat_ledger ON CONFLICT (idem_key) DO NOTHING and bump the counter.
  return Promise.resolve(0);
}
