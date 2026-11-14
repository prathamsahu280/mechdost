import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  coinRedemption,
  expiredCoins,
  nextExpiry,
  orderRewardCoins,
  splitCoins,
  type CoinAdjustReason,
  type CoinLedgerKind,
  type CoinReasonCode,
  type CoinRewardCancelReason,
  type CoinRewardSource,
  type CoinRules,
  type ShopPayoutEntryKind,
} from '@mechdost/shared/coins';
import { OPERATIONAL_SETTINGS, type SettingKey } from '@mechdost/shared/settings';
import {
  auditLog,
  coinAccounts,
  coinLedger,
  coinRewards,
  orderGroups,
  orders,
  serviceBills,
  serviceRequests,
  settings,
  shopPayoutEntries,
  shops,
  userRoles,
  users,
} from '../schema';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * MechDost Coins ledger (spec 20, decision 2026-11-01): a loyalty bonus, not a wallet. Every change is one
 * transaction: an append-only ledger row (unique idempotency key) + a compare-and-set balance update that can
 * never go below zero. Retrying any call with the same key is a no-op that returns the first result.
 *
 * Earning (Q24, user 2026-11-13): a delivered order or a paid workshop booking creates a pending `coin_rewards` row;
 * the worker credits it after `coins.unlock_days`. Coins added carry an expiry (`coins.expiry_days`); the worker
 * expires what is left of lapsed lots (first-expiring used first, `@mechdost/shared/coins`).
 */
export interface CoinEntry {
  id: string;
  delta: number;
  kind: string;
  balanceAfter: number;
}

type Kind = CoinLedgerKind;

// ── Rules (admin settings, hard rule 8) ─────────────────────────────────────────────────────────────────────────

export interface CoinSettings extends CoinRules {
  earnOrderBp: number;
  firstOrderBonus: number;
  workshopBookingBonus: number;
  /** Anti-abuse for self-attested workshop payments (security review 2026-11-14). */
  workshopRewardMinBillPaise: number;
  workshopRewardCooldownDays: number;
  /** Most coins staff may change for one customer per IST day. */
  adjustDailyCap: number;
  unlockDays: number;
}

const COIN_KEYS = {
  coinValuePaise: 'coins.value_paise',
  maxRedeemBp: 'coins.max_redeem_bp',
  minOrderPaise: 'coins.min_order_paise',
  expiryDays: 'coins.expiry_days',
  earnOrderBp: 'coins.earn_order_bp',
  firstOrderBonus: 'coins.first_order_bonus',
  workshopBookingBonus: 'coins.workshop_booking_bonus',
  workshopRewardMinBillPaise: 'coins.workshop_reward_min_bill_paise',
  workshopRewardCooldownDays: 'coins.workshop_reward_cooldown_days',
  adjustDailyCap: 'coins.adjust_daily_cap',
  unlockDays: 'coins.unlock_days',
} as const satisfies Record<keyof CoinSettings, SettingKey>;

/** The coin rules in force: the admin's global values, else the registry defaults (coins are site-wide). */
export async function coinSettings(db: Tx): Promise<CoinSettings> {
  const keys = Object.values(COIN_KEYS);
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(inArray(settings.key, keys), isNull(settings.cityId)));
  const read = (key: SettingKey): number => {
    const spec = OPERATIONAL_SETTINGS[key];
    const fallback = spec.kind === 'int' && typeof spec.default === 'number' ? spec.default : 0;
    const v = rows.find((r) => r.key === key)?.value;
    return spec.kind === 'int' &&
      typeof v === 'number' &&
      Number.isSafeInteger(v) &&
      v >= spec.min &&
      v <= spec.max
      ? v
      : fallback;
  };
  return {
    coinValuePaise: read(COIN_KEYS.coinValuePaise),
    maxRedeemBp: read(COIN_KEYS.maxRedeemBp),
    minOrderPaise: read(COIN_KEYS.minOrderPaise),
    expiryDays: read(COIN_KEYS.expiryDays),
    earnOrderBp: read(COIN_KEYS.earnOrderBp),
    firstOrderBonus: read(COIN_KEYS.firstOrderBonus),
    workshopBookingBonus: read(COIN_KEYS.workshopBookingBonus),
    workshopRewardMinBillPaise: read(COIN_KEYS.workshopRewardMinBillPaise),
    workshopRewardCooldownDays: read(COIN_KEYS.workshopRewardCooldownDays),
    adjustDailyCap: read(COIN_KEYS.adjustDailyCap),
    unlockDays: read(COIN_KEYS.unlockDays),
  };
}

