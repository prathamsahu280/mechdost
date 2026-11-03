/**
 * DEMO PARTNER STATUS (decision 2026-11-01, user: "admin should have complete control … suspend or pause any
 * workshop, seller or mechanic's account"). Self-contained store (no imports from store.ts) so order routing,
 * booking and portals can all consult it without circular imports. Production: `shops.status` (+ workshops and
 * mechanics tables in Phase 2) with `partner_status_events` history, audited, behind `partners:approve`.
 *
 * - active: normal.
 * - paused: temporary; no NEW orders/bookings, current work continues; still listed (shown as not taking work).
 * - suspended: hidden from customers, no new work, portal locked with the reason shown.
 */
import { useSyncExternalStore } from 'react';

export type PartnerKind = 'shop' | 'workshop' | 'mechanic';
export type PartnerStatus = 'active' | 'paused' | 'suspended';

export interface StatusChange {
  kind: PartnerKind;
  slug: string;
  status: PartnerStatus;
  reason: string;
  by: string;
  at: string;
}

const KEY = 'mechdost-demo-partner-status';
const REASON_MIN = 5;
const REASON_MAX = 300;
const MAX_EVENTS = 300;

const EMPTY: readonly StatusChange[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: readonly StatusChange[] } = { raw: null, value: EMPTY };

const isChange = (v: unknown): v is StatusChange => {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    (c.kind === 'shop' || c.kind === 'workshop' || c.kind === 'mechanic') &&
    typeof c.slug === 'string' &&
    (c.status === 'active' || c.status === 'paused' || c.status === 'suspended') &&
    typeof c.reason === 'string' &&
    typeof c.by === 'string' &&
    typeof c.at === 'string'
  );
};

/** Append-only history, oldest first (the latest entry per partner is its current status). */
function history(): readonly StatusChange[] {
  if (typeof window === 'undefined') return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.value;
  let value: readonly StatusChange[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) value = parsed.filter(isChange);
  } catch {
    value = EMPTY;
  }
  cache = { raw, value };
  return value;
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

/** Current status (and the change that set it) for one partner; active when never changed. */
export function partnerStatus(
  kind: PartnerKind,
  slug: string,
): { status: PartnerStatus; change: StatusChange | null } {
  const all = history();
  for (let i = all.length - 1; i >= 0; i--) {
    const c = all[i];
    if (c?.kind === kind && c.slug === slug) return { status: c.status, change: c };
  }
  return { status: 'active', change: null };
}

/** Can this partner receive NEW orders or bookings? */
export function takesNewWork(kind: PartnerKind, slug: string): boolean {
  return partnerStatus(kind, slug).status === 'active';
}

/** Is this partner visible to customers (paused ones stay listed as "not taking bookings")? */
export function visibleToCustomers(kind: PartnerKind, slug: string): boolean {
  return partnerStatus(kind, slug).status !== 'suspended';
}

export function usePartnerHistory(): readonly StatusChange[] {
  return useSyncExternalStore(subscribe, history, () => EMPTY);
}

export function usePartnerStatus(kind: PartnerKind, slug: string) {
  usePartnerHistory(); // re-render on any change
  return partnerStatus(kind, slug);
}

export type StatusResult = { ok: true } | { ok: false; reason: 'reason' | 'same' };

/**
 * Change a partner's status. Pausing and suspending need a reason the partner sees (5–300 characters);
 * reactivating needs one too, so the history always explains itself. A no-op change is refused.
 */
export function setPartnerStatus(
  kind: PartnerKind,
  slug: string,
  status: PartnerStatus,
  reason: string,
  by: string,
): StatusResult {
  const why = reason.trim();
  if (why.length < REASON_MIN || why.length > REASON_MAX) return { ok: false, reason: 'reason' };
  if (partnerStatus(kind, slug).status === status) return { ok: false, reason: 'same' };
  const next = [...history(), { kind, slug, status, reason: why, by, at: new Date().toISOString() }].slice(
    -MAX_EVENTS,
  );
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: 'same' };
  }
  for (const l of listeners) l();
  return { ok: true };
}
