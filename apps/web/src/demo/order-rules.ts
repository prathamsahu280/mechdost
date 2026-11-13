import { useSyncExternalStore } from 'react';

/**
 * Demo copy of the yes/no order rules the admin edits (hard rule 8). Mirrors the API setting
 * `orders.customer_self_cancel` (Q25, user 2026-11-13): off by default, so customers cancel through support.
 * Each order copies the rule when it is placed (`DemoOrder.selfCancel`), like the API's `cancellable_until_status`.
 * Kept apart from the numeric site settings; tiny and Zod-free (it is read when an order is placed).
 */
export interface OrderRules {
  /** Customers may cancel their own order until the shop confirms it. */
  customerSelfCancel: boolean;
}

export const DEFAULT_ORDER_RULES: OrderRules = { customerSelfCancel: false };
const KEY = 'mechdost-demo-order-rules';
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: OrderRules } | null = null;

export function orderRules(): OrderRules {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return DEFAULT_ORDER_RULES;
  }
  if (cache?.raw === raw) return cache.value;
  let value = DEFAULT_ORDER_RULES;
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (typeof v === 'object' && v !== null && typeof (v as OrderRules).customerSelfCancel === 'boolean')
      value = { customerSelfCancel: (v as OrderRules).customerSelfCancel };
  } catch {
    value = DEFAULT_ORDER_RULES;
  }
  cache = { raw, value };
  return value;
}

/** False when the browser refused to save. */
export function saveOrderRules(next: OrderRules): boolean {
  let saved = true;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    saved = false;
  }
  for (const l of listeners) l();
  return saved;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useOrderRules(): OrderRules {
  return useSyncExternalStore(subscribe, orderRules, () => DEFAULT_ORDER_RULES);
}