/** Expiry for coins added now (database clock). */
const expiryFrom = (days: number) => sql`now() + make_interval(days => ${days})`;

// ── The ledger primitive ────────────────────────────────────────────────────────────────────────────────────────

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
    reasonCode?: CoinReasonCode | null;
    idemKey: string;
    orderGroupId?: string | null;
    /** A Date, or a database expression (`expiryFrom`). */
    expiresAt?: Date | ReturnType<typeof sql> | null;
    createdBy?: string | null;
    /** Staff action to audit atomically with the ledger row (manual adjustments). */
    audit?: { actorUserId: string; action: string; after?: Record<string, unknown> };
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
        reasonCode: input.reasonCode ?? null,
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
      if (prior?.userId !== input.userId || prior.delta !== input.delta || prior.kind !== input.kind) {
        throw new ConflictError('This idempotency key belongs to another coin event', 'COINS_IDEM_MISMATCH');
      }
      return {
        id: prior.id,
        delta: prior.delta,
        kind: prior.kind,
        balanceAfter: await balanceOf(tx, input.userId),
      };
    }

    let balanceAfter: number;
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
          },
        })
        .returning({ balance: coinAccounts.balance });
      balanceAfter = acct?.balance ?? 0;
    } else {
      // Spending: compare-and-set, so two checkouts racing for the same coins cannot both succeed.
      const spend = -input.delta;
      const [acct] = await tx
        .update(coinAccounts)
        .set({ balance: sql`${coinAccounts.balance} - ${spend}` })
        .where(and(eq(coinAccounts.userId, input.userId), gte(coinAccounts.balance, spend)))
        .returning({ balance: coinAccounts.balance });
      if (!acct) throw new ConflictError('Not enough MechDost Coins', 'INSUFFICIENT_COINS');
      balanceAfter = acct.balance;
    }

    // Audit in the same transaction, only for a newly written entry (an idempotent replay returned above), so the
    // ledger and the audit log can never disagree and a retried request is audited once.
    if (input.audit) {
      await tx.insert(auditLog).values({
        actorUserId: input.audit.actorUserId,
        actorRole: 'staff',
        action: input.audit.action,
        entity: 'coin_ledger',
        entityId: entry.id,
        after: { delta: input.delta, kind: input.kind, ...input.audit.after },
      });
    }
    return { id: entry.id, delta: input.delta, kind: input.kind, balanceAfter };
  });
}

/** Coins earned outside the reward rules (tests, seeds); `expiresAt` from `coinExpiry`. */
export function earnCoins(
  db: Tx,
  input: {
    userId: string;
    coins: number;
    reason: string;
    idemKey: string;
    expiresAt: Date;
    orderGroupId?: string;
    reasonCode?: CoinRewardSource;
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
    reasonCode: 'order_redeem',
  });
}

// ── Checkout ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckoutCoins {
  coins: number;
  coinValuePaise: number;
  discountPaise: number;
  /** Coins per sub-order (same order as the quote's groups). */
  perGroup: number[];
}

/**
 * The coins a checkout may use (inside the placing transaction): the customer asks for `requested`; it must be
 * within the cap (`coinRedemption`: balance, `coins.max_redeem_bp` of the products, minimum order) or the order is
 * refused with COINS_CHANGED (the screen shows the new number). The ledger's compare-and-set at `redeemCoins` is
 * the final guard against a parallel spend.
 */
export async function checkoutCoins(
  tx: Tx,
  input: { userId: string; requested: number; subtotalPaise: number; groupSubtotals: readonly number[] },
): Promise<CheckoutCoins> {
  const rules = await coinSettings(tx);
  if (input.requested === 0)
    return {
      coins: 0,
      coinValuePaise: rules.coinValuePaise,
      discountPaise: 0,
      perGroup: input.groupSubtotals.map(() => 0),
    };
  if (!Number.isInteger(input.requested) || input.requested < 0)
    throw new ValidationError('Coins must be a whole number', 'COINS_AMOUNT');
  const allowed = coinRedemption(
    await balanceOf(tx, input.userId),
    input.subtotalPaise,
    rules,
    input.requested,
  );
  if (allowed.coins !== input.requested)
    throw new ConflictError('Your MechDost Coins changed; please review', 'COINS_CHANGED');
  return {
    coins: allowed.coins,
    coinValuePaise: rules.coinValuePaise,
    discountPaise: allowed.discountPaise,
    perGroup: splitCoins(allowed.coins, rules.coinValuePaise, input.groupSubtotals),
  };
}

// ── Restore on cancel / reject ──────────────────────────────────────────────────────────────────────────────────

