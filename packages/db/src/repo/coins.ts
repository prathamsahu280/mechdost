import { and, eq, gte, sql } from 'drizzle-orm';
import { auditLog, coinAccounts, coinLedger } from '../schema';
import { ConflictError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * MechDost Coins ledger (spec 20, decision 2026-11-01): a loyalty bonus, not a wallet. Every change is one
 * transaction: an append-only ledger row (unique idempotency key) + a compare-and-set balance update that can
 * never go below zero. Retrying any call with the same key is a no-op that returns the first result.
 */
export interface CoinEntry {
  id: string;
  delta: number;
  kind: string;
  balanceAfter: number;
}

type Kind = 'earn' | 'redeem' | 'restore' | 'expire' | 'adjust';

function wholePositive(n: number, what: string) {
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) {
    throw new ValidationError(`${what} must be a whole number from 1 to 1,000,000`, 'COINS_AMOUNT');
  }
}

async function balanceOf(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .select({ balance: coinAccounts.balance })
    .from(coinAccounts)
    .where(eq(coinAccounts.userId, userId))
    .limit(1);
  return rows[0]?.balance ?? 0;
}

async function apply(
  db: Tx,
  input: {
    userId: string;
    delta: number;
    kind: Kind;
    reason: string;
    idemKey: string;
    orderGroupId?: string | null;
    expiresAt?: Date | null;
    createdBy?: string | null;
  },
): Promise<CoinEntry> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(coinLedger)
      .values({
        userId: input.userId,
        delta: input.delta,
        kind: input.kind,
        reason: input.reason,
        idemKey: input.idemKey,
        orderGroupId: input.orderGroupId ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy ?? null,
      })
      .onConflictDoNothing({ target: coinLedger.idemKey })
      .returning({ id: coinLedger.id });

    if (!entry) {
      // Same idempotency key seen before: return the original entry, change nothing.
      const [prior] = await tx
        .select({
          id: coinLedger.id,
          delta: coinLedger.delta,
          kind: coinLedger.kind,
          userId: coinLedger.userId,
        })
        .from(coinLedger)
        .where(eq(coinLedger.idemKey, input.idemKey))
        .limit(1);
      if (prior?.userId !== input.userId) {
        throw new ConflictError('This idempotency key belongs to another coin event', 'COINS_IDEM_MISMATCH');
      }
      return {
        id: prior.id,
        delta: prior.delta,
        kind: prior.kind,
        balanceAfter: await balanceOf(tx, input.userId),
      };
    }

    if (input.delta > 0) {
      const [acct] = await tx
        .insert(coinAccounts)
        .values({
          userId: input.userId,
          balance: input.delta,
          lifetimeEarned: input.kind === 'earn' ? input.delta : 0,
        })
        .onConflictDoUpdate({
          target: coinAccounts.userId,
          set: {
            balance: sql`${coinAccounts.balance} + ${input.delta}`,
            lifetimeEarned:
              input.kind === 'earn'
                ? sql`${coinAccounts.lifetimeEarned} + ${input.delta}`
                : sql`${coinAccounts.lifetimeEarned}`,
            version: sql`${coinAccounts.version} + 1`,
          },
        })
        .returning({ balance: coinAccounts.balance });
      return { id: entry.id, delta: input.delta, kind: input.kind, balanceAfter: acct?.balance ?? 0 };
    }

    // Spending: compare-and-set, so two checkouts racing for the same coins cannot both succeed.
    const spend = -input.delta;
    const [acct] = await tx
      .update(coinAccounts)
      .set({ balance: sql`${coinAccounts.balance} - ${spend}`, version: sql`${coinAccounts.version} + 1` })
      .where(and(eq(coinAccounts.userId, input.userId), gte(coinAccounts.balance, spend)))
      .returning({ balance: coinAccounts.balance });
    if (!acct) throw new ConflictError('Not enough MechDost Coins', 'INSUFFICIENT_COINS');
    return { id: entry.id, delta: input.delta, kind: input.kind, balanceAfter: acct.balance };
  });
}

/** Coins earned under the earning rules (Q24); `expiresAt` from `coinExpiry`. */
export function earnCoins(
  db: Tx,
  input: {
    userId: string;
    coins: number;
    reason: string;
    idemKey: string;
    expiresAt: Date;
    orderGroupId?: string;
  },
) {
  wholePositive(input.coins, 'Coins');
  return apply(db, { ...input, delta: input.coins, kind: 'earn' });
}

/** Coins used as a discount on a checkout (inside the order-placement transaction). */
export function redeemCoins(
  db: Tx,
  input: { userId: string; coins: number; orderGroupId: string; idemKey: string },
) {
  wholePositive(input.coins, 'Coins');
  return apply(db, {
    ...input,
    delta: -input.coins,
    kind: 'redeem',
    reason: 'Used on order',
  });
}

/**
 * Coins given back when an order that used them is cancelled or rejected before fulfilment (never as money).
 * Restores exactly what that order redeemed, once.
 */
export async function restoreCoinsForOrder(db: Tx, input: { userId: string; orderGroupId: string }) {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${coinLedger.delta}), 0)::int` })
    .from(coinLedger)
    .where(
      and(
        eq(coinLedger.userId, input.userId),
        eq(coinLedger.orderGroupId, input.orderGroupId),
        sql`${coinLedger.kind} in ('redeem','restore')`,
      ),
    );
  const outstanding = -(rows[0]?.total ?? 0);
  if (outstanding <= 0) return null;
  return apply(db, {
    userId: input.userId,
    delta: outstanding,
    kind: 'restore',
    reason: 'Order cancelled: coins returned',
    orderGroupId: input.orderGroupId,
    idemKey: `restore:${input.orderGroupId}`,
  });
}

/** Manual grant or deduction by staff with `coins:adjust` (checked in the API); audited. */
export async function adjustCoins(
  db: Tx,
  input: { userId: string; delta: number; reason: string; idemKey: string; staffUserId: string },
) {
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 100_000) {
    throw new ValidationError(
      'Adjustment must be a whole number between -100,000 and 100,000',
      'COINS_AMOUNT',
    );
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) {
    throw new ValidationError('Give a reason (3 to 200 characters)', 'COINS_REASON');
  }
  const entry = await apply(db, {
    userId: input.userId,
    delta: input.delta,
    kind: 'adjust',
    reason,
    idemKey: input.idemKey,
    createdBy: input.staffUserId,
  });
  await db.insert(auditLog).values({
    actorUserId: input.staffUserId,
    actorRole: 'staff',
    action: 'coins.adjusted',
    entity: 'coin_ledger',
    entityId: entry.id,
    after: { delta: input.delta },
  });
  return entry;
}

export async function coinBalance(db: Tx, userId: string): Promise<number> {
  return balanceOf(db, userId);
}
