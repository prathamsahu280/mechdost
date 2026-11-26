/**
 * DEMO CASH-ON-DELIVERY ELIGIBILITY (founder ruling 2026-11-26; same rule as the API: `@mechdost/shared/cod-eligibility`
 * and `packages/db/src/repo/cod-requests.ts`). Self-contained browser store: the switches, the requests and the
 * demo's verified Ustaad accounts. Checkout, Account → Payments and Admin → Customers → COD requests read it.
 *
 * One difference from production, on purpose (decision 2026-11-26, Q-COD1): the demo has no online payment, so its
 * "everyone" switch starts ON (with it off nobody could finish a demo checkout without signing in as an approved
 * account). Admin → Customers → COD requests turns it off to show the real default.
 */
import { useSyncExternalStore } from 'react';
import {
  COD_DECISION_REASONS,
  COD_REQUEST_REASONS,
  COD_REVOKE_REASONS,
  codEligibility,
  type CodApprovalFacts,
  type CodDecisionReason,
  type CodEligibility,
  type CodRequestReason,
  type CodRequestState,
  type CodRevokeReason,
  type CodSwitches,
  type CodUstaadFacts,
} from '@mechdost/shared/cod-eligibility';

export interface DemoCodRequest {
  id: string;
  accountId: string;
  pincode: string;
  status: CodRequestState;
  reasonCode: CodRequestReason;
  note: string | null;
  decisionReasonCode: CodDecisionReason | null;
  revokeReasonCode: CodRevokeReason | null;
  capPaise: number | null;
  expiresAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
  version: number;
}

export interface DemoCodState {
  switches: CodSwitches;
  minOrderPaise: number;
  minItems: number;
  reapplyDays: number;
  requests: readonly DemoCodRequest[];
  /** Demo accounts that are Ustaad members (the demo network is not tied to accounts). */
  ustaad: Readonly<Record<string, CodUstaadFacts>>;
}

export const COD_DEMO_KEY = 'mechdost-demo-cod';
const NOTE_MAX = 300;
const DEFAULT: DemoCodState = {
  switches: { everyone: true, approved: true, ustaad: true, ustaadMinLevel: 0 },
  minOrderPaise: 0,
  minItems: 1,
  reapplyDays: 7,
  requests: [],
  ustaad: {},
};
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: DemoCodState } = { raw: null, value: DEFAULT };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const inList = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

function isRequest(v: unknown): v is DemoCodRequest {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.accountId === 'string' &&
    typeof v.pincode === 'string' &&
    typeof v.status === 'string' &&
    inList(COD_REQUEST_REASONS, v.reasonCode) &&
    typeof v.createdAt === 'string' &&
    typeof v.version === 'number'
  );
}

function read(): DemoCodState {
  if (typeof window === 'undefined') return DEFAULT;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(COD_DEMO_KEY);
  } catch {
    return DEFAULT;
  }
  if (raw === cache.raw) return cache.value;
  let value = DEFAULT;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isObj(parsed)) {
      const sw = isObj(parsed.switches) ? parsed.switches : {};
      const num = (v: unknown, d: number) =>
        typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : d;
      const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
      const ustaad: Record<string, CodUstaadFacts> = {};
      if (isObj(parsed.ustaad))
        for (const [id, m] of Object.entries(parsed.ustaad))
          if (isObj(m) && typeof m.verificationState === 'string' && typeof m.level === 'string')
            ustaad[id] = {
              verificationState: m.verificationState,
              status: typeof m.status === 'string' ? m.status : 'active',
              level: m.level,
              restrictedMode: typeof m.restrictedMode === 'string' ? m.restrictedMode : 'none',
              perksFrozenUntil: null,
            };
      value = {
        switches: {
          everyone: flag(sw.everyone, DEFAULT.switches.everyone),
          approved: flag(sw.approved, DEFAULT.switches.approved),
          ustaad: flag(sw.ustaad, DEFAULT.switches.ustaad),
          ustaadMinLevel: Math.min(3, num(sw.ustaadMinLevel, 0)),
        },
        minOrderPaise: num(parsed.minOrderPaise, 0),
        minItems: Math.max(1, num(parsed.minItems, 1)),
        reapplyDays: num(parsed.reapplyDays, 7),
        requests: Array.isArray(parsed.requests) ? parsed.requests.filter(isRequest) : [],
        ustaad,
      };
    }
  } catch {
    value = DEFAULT;
  }
  cache = { raw, value };
  return value;
}