async function outstandingFor(tx: Tx, userId: string, orderGroupId: string): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${coinLedger.delta}), 0)::int` })
    .from(coinLedger)
    .where(
      and(
        eq(coinLedger.userId, userId),
        eq(coinLedger.orderGroupId, orderGroupId),
        sql`${coinLedger.kind} in ('redeem','restore')`,
      ),
    );
  return -(rows[0]?.total ?? 0);
}

/**
 * A sub-order was cancelled or rejected (`transitionOrder`, same transaction): its share of the checkout's coins
 * comes back as coins, once (`restore:<order id>`), never more than the group still has outstanding. The returned
 * coins get a fresh expiry, so a customer never loses them to a lot that lapsed while the order was open.
 */
export async function restoreCoinsForSubOrder(tx: Tx, orderId: string): Promise<CoinEntry | null> {
  const [o] = await tx
    .select({
      userId: orders.userId,
      groupId: orders.groupId,
      cityId: orders.cityId,
      code: orders.code,
      coins: orders.coinsRedeemed,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o || o.coins <= 0) return null;
  const coins = Math.min(o.coins, await outstandingFor(tx, o.userId, o.groupId));
  if (coins <= 0) return null;
  const rules = await coinSettings(tx);
  const entry = await apply(tx, {
    userId: o.userId,
    delta: coins,
    kind: 'restore',
    reason: 'Order cancelled: coins returned',
    reasonCode: 'order_cancelled',
    orderGroupId: o.groupId,
    idemKey: `restore:${orderId}`,
    expiresAt: expiryFrom(rules.expiryDays),
  });
  await recordServerEvent(tx, 'coins_restored', {
    userId: o.userId,
    cityId: o.cityId,
    props: { orderCode: o.code, coins },
  });
  return entry;
}

// ── Rewards (earning, Q24) ──────────────────────────────────────────────────────────────────────────────────────

async function insertReward(
  tx: Tx,
  input: {
    userId: string;
    cityId: string;
    source: CoinRewardSource;
    coins: number;
    unlockDays: number;
    orderId?: string;
    serviceRequestId?: string;
  },
): Promise<boolean> {
  if (input.coins <= 0) return false;
  const [row] = await tx
    .insert(coinRewards)
    .values({
      userId: input.userId,
      source: input.source,
      coins: Math.min(input.coins, 1_000_000),
      availableAt: sql`now() + make_interval(days => ${input.unlockDays})`,
      orderId: input.orderId ?? null,
      serviceRequestId: input.serviceRequestId ?? null,
    })
    // One reward per source event, one first-order bonus per customer (unique indexes): a replay adds nothing.
    .onConflictDoNothing()
    .returning({ id: coinRewards.id });
  if (!row) return false;
  await recordServerEvent(tx, 'coins_reward_created', {
    userId: input.userId,
    cityId: input.cityId,
    props: { rewardId: row.id, source: input.source, coins: input.coins, unlockDays: input.unlockDays },
  });
  return true;
}

/**
 * A sub-order was delivered (`transitionOrder`, same transaction): `coins.earn_order_bp` of what its products cost
 * after discounts, plus `coins.first_order_bonus` on the customer's first delivered order — both pending until
 * `coins.unlock_days` have passed (after the 7-day claim window, Q25). Nothing while the admin has set no reward.
 */
export async function createOrderRewards(tx: Tx, orderId: string): Promise<void> {
  const rules = await coinSettings(tx);
  if (rules.earnOrderBp === 0 && rules.firstOrderBonus === 0) return;
  const [o] = await tx
    .select({
      userId: orders.userId,
      cityId: orders.cityId,
      subtotal: orders.subtotalPaise,
      discount: orders.discountPaise,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o) return;
  await insertReward(tx, {
    userId: o.userId,
    cityId: o.cityId,
    source: 'order',
    coins: orderRewardCoins(o.subtotal - o.discount, rules.earnOrderBp, rules.coinValuePaise),
    unlockDays: rules.unlockDays,
    orderId,
  });
  await insertReward(tx, {
    userId: o.userId,
    cityId: o.cityId,
    source: 'first_order',
    coins: rules.firstOrderBonus,
    unlockDays: rules.unlockDays,
    orderId,
  });
}

/**
 * A workshop booking was paid (`transitionRequest` -> paid, same transaction): `coins.workshop_booking_bonus`.
 * "Paid at the workshop" is the workshop's own word, so a colluding workshop and customer could farm coins with fake
 * bookings (security review 2026-11-14). Guards: no reward below `coins.workshop_reward_min_bill_paise`; at most one
 * reward per customer per workshop in `coins.workshop_reward_cooldown_days` (pending and credited rewards count;
 * checked under a per customer + workshop lock, so two bookings paid at once cannot both pass); the reward stays
 * pending for the unlock days and is cancelled if the payment is undone (`cancelPendingServiceRewards`).
 */
export async function createServiceReward(
  tx: Tx,
  input: { requestId: string; userId: string; cityId: string; workshopId: string | null },
): Promise<void> {
  const rules = await coinSettings(tx);
  if (rules.workshopBookingBonus === 0 || !input.workshopId) return;
  const [bill] = await tx
    .select({ total: serviceBills.totalPaise })
    .from(serviceBills)
    .where(eq(serviceBills.requestId, input.requestId))
    .limit(1);
  if (!bill || bill.total < rules.workshopRewardMinBillPaise) return;
  // Self-booking (code review 2026-11-14): someone who works at the workshop earns nothing there.
  const [staffOf] = await tx
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.userId, input.userId), eq(userRoles.workshopId, input.workshopId)))
    .limit(1);
  if (staffOf) return;
  if (rules.workshopRewardCooldownDays > 0) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`coins-workshop:${input.userId}:${input.workshopId}`}, 0))`,
    );
    const recent = await tx
      .select({ id: coinRewards.id })
      .from(coinRewards)
      .innerJoin(serviceRequests, eq(serviceRequests.id, coinRewards.serviceRequestId))
      .where(
        and(
          eq(coinRewards.userId, input.userId),
          eq(coinRewards.source, 'workshop_booking'),
          eq(serviceRequests.workshopId, input.workshopId),
          inArray(coinRewards.status, ['pending', 'credited']),
          sql`${coinRewards.createdAt} > now() - make_interval(days => ${rules.workshopRewardCooldownDays})`,
        ),
      )
      .limit(1);
    if (recent.length > 0) return;
  }
  await insertReward(tx, {
    userId: input.userId,
    cityId: input.cityId,
    source: 'workshop_booking',
    coins: rules.workshopBookingBonus,
    unlockDays: rules.unlockDays,
    serviceRequestId: input.requestId,
  });
}

