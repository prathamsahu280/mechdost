/**
 * DEMO MECHDOST COINS (decision 2026-11-01, spec 20) — a loyalty bonus, not a wallet: no cash value, not
 * transferable, only a discount on orders. Mirrors the real ledger (`packages/db/src/repo/coins.ts`): append-only
 * entries, balance never below zero, one restore per cancelled order. How coins are earned is decided later
 * (inbox Q24); until then the demo customer starts with labelled demo coins and admins can grant coins by hand.
 */
import { useSyncExternalStore } from 'react';
import { demoStorage } from './store';

export type CoinKind = 'earn' | 'redeem' | 'restore' | 'adjust';

export interface CoinEntry {
  id: string;
  accountId: string;
  delta: number;
  kind: CoinKind;
  reason: string;
  orderCode: string | null;
  by: string | null;
  at: string;
}

const KEY = 'mechdost-demo-coins';

/** Demo welcome coins for the seeded customer so redemption can be shown before earning rules exist. */
const SEED: readonly CoinEntry[] = [
  {
    id: 'coin-seed-ravi',
    accountId: 'demo-customer',
    delta: 250,
    kind: 'earn',
    reason: 'Demo coins',
    orderCode: null,
    by: null,
    at: '2026-10-01T10:00:00.000Z',
  },
];

const isEntry = (v: unknown): v is CoinEntry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as CoinEntry).id === 'string' &&
  typeof (v as CoinEntry).accountId === 'string' &&
  Number.isInteger((v as CoinEntry).delta);

let merged: { stored: readonly CoinEntry[]; all: readonly CoinEntry[] } | null = null;

/** All entries, newest first (seed + this device). */
function entriesSnapshot(): readonly CoinEntry[] {
  const stored = demoStorage.read(KEY, isEntry);
  if (merged?.stored === stored) return merged.all;
  merged = { stored, all: [...stored].reverse().concat(SEED) };
  return merged.all;
}

export function coinBalanceOf(accountId: string): number {
  return entriesSnapshot()
    .filter((e) => e.accountId === accountId)
    .reduce((sum, e) => sum + e.delta, 0);
}

export function useCoinEntries(): readonly CoinEntry[] {
  return useSyncExternalStore(demoStorage.subscribe, entriesSnapshot, () => SEED);
}

/** Balance and history for one account; empty during server render. */
export function useCoins(accountId: string | null | undefined): { balance: number; entries: CoinEntry[] } {
  const all = useCoinEntries();
  const entries = accountId ? all.filter((e) => e.accountId === accountId) : [];
  return { balance: entries.reduce((sum, e) => sum + e.delta, 0), entries };
}

function append(entry: Omit<CoinEntry, 'id' | 'at'>) {
  const stored = demoStorage.read(KEY, isEntry);
  demoStorage.write(KEY, [
    ...stored,
    { ...entry, id: `coin-${globalThis.crypto.randomUUID()}`, at: new Date().toISOString() },
  ]);
}

/** Spend coins on an order. Refused (false) if it would take the balance below zero. */
export function redeemCoins(accountId: string, coins: number, orderCode: string): boolean {
  if (!Number.isInteger(coins) || coins <= 0 || coins > coinBalanceOf(accountId)) return false;
  append({ accountId, delta: -coins, kind: 'redeem', reason: 'Used on order', orderCode, by: null });
  return true;
}

/** Give back exactly what an order used, once (order rejected or cancelled before fulfilment). */
export function restoreCoinsForOrder(accountId: string, orderCode: string): number {
  const outstanding = -entriesSnapshot()
    .filter(
      (e) =>
        e.accountId === accountId &&
        e.orderCode === orderCode &&
        (e.kind === 'redeem' || e.kind === 'restore'),
    )
    .reduce((sum, e) => sum + e.delta, 0);
  if (outstanding <= 0) return 0;
  append({
    accountId,
    delta: outstanding,
    kind: 'restore',
    reason: 'Order cancelled: coins returned',
    orderCode,
    by: null,
  });
  return outstanding;
}

export type AdjustResult = { ok: true } | { ok: false; reason: 'amount' | 'reason' | 'balance' };

/** Manual grant (+) or deduction (−) by an admin, with a reason (audited in production). */
export function adjustCoins(accountId: string, delta: number, reason: string, by: string): AdjustResult {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000)
    return { ok: false, reason: 'amount' };
  const why = reason.trim();
  if (why.length < 3 || why.length > 200) return { ok: false, reason: 'reason' };
  if (coinBalanceOf(accountId) + delta < 0) return { ok: false, reason: 'balance' };
  append({ accountId, delta, kind: 'adjust', reason: why, orderCode: null, by });
  return { ok: true };
}