function save(next: DemoCodState): boolean {
  try {
    window.localStorage.setItem(COD_DEMO_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  for (const l of listeners) l();
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === COD_DEMO_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useDemoCod(): DemoCodState {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

export const demoCodState = read;

/** An approval past its end date reads as expired (as on the API). */
function effectiveStatus(r: DemoCodRequest, now: number): CodRequestState {
  return r.status === 'approved' && r.expiresAt !== null && Date.parse(r.expiresAt) <= now
    ? 'expired'
    : r.status;
}

function governing(state: DemoCodState, accountId: string, now: number): DemoCodRequest | null {
  const mine = state.requests.filter((r) => r.accountId === accountId).toReversed();
  const withStatus = mine.map((r) => ({ ...r, status: effectiveStatus(r, now) }));
  return (
    withStatus.find((r) => r.status === 'pending') ??
    withStatus.find((r) => r.status === 'approved') ??
    withStatus.find((r) => r.status !== 'withdrawn') ??
    null
  );
}

function facts(state: DemoCodState, r: DemoCodRequest | null): CodApprovalFacts {
  if (!r) return { state: 'none', capPaise: null, canRequestAgainAt: null };
  const at = r.status === 'revoked' ? r.revokedAt : r.decidedAt;
  const wait =
    (r.status === 'rejected' || r.status === 'revoked') && at
      ? new Date(Date.parse(at) + state.reapplyDays * 86_400_000)
      : null;
  return { state: r.status, capPaise: r.status === 'approved' ? r.capPaise : null, canRequestAgainAt: wait };
}

/** The same rule as the API, for an account id (null = a guest). */
export function demoCodEligibility(state: DemoCodState, accountId: string | null): CodEligibility {
  const now = Date.now();
  const request = accountId ? governing(state, accountId, now) : null;
  return codEligibility({
    switches: state.switches,
    signedIn: accountId !== null,
    approval: facts(state, request),
    ustaad: accountId ? (state.ustaad[accountId] ?? null) : null,
    now: new Date(now),
  });
}

/** The customer's requests, newest first (status as read now). */
export function demoCodRequestsOf(state: DemoCodState, accountId: string): DemoCodRequest[] {
  const now = Date.now();
  return state.requests
    .filter((r) => r.accountId === accountId)
    .toReversed()
    .map((r) => ({ ...r, status: effectiveStatus(r, now) }));
}

export type DemoCodResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'COD_ALREADY_AVAILABLE'
        | 'COD_REQUEST_PENDING'
        | 'COD_REQUESTS_CLOSED'
        | 'COD_REQUEST_TOO_SOON'
        | 'COD_NOTE_LENGTH'
        | 'STALE_COD_REQUEST'
        | 'COD_REASON_REQUIRED'
        | 'STORAGE';
    };

const newId = () => `codr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function requestDemoCod(input: {
  accountId: string;
  pincode: string;
  reasonCode: CodRequestReason;
  note: string | null;
}): DemoCodResult {
  const state = read();
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note && note.length > NOTE_MAX) return { ok: false, code: 'COD_NOTE_LENGTH' };
  const e = demoCodEligibility(state, input.accountId);
  if (e.eligible) return { ok: false, code: 'COD_ALREADY_AVAILABLE' };
  if (e.reason === 'request_pending') return { ok: false, code: 'COD_REQUEST_PENDING' };
  if (!state.switches.approved) return { ok: false, code: 'COD_REQUESTS_CLOSED' };
  if (!e.canRequest) return { ok: false, code: 'COD_REQUEST_TOO_SOON' };
  const request: DemoCodRequest = {
    id: newId(),
    accountId: input.accountId,
    pincode: input.pincode,
    status: 'pending',
    reasonCode: input.reasonCode,
    note,
    decisionReasonCode: null,
    revokeReasonCode: null,
    capPaise: null,
    expiresAt: null,
    decidedAt: null,
    decidedBy: null,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    version: 1,
  };
  return save({ ...state, requests: [...state.requests, request] })
    ? { ok: true }
    : { ok: false, code: 'STORAGE' };
}

function update(
  id: string,
  version: number,
  from: CodRequestState,
  patch: Partial<DemoCodRequest>,
): DemoCodResult {
  const state = read();
  const row = state.requests.find((r) => r.id === id);
  if (row?.status !== from || row.version !== version) return { ok: false, code: 'STALE_COD_REQUEST' };
  const next = state.requests.map((r) => (r.id === id ? { ...r, ...patch, version: r.version + 1 } : r));
  return save({ ...state, requests: next }) ? { ok: true } : { ok: false, code: 'STORAGE' };
}

export const withdrawDemoCod = (id: string, version: number) =>
  update(id, version, 'pending', { status: 'withdrawn' });

export function decideDemoCod(input: {
  id: string;
  version: number;
  by: string;
  decision: 'approve' | 'reject';
  reasonCode?: CodDecisionReason | null;
  capPaise?: number | null;
  expiresAt?: string | null;
}): DemoCodResult {
  if (input.decision === 'reject' && !inList(COD_DECISION_REASONS, input.reasonCode))
    return { ok: false, code: 'COD_REASON_REQUIRED' };
  const at = new Date().toISOString();
  return input.decision === 'approve'
    ? update(input.id, input.version, 'pending', {
        status: 'approved',
        decidedAt: at,
        decidedBy: input.by,
        capPaise: input.capPaise ?? null,
        expiresAt: input.expiresAt ?? null,
      })
    : update(input.id, input.version, 'pending', {
        status: 'rejected',
        decidedAt: at,
        decidedBy: input.by,
        decisionReasonCode: input.reasonCode ?? null,
      });
}

export function revokeDemoCod(input: {
  id: string;
  version: number;
  reasonCode: CodRevokeReason;
}): DemoCodResult {
  if (!inList(COD_REVOKE_REASONS, input.reasonCode)) return { ok: false, code: 'COD_REASON_REQUIRED' };
  return update(input.id, input.version, 'approved', {
    status: 'revoked',
    revokedAt: new Date().toISOString(),
    revokeReasonCode: input.reasonCode,
  });
}

/** Admin switches in the demo (Settings → Payments on the API). */
export function setDemoCodSwitches(patch: Partial<CodSwitches>): boolean {
  const state = read();
  return save({ ...state, switches: { ...state.switches, ...patch } });
}