/**
 * Cancel a service request's booking reward that has not unlocked yet. Called when a request leaves paid/completed
 * by any later move (none exists in the state machine today) and, once support requests can name a service request,
 * when one about it is opened in the unlock window. Returns how many were cancelled.
 */
export async function cancelPendingServiceRewards(
  tx: Tx,
  input: { serviceRequestId: string; reasonCode: CoinRewardCancelReason },
): Promise<number> {
  const rows = await tx
    .update(coinRewards)
    .set({ status: 'cancelled', cancelReasonCode: input.reasonCode })
    .where(and(eq(coinRewards.serviceRequestId, input.serviceRequestId), eq(coinRewards.status, 'pending')))
    .returning({ id: coinRewards.id });
  return rows.length;
}

/**
 * Cancel an order's rewards that have not unlocked yet (a refund after delivery, spec 05). Credited rewards stay:
 * the unlock wait outlasts the claim window, so a refund normally arrives first. Returns how many were cancelled.
 */
export async function cancelPendingOrderRewards(
  tx: Tx,
  input: { orderId: string; reasonCode: CoinRewardCancelReason },
): Promise<number> {
  const rows = await tx
    .update(coinRewards)
    .set({ status: 'cancelled', cancelReasonCode: input.reasonCode })
    .where(and(eq(coinRewards.orderId, input.orderId), eq(coinRewards.status, 'pending')))
    .returning({ id: coinRewards.id });
  return rows.length;
}

/**
 * A sub-order was delivered (`transitionOrder`, same transaction): the coin discount the shop did not collect is
 * owed to it by MechDost (user 2026-11-14: "show line + payout ledger"). One append-only row per order
 * (`coin_discount:<order id>`); nothing for parts without coins or without a shop.
 */
export async function recordShopCoinDiscount(tx: Tx, orderId: string): Promise<void> {
  const [o] = await tx
    .select({ shopId: orders.shopId, coinDiscountPaise: orders.coinDiscountPaise })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o?.shopId || o.coinDiscountPaise <= 0) return;
  await tx
    .insert(shopPayoutEntries)
    .values({
      shopId: o.shopId,
      orderId,
      kind: 'coin_discount',
      amountPaise: o.coinDiscountPaise,
      idemKey: `coin_discount:${orderId}`,
    })
    .onConflictDoNothing({ target: shopPayoutEntries.idemKey });
}

