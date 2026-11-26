/**
 * Strikes (spec 23 § 6.7, § 13 "Actions"; plan task F2). A strike is written with the moderation action that caused
 * it and an Izzat `strike` row (B's ledger; idempotent on `strike:<id>`). An overturned appeal overturns the strikes
 * of that action and writes the `reversal` row. A `false_report` strike follows repeated dismissed "someone under
 * 18" reports from one member (§ 13 false-report guard).
 */
import { and, count, desc, eq, gt } from 'drizzle-orm';
import { ustaadReports, ustaadStrikes } from '../../schema';
import type { Tx } from '../orders';
import { recordIzzat } from './izzat';

export async function addUstaadStrike(
  tx: Tx,
  input: {
    memberId: string;
    reasonCode: string;
    izzatDelta: number;
    actionId: string | null;
    staffUserId: string | null;
    expiresAt?: Date | null;
  },
): Promise<string> {
  const [row] = await tx
    .insert(ustaadStrikes)
    .values({
      memberId: input.memberId,
      reasonCode: input.reasonCode,
      izzatDelta: input.izzatDelta,
      actionId: input.actionId,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: ustaadStrikes.id });
  if (!row) throw new Error('strike insert returned nothing');
  if (input.izzatDelta < 0)
    await recordIzzat(
      tx,
      { userId: input.staffUserId },
      {
        memberId: input.memberId,
        reason: 'strike',
        source: { type: 'strike', id: row.id },
        idemKey: `strike:${row.id}`,
        delta: input.izzatDelta,
      },
    );
  return row.id;
}

/** Overturn the active strikes written by one action (appeal overturned). Conditional on status; returns count. */
export async function overturnUstaadStrikes(
  tx: Tx,
  input: { actionIds: readonly string[]; staffUserId: string; appealTicketId: string | null },
): Promise<number> {
  let n = 0;
  for (const actionId of input.actionIds) {
    const rows = await tx
      .update(ustaadStrikes)
      .set({ status: 'overturned', appealTicketId: input.appealTicketId })
      .where(and(eq(ustaadStrikes.actionId, actionId), eq(ustaadStrikes.status, 'active')))
      .returning({ id: ustaadStrikes.id, memberId: ustaadStrikes.memberId, delta: ustaadStrikes.izzatDelta });
    for (const s of rows) {
      n += 1;
      if (s.delta < 0)
        await recordIzzat(
          tx,
          { userId: input.staffUserId },
          {
            memberId: s.memberId,
            reason: 'reversal',
            source: { type: 'strike', id: s.id },
            idemKey: `strike_reversal:${s.id}`,
            delta: -s.delta,
          },
        );
    }
  }
  return n;
}

export async function activeUstaadStrikes(tx: Tx, memberId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(ustaadStrikes)
    .where(and(eq(ustaadStrikes.memberId, memberId), eq(ustaadStrikes.status, 'active')));
  return row?.n ?? 0;
}

/** An upheld `false_report` strike: the member loses the immediate-restriction right for minor reports. */
export async function hasFalseReportStrike(tx: Tx, memberId: string): Promise<boolean> {
  const [row] = await tx
    .select({ n: count() })
    .from(ustaadStrikes)
    .where(
      and(
        eq(ustaadStrikes.memberId, memberId),
        eq(ustaadStrikes.reasonCode, 'false_report'),
        eq(ustaadStrikes.status, 'active'),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * After a minor report is dismissed: when the reporter now has `threshold` dismissed minor reports since their last
 * `false_report` strike (or ever), add one. Returns true when a strike was written.
 */
export async function maybeFalseReportStrike(
  tx: Tx,
  input: { reporterId: string; threshold: number; staffUserId: string },
): Promise<boolean> {
  const [last] = await tx
    .select({ at: ustaadStrikes.createdAt })
    .from(ustaadStrikes)
    .where(and(eq(ustaadStrikes.memberId, input.reporterId), eq(ustaadStrikes.reasonCode, 'false_report')))
    .orderBy(desc(ustaadStrikes.createdAt))
    .limit(1);
  const since = last?.at ?? new Date(0);
  const [row] = await tx
    .select({ n: count() })
    .from(ustaadReports)
    .where(
      and(
        eq(ustaadReports.reporterId, input.reporterId),
        eq(ustaadReports.reasonCode, 'minor'),
        eq(ustaadReports.status, 'dismissed'),
        gt(ustaadReports.decidedAt, since),
      ),
    );
  if ((row?.n ?? 0) < input.threshold) return false;
  await addUstaadStrike(tx, {
    memberId: input.reporterId,
    reasonCode: 'false_report',
    izzatDelta: 0,
    actionId: null,
    staffUserId: input.staffUserId,
  });
  return true;
}
