/**
 * DEMO CUSTOMER BLOCKS (decision 2026-11-01 "customer blocking seems good"; same rules as the API,
 * `packages/db/src/repo/customer-blocks.ts`). Self-contained store (no imports from session.ts or store.ts) so
 * sign-in, checkout and the admin console can all consult it. Production: `customer_blocks` + `customers:block`.
 *
 * Levels (`@mechdost/shared/customers`): cod_only (must prepay — the demo has cash on delivery only, so ordering
 * stops), orders (browse and ask support, no orders), full (no sign-in). One active block per level; lifting
 * needs a reason; history is kept. Only customer accounts can be blocked (staff and partners never).
 */
import { useSyncExternalStore } from 'react';
import {
  blockEffects,
  CUSTOMER_BLOCK_LEVELS,
  CUSTOMER_BLOCK_REASONS,
  type CustomerBlockLevel,
  type CustomerBlockReason,
} from '@mechdost/shared/customers';

export interface DemoCustomerBlock {
  id: string;
  accountId: string;
  level: CustomerBlockLevel;
  reasonCode: CustomerBlockReason;
  note: string | null;
  endsAt: string | null;
  by: string;
  at: string;
  liftedAt: string | null;
  liftedBy: string | null;
  liftedReason: string | null;
}

export const CUSTOMER_BLOCKS_KEY = 'mechdost-demo-customer-blocks';
const NOTE_MAX = 500;
const EMPTY: readonly DemoCustomerBlock[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: readonly DemoCustomerBlock[] } = { raw: null, value: EMPTY };

const isBlock = (v: unknown): v is DemoCustomerBlock => {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.accountId === 'string' &&
    (CUSTOMER_BLOCK_LEVELS as readonly unknown[]).includes(b.level) &&
    (CUSTOMER_BLOCK_REASONS as readonly unknown[]).includes(b.reasonCode) &&
    typeof b.by === 'string' &&
    typeof b.at === 'string'
  );
};

function all(): readonly DemoCustomerBlock[] {
  if (typeof window === 'undefined') return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CUSTOMER_BLOCKS_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.value;
  let value: readonly DemoCustomerBlock[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) value = parsed.filter(isBlock);
  } catch {
    value = EMPTY;
  }
  cache = { raw, value };
  return value;
}

function save(next: readonly DemoCustomerBlock[]): boolean {
  try {
    window.localStorage.setItem(CUSTOMER_BLOCKS_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  for (const l of listeners) l();
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CUSTOMER_BLOCKS_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const inForce = (b: DemoCustomerBlock, now = Date.now()) =>
  b.liftedAt === null && (b.endsAt === null || Date.parse(b.endsAt) > now);

/** Levels in force for an account (not lifted, not expired). */
export function activeLevels(accountId: string | null | undefined): CustomerBlockLevel[] {
  if (!accountId) return [];
  return [
    ...new Set(
      all()
        .filter((b) => b.accountId === accountId && inForce(b))
        .map((b) => b.level),
    ),
  ];
}

/** What an account may do now: sign in, order, pay cash on delivery. */
export function customerAllowed(accountId: string | null | undefined) {
  return blockEffects(activeLevels(accountId));
}

export function useCustomerBlocks(): readonly DemoCustomerBlock[] {
  return useSyncExternalStore(subscribe, all, () => EMPTY);
}

export type BlockResult =
  { ok: true } | { ok: false; reason: 'not_customer' | 'already' | 'ends_at' | 'reason' | 'storage' };

export function blockCustomer(input: {
  account: { id: string; role: string };
  level: CustomerBlockLevel;
  reasonCode: CustomerBlockReason;
  note: string;
  endsAt: string | null;
  by: string;
}): BlockResult {
  // Staff and partner accounts are never blocked here (security review 2026-11-03, same as the API).
  if (input.account.role !== 'customer') return { ok: false, reason: 'not_customer' };
  if (!CUSTOMER_BLOCK_REASONS.includes(input.reasonCode)) return { ok: false, reason: 'reason' };
  if (input.endsAt && !(Date.parse(input.endsAt) > Date.now())) return { ok: false, reason: 'ends_at' };
  if (activeLevels(input.account.id).includes(input.level)) return { ok: false, reason: 'already' };
  const block: DemoCustomerBlock = {
    id: crypto.randomUUID(),
    accountId: input.account.id,
    level: input.level,
    reasonCode: input.reasonCode,
    note: input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null,
    endsAt: input.endsAt,
    by: input.by,
    at: new Date().toISOString(),
    liftedAt: null,
    liftedBy: null,
    liftedReason: null,
  };
  return save([...all(), block]) ? { ok: true } : { ok: false, reason: 'storage' };
}

export function liftCustomerBlock(id: string, reason: string, by: string): BlockResult {
  const why = reason.trim();
  if (why.length < 5 || why.length > 300) return { ok: false, reason: 'reason' };
  const current = all().find((b) => b.id === id);
  if (!current || !inForce(current)) return { ok: false, reason: 'already' };
  const next = all().map((b) =>
    b.id === id ? { ...b, liftedAt: new Date().toISOString(), liftedBy: by, liftedReason: why } : b,
  );
  return save(next) ? { ok: true } : { ok: false, reason: 'storage' };
}