export interface ShopPayoutEntryView {
  id: string;
  shopId: string;
  shopName: string;
  orderCode: string | null;
  kind: ShopPayoutEntryKind;
  amountPaise: number;
  createdAt: Date;
}

/**
 * Finance report (`payouts:read`): what MechDost owes shops, newest first, optionally for one shop (keyset cursor),
 * with the total of the page's shop filter.
 */
export async function listShopPayoutEntries(
  db: Tx,
  input: { shopId?: string | null; cursor?: string | null; limit?: number },
): Promise<{ entries: ShopPayoutEntryView[]; nextCursor: string | null; totalPaise: number }> {
  const limit = pageSize(input.limit, 50, 100);
  const after = input.cursor ? decodeCursor(input.cursor, 'timestamp') : null;
  const scope = input.shopId ? eq(shopPayoutEntries.shopId, input.shopId) : undefined;
  const rows = await db
    .select({
      id: shopPayoutEntries.id,
      shopId: shopPayoutEntries.shopId,
      shopName: shops.name,
      orderCode: orders.code,
      kind: shopPayoutEntries.kind,
      amountPaise: shopPayoutEntries.amountPaise,
      createdAt: shopPayoutEntries.createdAt,
      sortKey: sql<string>`${shopPayoutEntries.createdAt}::text`,
    })
    .from(shopPayoutEntries)
    .innerJoin(shops, eq(shops.id, shopPayoutEntries.shopId))
    .leftJoin(orders, eq(orders.id, shopPayoutEntries.orderId))
    .where(
      and(
        scope,
        after
          ? sql`(${shopPayoutEntries.createdAt}, ${shopPayoutEntries.id}) < (cast(${after.k} as timestamptz), cast(${after.id} as uuid))`
          : undefined,
      ),
    )
    .orderBy(desc(shopPayoutEntries.createdAt), desc(shopPayoutEntries.id))
    .limit(limit + 1);
  const [sum] = await db
    .select({ total: sql<string>`coalesce(sum(${shopPayoutEntries.amountPaise}), 0)::text` })
    .from(shopPayoutEntries)
    .where(scope);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    entries: page.map(({ sortKey: _k, ...r }) => ({ ...r, kind: r.kind as ShopPayoutEntryKind })),
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.sortKey, id: last.id }) : null,
    totalPaise: Number(sum?.total ?? '0'),
  };
}

const REWARD_REASON: Record<CoinRewardSource, string> = {
  order: 'Earned on a delivered order',
  first_order: 'First order bonus',
  workshop_booking: 'Earned on a workshop booking',
};

/**
 * Worker job: credit rewards whose wait is over. One transaction per reward; the row is locked (`skip locked`, so
 * several workers share the work) and moved pending → credited with the ledger row (`reward:<id>`, idempotent).
 */
export async function releaseDueCoinRewards(
  db: Tx,
  opts: { limit?: number } = {},
): Promise<{ credited: number; failed: { rewardId: string; error: unknown }[] }> {
  const due = await db
    .select({ id: coinRewards.id })
    .from(coinRewards)
    .where(and(eq(coinRewards.status, 'pending'), sql`${coinRewards.availableAt} <= now()`))
    .orderBy(coinRewards.availableAt)
    .limit(opts.limit ?? 200);
  let credited = 0;
  const failed: { rewardId: string; error: unknown }[] = [];
  for (const { id } of due) {
    try {
      const done = await db.transaction(async (tx) => {
        const [r] = await tx
          .select()
          .from(coinRewards)
          .where(and(eq(coinRewards.id, id), eq(coinRewards.status, 'pending')))
          .for('update', { skipLocked: true });
        if (!r) return false;
        const source = r.source as CoinRewardSource;
        const [group] = r.orderId
          ? await tx
              .select({ groupId: orders.groupId, cityId: orders.cityId })
              .from(orders)
              .where(eq(orders.id, r.orderId))
          : [];
        const rules = await coinSettings(tx);
        const entry = await apply(tx, {
          userId: r.userId,
          delta: r.coins,
          kind: 'earn',
          reason: REWARD_REASON[source],
          reasonCode: source,
          idemKey: `reward:${r.id}`,
          orderGroupId: group?.groupId ?? null,
          expiresAt: expiryFrom(rules.expiryDays),
        });
        const [moved] = await tx
          .update(coinRewards)
          .set({ status: 'credited', ledgerId: entry.id })
          .where(
            and(
              eq(coinRewards.id, r.id),
              eq(coinRewards.status, 'pending'),
              eq(coinRewards.version, r.version),
            ),
          )
          .returning({ id: coinRewards.id });
        if (!moved) throw new ConflictError('Reward changed meanwhile', 'STALE_REWARD');
        await recordServerEvent(tx, 'coins_earned', {
          userId: r.userId,
          cityId: group?.cityId ?? null,
          props: { rewardId: r.id, source, coins: r.coins },
        });
        return true;
      });
      if (done) credited += 1;
    } catch (error) {
      failed.push({ rewardId: id, error });
    }
  }
  return { credited, failed };
}

// ── Expiry ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** How far back the expiry job looks for lapsed lots (it runs hourly; this covers a long worker outage). */
const EXPIRY_LOOKBACK_DAYS = 30;

/**
 * Worker job: expire what is left of coin lots that lapsed (first-expiring used first). One transaction per customer
 * with the account row locked, so a checkout spending at the same moment waits; the key `expire:<last lot>:<used>`
 * names the exact ledger state, so a rerun or a second worker adds nothing.
 */
export async function expireDueCoins(
  db: Tx,
  /** `limit`: candidates per page; every page is processed in one run (code review 2026-11-14: no starvation). */
  opts: { limit?: number } = {},
): Promise<{ expired: number; failed: { userId: string; error: unknown }[] }> {
  const pageSize = opts.limit ?? 500;
  let expired = 0;
  const failed: { userId: string; error: unknown }[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await db
      .selectDistinct({ userId: coinLedger.userId })
      .from(coinLedger)
      .innerJoin(coinAccounts, eq(coinAccounts.userId, coinLedger.userId))
      .where(
        and(
          sql`${coinLedger.expiresAt} is not null and ${coinLedger.delta} > 0`,
          sql`${coinLedger.expiresAt} <= now()`,
          sql`${coinLedger.expiresAt} > now() - make_interval(days => ${EXPIRY_LOOKBACK_DAYS})`,
          sql`${coinAccounts.balance} > 0`,
          after ? sql`${coinLedger.userId} > ${after}` : undefined,
        ),
      )
      .orderBy(coinLedger.userId)
      .limit(pageSize);
    const res = await expirePage(
      db,
      page.map((r) => r.userId),
    );
    expired += res.expired;
    failed.push(...res.failed);
    const last = page.at(-1);
    if (page.length < pageSize || !last) break;
    after = last.userId;
  }
  return { expired, failed };
}

async function expirePage(
  db: Tx,
  candidates: readonly string[],
): Promise<{ expired: number; failed: { userId: string; error: unknown }[] }> {
  let expired = 0;
  const failed: { userId: string; error: unknown }[] = [];
  for (const userId of candidates) {
    try {
      const done = await db.transaction(async (tx) => {
        const [acct] = await tx
          .select({ balance: coinAccounts.balance })
          .from(coinAccounts)
          .where(eq(coinAccounts.userId, userId))
          .for('update');
        if (!acct || acct.balance <= 0) return false;
        const entries = await ledgerLots(tx, userId);
        const due = expiredCoins(entries, new Date());
        const coins = Math.min(due.coins, acct.balance);
        if (coins <= 0 || !due.lastLotId) return false;
        const used = entries.filter((e) => e.delta < 0).reduce((a, e) => a - e.delta, 0);
        await apply(tx, {
          userId,
          delta: -coins,
          kind: 'expire',
          reason: 'Coins expired',
          reasonCode: 'expired',
          idemKey: `expire:${due.lastLotId}:${String(used)}`,
        });
        await recordServerEvent(tx, 'coins_expired', { userId, props: { coins } });
        return true;
      });
      if (done) expired += 1;
    } catch (error) {
      failed.push({ userId, error });
    }
  }
  return { expired, failed };
}

async function ledgerLots(tx: Tx, userId: string) {
  const rows = await tx
    .select({
      id: coinLedger.id,
      delta: coinLedger.delta,
      kind: coinLedger.kind,
      expiresAt: coinLedger.expiresAt,
    })
    .from(coinLedger)
    .where(eq(coinLedger.userId, userId));
  return rows.map((r) => ({ ...r, kind: r.kind as Kind }));
}

// ── Staff adjustments ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Manual grant or deduction by staff with `coins:adjust` (super admin only, user 2026-11-14; checked in the API): a reason code (hard rule 16), an
 * optional note shown to the customer, audited. `expectedVersion` is the account version the screen showed (null =
 * no account yet): a change made meanwhile is STALE_COINS. A retry with the same key returns the first entry.
 */
export async function adjustCoins(
  db: Tx,
  input: {
    userId: string;
    delta: number;
    reasonCode: CoinAdjustReason;
    note?: string | null;
    idemKey: string;
    staffUserId: string;
    expectedVersion?: number | null;
  },
) {
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 100_000) {
    throw new ValidationError(
      'Adjustment must be a whole number between -100,000 and 100,000',
      'COINS_AMOUNT',
    );
  }
  const note = input.note?.trim() ?? '';
  if (note.length > 200 || (note.length > 0 && note.length < 3)) {
    throw new ValidationError('A note is 3 to 200 characters', 'COINS_REASON');
  }
  // Never to the staff member's own account (code review 2026-11-14).
  if (input.userId === input.staffUserId)
    throw new ForbiddenError('Staff cannot change their own coins', 'COINS_SELF');
  return db.transaction(async (tx) => {
    const [customer] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId));
    if (!customer) throw new NotFoundError('Customer not found');
    // One staff change per customer at a time (the account row may not exist yet): the daily cap below is
    // read and written under this lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`coins-adjust:${input.userId}`}, 0))`,
    );
    const [replay] = await tx
      .select({ id: coinLedger.id })
      .from(coinLedger)
      .where(eq(coinLedger.idemKey, input.idemKey));
    if (!replay && input.expectedVersion !== undefined) {
      const [acct] = await tx
        .select({ version: coinAccounts.version })
        .from(coinAccounts)
        .where(eq(coinAccounts.userId, input.userId))
        .for('update');
      if ((acct?.version ?? null) !== input.expectedVersion)
        throw new ConflictError('The coin balance changed meanwhile; reload and try again', 'STALE_COINS');
    }
    const rules = await coinSettings(tx);
    if (!replay) {
      // Daily cap: grants and deductions together, per customer, per IST day (user ruling 2026-11-14).
      const [today] = await tx
        .select({ total: sql<number>`coalesce(sum(abs(${coinLedger.delta})), 0)::int` })
        .from(coinLedger)
        .where(
          and(
            eq(coinLedger.userId, input.userId),
            eq(coinLedger.kind, 'adjust'),
            sql`${coinLedger.createdAt} >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`,
          ),
        );
      if ((today?.total ?? 0) + Math.abs(input.delta) > rules.adjustDailyCap)
        throw new ValidationError(
          `At most ${String(rules.adjustDailyCap)} coins can be changed for one customer in a day`,
          'COINS_DAILY_CAP',
        );
    }
    const entry = await apply(tx, {
      userId: input.userId,
      delta: input.delta,
      kind: 'adjust',
      reason: note.length >= 3 ? note : `Staff: ${input.reasonCode}`,
      reasonCode: input.reasonCode,
      idemKey: input.idemKey,
      createdBy: input.staffUserId,
      expiresAt: input.delta > 0 ? expiryFrom(rules.expiryDays) : null,
      audit: {
        actorUserId: input.staffUserId,
        action: 'coins.adjusted',
        after: { reasonCode: input.reasonCode, customerId: input.userId },
      },
    });
    if (!replay)
      await recordServerEvent(tx, 'coins_adjusted', {
        userId: input.staffUserId,
        props: { customerId: input.userId, delta: input.delta, reasonCode: input.reasonCode },
      });
    return entry;
  });
}

export async function coinBalance(db: Tx, userId: string): Promise<number> {
  return balanceOf(db, userId);
}

// ── Reads (customer: own only; staff: coins:read) ───────────────────────────────────────────────────────────────

export interface CoinLedgerView {
  id: string;
  delta: number;
  kind: Kind;
  reasonCode: string | null;
  /** The staff note on an adjustment (shown to the customer); null otherwise. */
  note: string | null;
  orderCode: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface PendingRewardView {
  id: string;
  source: CoinRewardSource;
  coins: number;
  availableAt: Date;
  orderCode: string | null;
}

const LEDGER_VIEW = {
  id: coinLedger.id,
  delta: coinLedger.delta,
  kind: coinLedger.kind,
  reasonCode: coinLedger.reasonCode,
  reason: coinLedger.reason,
  orderCode: orderGroups.code,
  createdAt: coinLedger.createdAt,
  expiresAt: coinLedger.expiresAt,
  userId: coinLedger.userId,
  createdBy: coinLedger.createdBy,
  sortKey: sql<string>`${coinLedger.createdAt}::text`,
};

interface LedgerRow {
  id: string;
  delta: number;
  kind: string;
  reasonCode: string | null;
  reason: string;
  orderCode: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

const toView = (r: LedgerRow): CoinLedgerView => ({
  id: r.id,
  delta: r.delta,
  kind: r.kind as Kind,
  reasonCode: r.reasonCode,
  // Only a staff adjustment carries a note written for the customer; system rows are described by their code.
  note: r.kind === 'adjust' && !r.reason.startsWith('Staff: ') ? r.reason : null,
  orderCode: r.orderCode,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
});

async function ledgerPage(
  db: Tx,
  where: ReturnType<typeof eq> | undefined,
  page: { limit?: number; cursor?: string | null },
) {
  const limit = pageSize(page.limit, 20, 50);
  const after = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const rows = await db
    .select(LEDGER_VIEW)
    .from(coinLedger)
    .leftJoin(orderGroups, eq(orderGroups.id, coinLedger.orderGroupId))
    .where(
      and(
        where,
        after
          ? sql`(${coinLedger.createdAt}, ${coinLedger.id}) < (cast(${after.k} as timestamptz), cast(${after.id} as uuid))`
          : undefined,
      ),
    )
    .orderBy(desc(coinLedger.createdAt), desc(coinLedger.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.sortKey, id: last.id }) : null,
  };
}

async function pendingRewards(db: Tx, userId: string): Promise<PendingRewardView[]> {
  const rows = await db
    .select({
      id: coinRewards.id,
      source: coinRewards.source,
      coins: coinRewards.coins,
      availableAt: coinRewards.availableAt,
      orderCode: orders.code,
    })
    .from(coinRewards)
    .leftJoin(orders, eq(orders.id, coinRewards.orderId))
    .where(and(eq(coinRewards.userId, userId), eq(coinRewards.status, 'pending')))
    .orderBy(coinRewards.availableAt)
    .limit(50);
  return rows.map((r) => ({ ...r, source: r.source as CoinRewardSource }));
}

export interface MyCoins {
  balance: number;
  lifetimeEarned: number;
  pendingCoins: number;
  pending: PendingRewardView[];
  nextExpiry: { coins: number; at: Date } | null;
  rules: CoinSettings;
}

/** The signed-in customer's own coins: balance, coins on the way, the next expiry and the rules in force. */
export async function myCoins(db: Tx, userId: string): Promise<MyCoins> {
  const [acct] = await db
    .select({ balance: coinAccounts.balance, lifetimeEarned: coinAccounts.lifetimeEarned })
    .from(coinAccounts)
    .where(eq(coinAccounts.userId, userId));
  const pending = await pendingRewards(db, userId);
  const lots = acct && acct.balance > 0 ? await ledgerLots(db, userId) : [];
  return {
    balance: acct?.balance ?? 0,
    lifetimeEarned: acct?.lifetimeEarned ?? 0,
    pendingCoins: pending.reduce((a, r) => a + r.coins, 0),
    pending,
    nextExpiry: nextExpiry(lots, new Date()),
    rules: await coinSettings(db),
  };
}

/** The customer's own history, newest first (keyset cursor). */
export async function myCoinLedger(
  db: Tx,
  userId: string,
  page: { limit?: number; cursor?: string | null } = {},
): Promise<{ entries: CoinLedgerView[]; nextCursor: string | null }> {
  const { rows, nextCursor } = await ledgerPage(db, eq(coinLedger.userId, userId), page);
  return { entries: rows.map(toView), nextCursor };
}

export interface AdminCoinAccount {
  userId: string;
  balance: number;
  lifetimeEarned: number;
  /** null = no coins yet (send null back with an adjustment). */
  version: number | null;
  pending: PendingRewardView[];
  entries: (CoinLedgerView & { createdBy: string | null })[];
}

/** One customer's coins for staff (`coins:read`): 404 for an unknown account. */
export async function adminCoinAccount(db: Tx, userId: string): Promise<AdminCoinAccount> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new NotFoundError('Customer not found');
  const [acct] = await db.select().from(coinAccounts).where(eq(coinAccounts.userId, userId));
  const { rows } = await ledgerPage(db, eq(coinLedger.userId, userId), { limit: 50 });
  return {
    userId,
    balance: acct?.balance ?? 0,
    lifetimeEarned: acct?.lifetimeEarned ?? 0,
    version: acct?.version ?? null,
    pending: await pendingRewards(db, userId),
    entries: rows.map((r) => ({ ...toView(r), createdBy: r.createdBy })),
  };
}

/** Recent coin activity across customers for staff (`coins:read`), newest first. */
export async function coinActivity(
  db: Tx,
  page: { limit?: number; cursor?: string | null } = {},
): Promise<{ entries: (CoinLedgerView & { userId: string })[]; nextCursor: string | null }> {
  const { rows, nextCursor } = await ledgerPage(db, undefined, page);
  return { entries: rows.map((r) => ({ ...toView(r), userId: r.userId })), nextCursor };
}
