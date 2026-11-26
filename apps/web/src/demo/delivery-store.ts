/**
 * DEMO DELIVERY AGENTS (spec 24, design 2026-11-26) — the whole agent flow in the presenting browser: applications,
 * invites, agents and documents, jobs and offers, pickup and delivery codes, failed deliveries and the return to the
 * shop, shop delivery-mode requests and the per-order switch to the shop's own delivery. Real builds call the API
 * (`lib/delivery/*-client.ts`); this module is only loaded by the demo clients, never by storefront pages.
 *
 * Every move checks the current state and `version` first, like the conditional UPDATEs in packages/db: a stale or
 * repeated action is a refused no-op. Moves follow the contract's machines (`deliveryJobMachine` and friends).
 *
 * Demo-only rules (decisions 2026-11-26 "Delivery agents web"): the browser demo has no payments, so its orders count as
 * prepaid for the delivery mode (Lead's call 8 keeps COD with the shop in real builds); agents are switched on in the
 * demo city (real default off, Lead's call 11); photos are never stored (a flag only); a sub-order's load is light
 * unless it holds more than four items.
 */
import {
  AGENT_DOCUMENT_KINDS,
  DEFAULT_VEHICLE_MAX_LOAD_KG,
  DELIVERY_ACTIVE_JOB_STATES,
  HANDOVER_CODE_MAX_ATTEMPTS,
  contactStage,
  documentNumberProblem,
  maskDocumentNumber,
  normaliseDocumentNumber,
  retryAllowed,
  returnRefundKind,
  vehicleCarries,
  type AgentDocumentKind,
  type AgentDocumentRejectReason,
  type AgentDocumentStatus,
  type AgentInviteStatus,
  type AgentStatus,
  type AgentStatusReason,
  type AgentVehicleType,
  type DeliveryDeclineReason,
  type DeliveryFailReason,
  type DeliveryFailureDecision,
  type DeliveryGiveUpReason,
  type DeliveryJobStatus,
  type DeliveryOfferStatus,
  type DeliveryRetryAgent,
  type DeliverySwitchDeclineReason,
  type DeliverySwitchReason,
  type DeliverySwitchStatus,
  type DeliveryWithdrawReason,
  type LoadClass,
  type ShopDeliveryMode,
  type ShopModeRejectReason,
  type ShopModeRequestReason,
  type ShopModeRequestStatus,
} from '@mechdost/shared/delivery/codes';
import { publicCode } from '@mechdost/shared/ids';
import type { RatingReason } from '@/lib/delivery/types';
import { agentStatusMachine, deliveryJobMachine } from '@mechdost/shared/state';
import { localizeArea, localizeShop, productNameFor } from './i18n/localize';
import { DEMO_SHOPS, findShop } from './shops';
import { SEEDED_ACCOUNTS, isAccount, type DemoAccount } from './session-state';
import { ORDER_STAGES, isClosed, storeCore, type DemoOrder } from './store';

const { keys: KEYS, read, write, isRecord, newId } = storeCore;

export type Res<T = null> = { ok: true; data: T } | { ok: false; code: string };
const ok = <T>(data: T): Res<T> => ({ ok: true, data });
const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });

// ── records ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DemoAgentDoc {
  kind: AgentDocumentKind;
  number: string;
  status: AgentDocumentStatus;
  rejectReason: AgentDocumentRejectReason | null;
  submittedAt: string;
}
export interface DemoAgentHistory {
  at: string;
  fromStatus: AgentStatus | null;
  toStatus: AgentStatus;
  reasonCode: AgentStatusReason | null;
  note: string | null;
}
export interface DemoAgent {
  id: string;
  accountId: string;
  name: string;
  phone: string;
  cityCode: string;
  vehicleType: AgentVehicleType;
  status: AgentStatus;
  statusReason: AgentStatusReason | null;
  online: boolean;
  /** Home point for ranking (km from the shop). */
  lat: number;
  lng: number;
  documents: DemoAgentDoc[];
  history: DemoAgentHistory[];
  createdAt: string;
  version: number;
}
export interface DemoOffer {
  id: string;
  agentId: string;
  status: DeliveryOfferStatus;
  reasonCode: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}
export interface DemoJobEvent {
  at: string;
  kind: string;
  actorType: 'delivery_agent' | 'shop' | 'admin' | 'system';
  fromStatus: DeliveryJobStatus | null;
  toStatus: DeliveryJobStatus | null;
  reasonCode: string | null;
}
export interface DemoJob {
  id: string;
  orderCode: string;
  shopSlug: string;
  status: DeliveryJobStatus;
  agentId: string | null;
  offers: DemoOffer[];
  events: DemoJobEvent[];
  pickupCode: string;
  pickupAttempts: number;
  returnCode: string | null;
  returnAttempts: number;
  /** What the hand-back leads to: another agent (`retry`) or the order closes (`close`). */
  returnOutcome: 'retry' | 'close' | null;
  attempt: number;
  failReason: DeliveryFailReason | null;
  photos: { purpose: 'pickup' | 'delivery' | 'failure'; at: string }[];
  statusAt: string;
  createdAt: string;
  version: number;
}
export interface DemoAgentApplication {
  code: string;
  name: string;
  phone: string;
  cityCode: string;
  vehicleType: AgentVehicleType;
  status: 'new' | 'invited' | 'rejected';
  rejectReason: string | null;
  createdAt: string;
}
export interface DemoAgentInvite {
  id: string;
  token: string;
  name: string;
  phone: string;
  email: string | null;
  cityCode: string;
  vehicleType: AgentVehicleType;
  status: AgentInviteStatus;
  applicationCode: string | null;
  createdAt: string;
  expiresAt: string;
}
export interface DemoModeRequest {
  id: string;
  shopSlug: string;
  requestedMode: ShopDeliveryMode;
  reasonCode: ShopModeRequestReason;
  note: string | null;
  status: ShopModeRequestStatus;
  decisionReason: ShopModeRejectReason | null;
  createdAt: string;
  decidedAt: string | null;
  version: number;
}
export interface DemoSwitch {
  id: string;
  orderCode: string;
  status: DeliverySwitchStatus;
  reasonCode: DeliverySwitchReason;
  note: string | null;
  declineReason: DeliverySwitchDeclineReason | null;
  createdAt: string;
  version: number;
}
/** Rider rating by the customer (founder 2026-11-26): one per job, editable for 24 h. */
export { RATING_REASONS } from '@/lib/delivery/types';
export type { RatingReason };
export interface DemoRating {
  jobId: string;
  agentId: string;
  stars: number;
  reasons: RatingReason[];
  note: string | null;
  createdAt: string;
  editableUntil: string;
}
export interface DemoDeliverySettings {
  agentsEnabled: boolean;
  offerTimeoutMin: number;
  maxActiveJobs: number;
  photosRequired: boolean;
  maxAttempts: number;
  maxLoadKg: Record<AgentVehicleType, number>;
}
interface DeliveryState {
  agents: DemoAgent[];
  jobs: DemoJob[];
  applications: DemoAgentApplication[];
  invites: DemoAgentInvite[];
  shopModes: Record<string, ShopDeliveryMode>;
  modeRequests: DemoModeRequest[];
  switches: DemoSwitch[];
  ratings: DemoRating[];
  settings: DemoDeliverySettings;
}

// ── seeds ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fixed demo agents (docs/runbooks/demo.md): Sunil on a motorcycle, Deepak on a three-wheeler. */
export const DEMO_AGENT_IDS = {
  sunil: '0193a5d0-0000-7000-8000-00000000a001',
  deepak: '0193a5d0-0000-7000-8000-00000000a002',
} as const;
const SEED_AT = '2026-11-20T09:00:00.000Z';
const verifiedDocs = (pan: string, dl: string, rc: string): DemoAgentDoc[] =>
  (
    [
      ['pan', pan],
      ['driving_licence', dl],
      ['vehicle_rc', rc],
    ] as const
  ).map(([kind, number]) => ({ kind, number, status: 'verified', rejectReason: null, submittedAt: SEED_AT }));

function seedState(): DeliveryState {
  return {
    agents: [
      {
        id: DEMO_AGENT_IDS.sunil,
        accountId: 'demo-agent',
        name: 'Sunil Yadav',
        phone: '9000000005',
        cityCode: 'RPR',
        vehicleType: 'bike',
        status: 'active',
        statusReason: null,
        online: true,
        lat: 21.2541,
        lng: 81.6297,
        documents: verifiedDocs('ABCPY1234K', 'CG0420190012345', 'CG04MK2201'),
        history: [
          { at: SEED_AT, fromStatus: 'onboarding', toStatus: 'active', reasonCode: null, note: null },
        ],
        createdAt: SEED_AT,
        version: 1,
      },
      {
        id: DEMO_AGENT_IDS.deepak,
        accountId: 'demo-agent-2',
        name: 'Deepak Sahu',
        phone: '9000000007',
        cityCode: 'RPR',
        vehicleType: 'three_wheeler',
        status: 'active',
        statusReason: null,
        online: false,
        lat: 21.2459,
        lng: 81.6602,
        documents: verifiedDocs('BCDPS5678L', 'CG0420180067890', 'CG04AB7710'),
        history: [
          { at: SEED_AT, fromStatus: 'onboarding', toStatus: 'active', reasonCode: null, note: null },
        ],
        createdAt: SEED_AT,
        version: 1,
      },
    ],
    jobs: [],
    applications: [
      {
        code: 'PA-RPR-2026-DA7K2M',
        name: 'Manoj Verma',
        phone: '9123400012',
        cityCode: 'RPR',
        vehicleType: 'scooter',
        status: 'new',
        rejectReason: null,
        createdAt: SEED_AT,
      },
    ],
    invites: [],
    // Existing shops deliver themselves (Lead's call 11); Gupta Lubes & Spares shows the agent flow in the demo.
    shopModes: { 'gupta-lubes-spares': 'agents' },
    modeRequests: [],
    switches: [],
    ratings: [],
    settings: {
      agentsEnabled: true,
      // Founder 2026-11-26: 15 minutes by default, per city.
      offerTimeoutMin: 15,
      maxActiveJobs: 3,
      photosRequired: true,
      maxAttempts: 2,
      maxLoadKg: { ...DEFAULT_VEHICLE_MAX_LOAD_KG },
    },
  };
}

const isState = (v: unknown): v is DeliveryState =>
  isRecord(v) &&
  Array.isArray(v.agents) &&
  Array.isArray(v.jobs) &&
  Array.isArray(v.applications) &&
  Array.isArray(v.invites) &&
  isRecord(v.shopModes) &&
  Array.isArray(v.modeRequests) &&
  Array.isArray(v.switches) &&
  isRecord(v.settings);

let seeded: DeliveryState | null = null;
/** The saved state, or the seed until the first change on this device. Stable between writes (React snapshots). */
export function deliveryState(): DeliveryState {
  const stored = read(KEYS.delivery, isState)[0];
  if (stored) return { ...stored, ratings: Array.isArray(stored.ratings) ? stored.ratings : [] };
  seeded ??= seedState();
  return seeded;
}
function save(next: DeliveryState): void {
  seeded = null;
  write(KEYS.delivery, [next]);
}
/** One change: `fn` returns the new state (saved) or null (nothing changed). */
function change<T>(
  fn: (s: DeliveryState, now: string) => { state: DeliveryState; result: Res<T> } | Res<T>,
): Res<T> {
  sweepExpiredOffers();
  const out = fn(deliveryState(), new Date().toISOString());
  if ('state' in out) {
    save(out.state);
    return out.result;
  }
  return out;
}

export const subscribeDelivery = storeCore.subscribe;

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Uniform random 4-digit code (rejection sampling, no modulo bias). */
function fourDigits(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0] ?? 0;
  } while (n >= 4_294_960_000);
  return String(n % 10_000).padStart(4, '0');
}
function token(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const ordersNow = () => storeCore.ordersSnapshot();
const findOrder = (code: string) => ordersNow().find((o) => o.code === code);
function writeOrder(code: string, fn: (o: DemoOrder) => DemoOrder): void {
  write(
    KEYS.orders,
    ordersNow().map((o) => (o.code === code ? fn(o) : o)),
  );
}
const STAGE_PACKED = ORDER_STAGES.indexOf('packed');
const STAGE_OUT = ORDER_STAGES.indexOf('shipped');
const STAGE_DELIVERED = ORDER_STAGES.indexOf('delivered');
const ACTIVE = DELIVERY_ACTIVE_JOB_STATES as readonly DeliveryJobStatus[];
const isActiveJob = (j: DemoJob) => ACTIVE.includes(j.status);
/** Jobs an agent holds (counted against `maxActiveJobs`). */
const HELD: readonly DeliveryJobStatus[] = ['accepted', 'picked_up', 'failed', 'returning'];

function moveJob(
  j: DemoJob,
  to: DeliveryJobStatus,
  by: DemoJobEvent['actorType'],
  now: string,
  kind: string,
  reasonCode: string | null = null,
): DemoJob {
  deliveryJobMachine.assert(j.status, to, by);
  return {
    ...j,
    status: to,
    statusAt: now,
    version: j.version + 1,
    events: [...j.events, { at: now, kind, actorType: by, fromStatus: j.status, toStatus: to, reasonCode }],
  };
}
const withJob = (s: DeliveryState, j: DemoJob): DeliveryState => ({
  ...s,
  jobs: s.jobs.map((x) => (x.id === j.id ? j : x)),
});
const withAgent = (s: DeliveryState, a: DemoAgent): DeliveryState => ({
  ...s,
  agents: s.agents.map((x) => (x.id === a.id ? a : x)),
});
const openOffer = (j: DemoJob) => j.offers.find((o) => o.status === 'offered') ?? null;
/** An agent may see a job offered to them (open offer) or one they hold or held (accepted offer). */
const agentMaySee = (j: DemoJob, agentId: string) =>
  j.agentId === agentId || j.offers.some((o) => o.agentId === agentId && o.status === 'offered');

function loadOf(order: DemoOrder): LoadClass {
  return order.lines.reduce((n, l) => n + l.qty, 0) > 4 ? 'heavy' : 'light';
}
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}

// ── settings and modes ─────────────────────────────────────────────────────────────────────────────────────────────

export const deliverySettings = (): DemoDeliverySettings => deliveryState().settings;
export function saveDeliverySettings(next: DemoDeliverySettings): Res {
  return change((s) => ({ state: { ...s, settings: next }, result: ok(null) }));
}
export function shopDeliveryMode(slug: string): ShopDeliveryMode {
  return deliveryState().shopModes[slug] ?? 'self';
}
const jobForOrder = (s: DeliveryState, code: string) =>
  s.jobs.filter((j) => j.orderCode === code).at(-1) ?? null;

/** Who delivers this sub-order (Lead's call 9): an agent once a job exists or while its shop is in agents mode. */
export function orderDeliveryMode(order: DemoOrder): 'agent' | 'shop' {
  const s = deliveryState();
  const job = jobForOrder(s, order.code);
  if (job) return job.status === 'cancelled' ? 'shop' : 'agent';
  const slug = order.shop?.slug ?? '';
  return s.settings.agentsEnabled && (s.shopModes[slug] ?? 'self') === 'agents' && order.stage <= STAGE_PACKED
    ? 'agent'
    : 'shop';
}

// ── expiry sweep (the worker's job in real builds) ─────────────────────────────────────────────────────────────────

export function sweepExpiredOffers(now = Date.now()): void {
  const s = deliveryState();
  const at = new Date(now).toISOString();
  const jobs = s.jobs.map((j) => {
    const offer = openOffer(j);
    if (j.status !== 'offered' || !offer || new Date(offer.expiresAt).getTime() > now) return j;
    return {
      ...moveJob(j, 'needs_agent', 'system', at, 'offer_expired'),
      agentId: null,
      offers: j.offers.map((o) =>
        o.id === offer.id ? { ...o, status: 'expired' as const, decidedAt: at } : o,
      ),
    };
  });
  if (jobs.some((j, i) => j !== s.jobs[i])) save({ ...s, jobs });
}

// ── shop ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Packed → ready for pickup: a job waits for an agent and the shop gets its 4-digit pickup code. */
export function markReadyForPickup(orderCode: string, shopSlug: string): Res {
  return change((s, now) => {
    const o = findOrder(orderCode);
    if (o?.shop?.slug !== shopSlug || o.shop.status !== 'accepted' || isClosed(o)) return fail('NOT_FOUND');
    if (orderDeliveryMode(o) !== 'agent') return fail('NOT_AGENT_MODE');
    if (o.stage !== STAGE_PACKED) return fail('JOB_CHANGED');
    if (s.jobs.some((j) => j.orderCode === orderCode && isActiveJob(j))) return fail('JOB_CHANGED');
    const attempt = s.jobs.filter((j) => j.orderCode === orderCode && j.status !== 'cancelled').length + 1;
    const job: DemoJob = {
      id: newId(),
      orderCode,
      shopSlug,
      status: 'needs_agent',
      agentId: null,
      offers: [],
      events: [
        {
          at: now,
          kind: 'ready_for_pickup',
          actorType: 'shop',
          fromStatus: null,
          toStatus: 'needs_agent',
          reasonCode: null,
        },
      ],
      pickupCode: fourDigits(),
      pickupAttempts: 0,
      returnCode: null,
      returnAttempts: 0,
      returnOutcome: null,
      attempt,
      failReason: null,
      photos: [],
      statusAt: now,
      createdAt: now,
      version: 0,
    };
    return { state: { ...s, jobs: [...s.jobs, job] }, result: ok(null) };
  });
}

/** The shop types the agent's return code: the parcel is back (retry → ready again; close → returned). */
export function returnReceived(
  orderCode: string,
  shopSlug: string,
  code: string,
):
  | Res<{ attemptsLeft: number; locked: boolean }>
  | { ok: false; code: 'WRONG_CODE' | 'CODE_LOCKED'; attemptsLeft: number } {
  const s = deliveryState();
  const j = jobForOrder(s, orderCode);
  if (j?.shopSlug !== shopSlug || j.status !== 'returning') return fail('NOT_FOUND');
  if (j.returnAttempts >= HANDOVER_CODE_MAX_ATTEMPTS)
    return { ok: false, code: 'CODE_LOCKED', attemptsLeft: 0 };
  const now = new Date().toISOString();
  if (code !== j.returnCode) {
    const attempts = j.returnAttempts + 1;
    save(withJob(s, { ...j, returnAttempts: attempts }));
    const left = HANDOVER_CODE_MAX_ATTEMPTS - attempts;
    return { ok: false, code: left === 0 ? 'CODE_LOCKED' : 'WRONG_CODE', attemptsLeft: left };
  }
  return finishReturn(s, j, now, 'shop');
}
function finishReturn(
  s: DeliveryState,
  j: DemoJob,
  now: string,
  by: 'shop' | 'admin',
): Res<{ attemptsLeft: number; locked: boolean }> {
  const done = moveJob(j, 'returned', by, now, 'returned', j.returnOutcome);
  const failures = s.jobs
    .filter((x) => x.orderCode === j.orderCode)
    .flatMap((x) => (x.failReason ? [x.failReason] : []));
  if (j.returnOutcome === 'retry') {
    const next: DemoJob = {
      ...done,
      id: newId(),
      status: 'needs_agent',
      agentId: null,
      offers: [],
      events: [
        {
          at: now,
          kind: 'retry_opened',
          actorType: 'system',
          fromStatus: null,
          toStatus: 'needs_agent',
          reasonCode: null,
        },
      ],
      pickupCode: fourDigits(),
      pickupAttempts: 0,
      returnCode: null,
      returnAttempts: 0,
      returnOutcome: null,
      attempt: j.attempt + 1,
      failReason: null,
      photos: [],
      statusAt: now,
      createdAt: now,
      version: 0,
    };
    save({ ...withJob(s, done), jobs: [...withJob(s, done).jobs, next] });
    writeOrder(j.orderCode, (o) => ({ ...o, stage: STAGE_PACKED, delivery: null }));
  } else {
    save(withJob(s, done));
    writeOrder(j.orderCode, (o) => ({ ...o, returned: { at: now, refund: returnRefundKind(failures) } }));
  }
  return ok({ attemptsLeft: HANDOVER_CODE_MAX_ATTEMPTS, locked: false });
}

export function confirmSwitch(orderCode: string, shopSlug: string, id: string, version: number): Res {
  return change((s, now) => {
    const sw = s.switches.find((x) => x.id === id && x.orderCode === orderCode);
    const o = findOrder(orderCode);
    if (!sw || o?.shop?.slug !== shopSlug) return fail('NOT_FOUND');
    if (sw.status !== 'requested' || sw.version !== version) return fail('JOB_CHANGED');
    const j = jobForOrder(s, orderCode);
    let next: DeliveryState = {
      ...s,
      switches: s.switches.map((x) =>
        x.id === id ? { ...x, status: 'confirmed' as const, version: x.version + 1 } : x,
      ),
    };
    if (j && ['needs_agent', 'offered', 'accepted'].includes(j.status)) {
      next = withJob(next, {
        ...moveJob(j, 'cancelled', 'admin', now, 'switched_to_shop', sw.reasonCode),
        offers: j.offers.map((x) =>
          x.status === 'offered' || x.status === 'accepted'
            ? { ...x, status: 'withdrawn' as const, decidedAt: now }
            : x,
        ),
      });
    }
    return { state: next, result: ok(null) };
  });
}
export function declineSwitch(
  orderCode: string,
  shopSlug: string,
  id: string,
  reason: DeliverySwitchDeclineReason,
  note: string | undefined,
  version: number,
): Res {
  return change((s) => {
    const sw = s.switches.find((x) => x.id === id && x.orderCode === orderCode);
    if (!sw || findOrder(orderCode)?.shop?.slug !== shopSlug) return fail('NOT_FOUND');
    if (sw.status !== 'requested' || sw.version !== version) return fail('JOB_CHANGED');
    if (reason === 'other' && !note) return fail('NOTE_REQUIRED');
    return {
      state: {
        ...s,
        switches: s.switches.map((x) =>
          x.id === id
            ? { ...x, status: 'declined' as const, declineReason: reason, version: x.version + 1 }
            : x,
        ),
      },
      result: ok(null),
    };
  });
}

export interface ShopOrderDeliveryView {
  mode: 'agent' | 'shop';
  pickupCode: string | null;
  pickupLocked: boolean;
  jobStatus: DeliveryJobStatus | null;
  agentFirstName: string | null;
  vehicleType: AgentVehicleType | null;
  returning: boolean;
  switchRequest: {
    id: string;
    reasonCode: DeliverySwitchReason;
    requestedAt: string;
    version: number;
  } | null;
}
/** `ShopOrderDelivery` for one order of this shop; null while the order is delivered by the shop itself. */
export function shopOrderDelivery(orderCode: string, shopSlug: string): ShopOrderDeliveryView | null {
  const s = deliveryState();
  const o = findOrder(orderCode);
  if (o?.shop?.slug !== shopSlug) return null;
  const j = jobForOrder(s, orderCode);
  const sw = s.switches.find((x) => x.orderCode === orderCode && x.status === 'requested') ?? null;
  const confirmed = s.switches.some((x) => x.orderCode === orderCode && x.status === 'confirmed');
  if (!j) return orderDeliveryMode(o) === 'agent' ? emptyView('agent') : null;
  if (confirmed || j.status === 'cancelled') return { ...emptyView('shop'), jobStatus: j.status };
  const agent = s.agents.find((a) => a.id === j.agentId);
  const holding =
    j.status === 'accepted' || j.status === 'picked_up' || j.status === 'failed' || j.status === 'returning';
  return {
    mode: 'agent',
    pickupCode: ['needs_agent', 'offered', 'accepted'].includes(j.status) ? j.pickupCode : null,
    pickupLocked: j.pickupAttempts >= HANDOVER_CODE_MAX_ATTEMPTS,
    jobStatus: j.status,
    agentFirstName: holding && agent ? firstName(agent.name) : null,
    vehicleType: holding && agent ? agent.vehicleType : null,
    returning: j.status === 'returning',
    switchRequest: sw
      ? { id: sw.id, reasonCode: sw.reasonCode, requestedAt: sw.createdAt, version: sw.version }
      : null,
  };
}
const emptyView = (mode: 'agent' | 'shop'): ShopOrderDeliveryView => ({
  mode,
  pickupCode: null,
  pickupLocked: false,
  jobStatus: null,
  agentFirstName: null,
  vehicleType: null,
  returning: false,
  switchRequest: null,
});

export function shopModeView(slug: string) {
  const s = deliveryState();
  return {
    mode: shopDeliveryMode(slug),
    agentsEnabled: s.settings.agentsEnabled,
    requests: s.modeRequests
      .filter((r) => r.shopSlug === slug)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ shopSlug: _shop, ...r }) => r),
  };
}
export function requestShopMode(
  slug: string,
  requestedMode: ShopDeliveryMode,
  reasonCode: ShopModeRequestReason,
  note?: string,
): Res {
  return change((s, now) => {
    if (s.modeRequests.some((r) => r.shopSlug === slug && r.status === 'pending'))
      return fail('REQUEST_PENDING');
    if (shopDeliveryMode(slug) === requestedMode) return fail('ALREADY_IN_MODE');
    if (reasonCode === 'other' && !note) return fail('NOTE_REQUIRED');
    const row: DemoModeRequest = {
      id: newId(),
      shopSlug: slug,
      requestedMode,
      reasonCode,
      note: note ?? null,
      status: 'pending',
      decisionReason: null,
      createdAt: now,
      decidedAt: null,
      version: 0,
    };
    return { state: { ...s, modeRequests: [...s.modeRequests, row] }, result: ok(null) };
  });
}
export function withdrawShopModeRequest(slug: string, id: string): Res {
  return change((s, now) => {
    const r = s.modeRequests.find((x) => x.id === id && x.shopSlug === slug);
    if (!r) return fail('NOT_FOUND');
    if (r.status !== 'pending') return fail('JOB_CHANGED');
    return {
      state: {
        ...s,
        modeRequests: s.modeRequests.map((x) =>
          x.id === id ? { ...x, status: 'withdrawn' as const, decidedAt: now, version: x.version + 1 } : x,
        ),
      },
      result: ok(null),
    };
  });
}

// ── admin ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function decideShopMode(
  id: string,
  approve: boolean,
  version: number,
  reasonCode?: ShopModeRejectReason,
): Res {
  return change((s, now) => {
    const r = s.modeRequests.find((x) => x.id === id);
    if (!r) return fail('NOT_FOUND');
    if (r.status !== 'pending' || r.version !== version) return fail('JOB_CHANGED');
    if (!approve && !reasonCode) return fail('REASON_REQUIRED');
    return {
      state: {
        ...s,
        shopModes: approve ? { ...s.shopModes, [r.shopSlug]: r.requestedMode } : s.shopModes,
        modeRequests: s.modeRequests.map((x) =>
          x.id === id
            ? {
                ...x,
                status: approve ? ('approved' as const) : ('rejected' as const),
                decisionReason: approve ? null : (reasonCode ?? null),
                decidedAt: now,
                version: x.version + 1,
              }
            : x,
        ),
      },
      result: ok(null),
    };
  });
}
export function setShopMode(slug: string, mode: ShopDeliveryMode): Res {
  return change((s) => ({ state: { ...s, shopModes: { ...s.shopModes, [slug]: mode } }, result: ok(null) }));
}
export function shopModeRequests() {
  const s = deliveryState();
  return s.modeRequests
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({ ...r, currentMode: shopDeliveryMode(r.shopSlug) }));
}

export function offerJob(jobId: string, agentId: string, version: number): Res {
  return change((s, now) => {
    const j = s.jobs.find((x) => x.id === jobId);
    const a = s.agents.find((x) => x.id === agentId);
    if (!j || !a) return fail('NOT_FOUND');
    if (!s.settings.agentsEnabled) return fail('AGENTS_DISABLED');
    if (j.status !== 'needs_agent' || j.version !== version) return fail('JOB_CHANGED');
    if (a.status !== 'active') return fail('AGENT_NOT_ACTIVE');
    const order = findOrder(j.orderCode);
    if (
      order &&
      !vehicleCarries(a.vehicleType, { knownWeightG: 0, unknownClass: loadOf(order) }, s.settings.maxLoadKg)
    )
      return fail('VEHICLE_CANNOT_CARRY');
    if (heldBy(s, agentId) >= s.settings.maxActiveJobs) return fail('TOO_MANY_ACTIVE_JOBS');
    const offer: DemoOffer = {
      id: newId(),
      agentId,
      status: 'offered',
      reasonCode: null,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + s.settings.offerTimeoutMin * 60_000).toISOString(),
      decidedAt: null,
    };
    return {
      state: withJob(s, { ...moveJob(j, 'offered', 'admin', now, 'offered'), offers: [...j.offers, offer] }),
      result: ok(null),
    };
  });
}
const heldBy = (s: DeliveryState, agentId: string) =>
  s.jobs.filter((j) => j.agentId === agentId && HELD.includes(j.status)).length;

export function withdrawJob(jobId: string, reason: DeliveryWithdrawReason, version: number): Res {
  return change((s, now) => {
    const j = s.jobs.find((x) => x.id === jobId);
    if (!j) return fail('NOT_FOUND');
    if ((j.status !== 'offered' && j.status !== 'accepted') || j.version !== version)
      return fail('JOB_CHANGED');
    return {
      state: withJob(s, {
        ...moveJob(j, 'needs_agent', 'admin', now, 'withdrawn', reason),
        agentId: null,
        offers: j.offers.map((o) =>
          o.status === 'offered' || o.status === 'accepted'
            ? { ...o, status: 'withdrawn' as const, reasonCode: reason, decidedAt: now }
            : o,
        ),
      }),
      result: ok(null),
    };
  });
}

export function decideFailure(
  jobId: string,
  decision: DeliveryFailureDecision,
  agent: DeliveryRetryAgent | undefined,
  version: number,
): Res {
  return change((s, now) => {
    const j = s.jobs.find((x) => x.id === jobId);
    if (!j) return fail('NOT_FOUND');
    if (j.status !== 'failed' || j.version !== version) return fail('JOB_CHANGED');
    if (decision === 'retry' && !agent) return fail('AGENT_REQUIRED');
    if (
      decision === 'retry' &&
      !retryAllowed({ failedAttempts: j.attempt, maxAttempts: s.settings.maxAttempts })
    )
      return fail('RETRY_LIMIT');
    if (decision === 'retry' && agent === 'same') {
      return {
        state: withJob(s, {
          ...moveJob(j, 'picked_up', 'admin', now, 'retry_same_agent'),
          attempt: j.attempt + 1,
          failReason: j.failReason,
        }),
        result: ok(null),
      };
    }
    return {
      state: withJob(s, {
        ...moveJob(
          j,
          'returning',
          'admin',
          now,
          decision === 'retry' ? 'retry_other_agent' : 'return_to_shop',
        ),
        returnCode: fourDigits(),
        returnAttempts: 0,
        returnOutcome: decision === 'retry' ? 'retry' : 'close',
      }),
      result: ok(null),
    };
  });
}

/** Audited admin overrides when a code is locked (reason 5–300 characters). */
export function overrideJob(
  jobId: string,
  kind: 'pickup' | 'delivery' | 'return',
  reason: string,
  version: number,
): Res {
  const why = reason.trim();
  if (why.length < 5 || why.length > 300) return fail('REASON_REQUIRED');
  const s = deliveryState();
  const j = s.jobs.find((x) => x.id === jobId);
  if (!j) return fail('NOT_FOUND');
  if (j.version !== version) return fail('JOB_CHANGED');
  const now = new Date().toISOString();
  if (kind === 'return') {
    if (j.status !== 'returning') return fail('JOB_CHANGED');
    const r = finishReturn(s, j, now, 'admin');
    return r.ok ? ok(null) : r;
  }
  if (kind === 'pickup') {
    if (j.status !== 'accepted') return fail('JOB_CHANGED');
    save(withJob(s, moveJob(j, 'picked_up', 'admin', now, 'pickup_override')));
    startDelivery(j.orderCode);
    return ok(null);
  }
  if (j.status !== 'picked_up') return fail('JOB_CHANGED');
  save(withJob(s, moveJob(j, 'delivered', 'admin', now, 'delivery_override')));
  writeOrder(j.orderCode, (o) => ({
    ...o,
    stage: STAGE_DELIVERED,
    delivery: o.delivery
      ? { ...o.delivery, confirmedAt: now, method: 'override', overrideReason: why }
      : o.delivery,
  }));
  return ok(null);
}

/** Staff ask the shop to deliver this sub-order itself (Lead's call 9). */
export function requestSwitch(orderCode: string, reasonCode: DeliverySwitchReason, note?: string): Res {
  return change((s, now) => {
    const j = jobForOrder(s, orderCode);
    if (!j || !['needs_agent', 'offered', 'accepted'].includes(j.status)) return fail('JOB_CHANGED');
    if (s.switches.some((x) => x.orderCode === orderCode && x.status === 'requested'))
      return fail('REQUEST_PENDING');
    if (reasonCode === 'other' && !note) return fail('NOTE_REQUIRED');
    const row: DemoSwitch = {
      id: newId(),
      orderCode,
      status: 'requested',
      reasonCode,
      note: note ?? null,
      declineReason: null,
      createdAt: now,
      version: 0,
    };
    return { state: { ...s, switches: [...s.switches, row] }, result: ok(null) };
  });
}

// ── agent ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const agentForAccount = (accountId: string): DemoAgent | undefined =>
  deliveryState().agents.find((a) => a.accountId === accountId);

export function acceptOffer(agentId: string, offerId: string): Res<{ jobId: string }> {
  return change((s, now) => {
    const j = s.jobs.find((x) => x.offers.some((o) => o.id === offerId && o.agentId === agentId));
    const offer = j?.offers.find((o) => o.id === offerId);
    if (!j || !offer) return fail('NOT_FOUND');
    if (
      offer.status === 'expired' ||
      (offer.status === 'offered' && Date.parse(offer.expiresAt) <= Date.parse(now))
    )
      return fail('OFFER_EXPIRED');
    if (offer.status !== 'offered' || j.status !== 'offered') return fail('JOB_CHANGED');
    if (heldBy(s, agentId) >= s.settings.maxActiveJobs) return fail('TOO_MANY_ACTIVE_JOBS');
    return {
      state: withJob(s, {
        ...moveJob(j, 'accepted', 'delivery_agent', now, 'accepted'),
        agentId,
        offers: j.offers.map((o) =>
          o.id === offerId ? { ...o, status: 'accepted' as const, decidedAt: now } : o,
        ),
      }),
      result: ok({ jobId: j.id }),
    };
  });
}
export function declineOffer(
  agentId: string,
  offerId: string,
  reason: DeliveryDeclineReason,
  note?: string,
): Res {
  if (reason === 'other' && !note) return fail('NOTE_REQUIRED');
  return change((s, now) => {
    const j = s.jobs.find((x) => x.offers.some((o) => o.id === offerId && o.agentId === agentId));
    const offer = j?.offers.find((o) => o.id === offerId);
    if (!j || !offer) return fail('NOT_FOUND');
    if (offer.status !== 'offered' || j.status !== 'offered') return fail('OFFER_EXPIRED');
    return {
      state: withJob(s, {
        ...moveJob(j, 'needs_agent', 'delivery_agent', now, 'declined', reason),
        agentId: null,
        offers: j.offers.map((o) =>
          o.id === offerId ? { ...o, status: 'declined' as const, reasonCode: reason, decidedAt: now } : o,
        ),
      }),
      result: ok(null),
    };
  });
}
export function giveUpJob(
  agentId: string,
  jobId: string,
  reason: DeliveryGiveUpReason,
  note: string | undefined,
  version: number,
): Res {
  if (reason === 'other' && !note) return fail('NOTE_REQUIRED');
  return change((s, now) => {
    const j = s.jobs.find((x) => x.id === jobId);
    if (j?.agentId !== agentId) return fail('NOT_FOUND');
    if (j.status !== 'accepted' || j.version !== version) return fail('JOB_CHANGED');
    return {
      state: withJob(s, {
        ...moveJob(j, 'needs_agent', 'delivery_agent', now, 'given_up', reason),
        agentId: null,
        offers: j.offers.map((o) =>
          o.status === 'accepted'
            ? { ...o, status: 'given_up' as const, reasonCode: reason, decidedAt: now }
            : o,
        ),
      }),
      result: ok(null),
    };
  });
}

export type CodeStep =
  | { ok: true; attemptsLeft: number; locked: false; status: DeliveryJobStatus }
  | {
      ok: false;
      code: 'WRONG_CODE' | 'CODE_LOCKED';
      attemptsLeft: number;
      locked: boolean;
      status: DeliveryJobStatus;
    }
  | { ok: false; code: string };

function startDelivery(orderCode: string): void {
  writeOrder(orderCode, (o) => ({
    ...o,
    stage: STAGE_OUT,
    delivery: { code: fourDigits(), attempts: 0, confirmedAt: null, method: null },
  }));
}

export function pickupJob(
  agentId: string,
  jobId: string,
  code: string,
  photo: string | null,
  version: number,
): CodeStep {
  sweepExpiredOffers();
  const s = deliveryState();
  const j = s.jobs.find((x) => x.id === jobId);
  if (j?.agentId !== agentId) return fail('NOT_FOUND');
  if (j.status !== 'accepted' || j.version !== version) return fail('JOB_CHANGED');
  if (s.settings.photosRequired && !photo) return fail('PHOTO_REQUIRED');
  if (j.pickupAttempts >= HANDOVER_CODE_MAX_ATTEMPTS)
    return { ok: false, code: 'CODE_LOCKED', attemptsLeft: 0, locked: true, status: j.status };
  const now = new Date().toISOString();
  if (code !== j.pickupCode) {
    const attempts = j.pickupAttempts + 1;
    // A wrong guess never bumps the job version (like the arrival code), so the agent can type again.
    save(withJob(s, { ...j, pickupAttempts: attempts }));
    const left = HANDOVER_CODE_MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      code: left === 0 ? 'CODE_LOCKED' : 'WRONG_CODE',
      attemptsLeft: left,
      locked: left === 0,
      status: j.status,
    };
  }
  const moved = moveJob(j, 'picked_up', 'delivery_agent', now, 'picked_up');
  save(withJob(s, { ...moved, photos: photo ? [...j.photos, { purpose: 'pickup', at: now }] : j.photos }));
  startDelivery(j.orderCode);
  return { ok: true, attemptsLeft: HANDOVER_CODE_MAX_ATTEMPTS, locked: false, status: 'picked_up' };
}

/** The customer's existing delivery code (same 5-try rule as the shop's code entry today). */
export function deliverJob(
  agentId: string,
  jobId: string,
  code: string,
  photo: string | null,
  version: number,
): CodeStep {
  const s = deliveryState();
  const j = s.jobs.find((x) => x.id === jobId);
  if (j?.agentId !== agentId) return fail('NOT_FOUND');
  if (j.status !== 'picked_up' || j.version !== version) return fail('JOB_CHANGED');
  if (s.settings.photosRequired && !photo) return fail('PHOTO_REQUIRED');
  const o = findOrder(j.orderCode);
  const d = o?.delivery;
  if (!o || !d) return fail('JOB_CHANGED');
  if (d.attempts >= HANDOVER_CODE_MAX_ATTEMPTS)
    return { ok: false, code: 'CODE_LOCKED', attemptsLeft: 0, locked: true, status: j.status };
  const now = new Date().toISOString();
  if (code !== d.code) {
    const attempts = d.attempts + 1;
    writeOrder(o.code, (x) => ({ ...x, delivery: { ...d, attempts } }));
    const left = HANDOVER_CODE_MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      code: left === 0 ? 'CODE_LOCKED' : 'WRONG_CODE',
      attemptsLeft: left,
      locked: left === 0,
      status: j.status,
    };
  }
  const moved = moveJob(j, 'delivered', 'delivery_agent', now, 'delivered');
  save(withJob(s, { ...moved, photos: photo ? [...j.photos, { purpose: 'delivery', at: now }] : j.photos }));
  writeOrder(o.code, (x) => ({
    ...x,
    stage: STAGE_DELIVERED,
    delivery: { ...d, confirmedAt: now, method: 'code' },
  }));
  return { ok: true, attemptsLeft: HANDOVER_CODE_MAX_ATTEMPTS, locked: false, status: 'delivered' };
}

export function failJob(
  agentId: string,
  jobId: string,
  reason: DeliveryFailReason,
  note: string | undefined,
  photo: string | null,
  version: number,
): Res {
  if (reason === 'other' && !note) return fail('NOTE_REQUIRED');
  return change((s, now) => {
    const j = s.jobs.find((x) => x.id === jobId);
    if (j?.agentId !== agentId) return fail('NOT_FOUND');
    if (j.status !== 'picked_up' || j.version !== version) return fail('JOB_CHANGED');
    if (s.settings.photosRequired && !photo) return fail('PHOTO_REQUIRED');
    return {
      state: withJob(s, {
        ...moveJob(j, 'failed', 'delivery_agent', now, 'failed', reason),
        failReason: reason,
        photos: photo ? [...j.photos, { purpose: 'failure', at: now }] : j.photos,
      }),
      result: ok(null),
    };
  });
}

export function setOnline(agentId: string, online: boolean, version: number): Res {
  return change((s) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) return fail('NOT_FOUND');
    if (a.status !== 'active') return fail('AGENT_NOT_ACTIVE');
    if (a.version !== version) return fail('JOB_CHANGED');
    return { state: withAgent(s, { ...a, online, version: a.version + 1 }), result: ok(null) };
  });
}

export function saveAgentDocument(agentId: string, kind: AgentDocumentKind, raw: string): Res {
  const problem = documentNumberProblem(kind, raw);
  if (problem === 'aadhaar') return fail('DOCUMENT_AADHAAR');
  if (problem) return fail('DOCUMENT_FORMAT');
  return change((s, now) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) return fail('NOT_FOUND');
    const doc: DemoAgentDoc = {
      kind,
      number: normaliseDocumentNumber(kind, raw),
      status: 'submitted',
      rejectReason: null,
      submittedAt: now,
    };
    return {
      state: withAgent(s, {
        ...a,
        documents: [...a.documents.filter((d) => d.kind !== kind), doc],
        version: a.version + 1,
      }),
      result: ok(null),
    };
  });
}

export function decideDocument(
  agentId: string,
  kind: AgentDocumentKind,
  verify: boolean,
  reason?: AgentDocumentRejectReason,
): Res {
  return change((s) => {
    const a = s.agents.find((x) => x.id === agentId);
    const d = a?.documents.find((x) => x.kind === kind);
    if (!a || !d) return fail('NOT_FOUND');
    if (!verify && !reason) return fail('REASON_REQUIRED');
    return {
      state: withAgent(s, {
        ...a,
        documents: a.documents.map((x) =>
          x.kind === kind
            ? {
                ...x,
                status: verify ? ('verified' as const) : ('rejected' as const),
                rejectReason: verify ? null : (reason ?? null),
              }
            : x,
        ),
        version: a.version + 1,
      }),
      result: ok(null),
    };
  });
}

export function setAgentStatus(
  agentId: string,
  status: AgentStatus,
  version: number,
  reasonCode?: AgentStatusReason,
  note?: string,
): Res {
  return change((s, now) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) return fail('NOT_FOUND');
    if (a.version !== version) return fail('JOB_CHANGED');
    if (!agentStatusMachine.can(a.status, status)) return fail('JOB_CHANGED');
    if (status !== 'active' && !reasonCode) return fail('REASON_REQUIRED');
    if (
      status === 'active' &&
      a.documents.filter((d) => d.status === 'verified').length < AGENT_DOCUMENT_KINDS.length
    )
      return fail('DOCUMENTS_NOT_VERIFIED');
    return {
      state: withAgent(s, {
        ...a,
        status,
        statusReason: status === 'active' ? null : (reasonCode ?? null),
        online: status === 'active' ? a.online : false,
        history: [
          ...a.history,
          {
            at: now,
            fromStatus: a.status,
            toStatus: status,
            reasonCode: reasonCode ?? null,
            note: note ?? null,
          },
        ],
        version: a.version + 1,
      }),
      result: ok(null),
    };
  });
}
export function editAgentVehicle(agentId: string, vehicleType: AgentVehicleType, version: number): Res {
  return change((s) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) return fail('NOT_FOUND');
    if (a.version !== version) return fail('JOB_CHANGED');
    return { state: withAgent(s, { ...a, vehicleType, version: a.version + 1 }), result: ok(null) };
  });
}

// ── applications and invites ───────────────────────────────────────────────────────────────────────────────────────

export function applyAsAgent(input: {
  name: string;
  phone: string;
  cityCode: string;
  vehicleType: AgentVehicleType;
}): { code: string } {
  const code = publicCode('PA', input.cityCode);
  const now = new Date().toISOString();
  const s = deliveryState();
  save({
    ...s,
    applications: [
      {
        code,
        ...input,
        name: input.name.trim().slice(0, 80),
        status: 'new',
        rejectReason: null,
        createdAt: now,
      },
      ...s.applications,
    ],
  });
  return { code };
}
export const agentApplication = (code: string) => deliveryState().applications.find((a) => a.code === code);
export function rejectAgentApplication(code: string, reason: string): Res {
  return change((s) => {
    const a = s.applications.find((x) => x.code === code);
    if (!a) return fail('NOT_FOUND');
    if (a.status !== 'new') return fail('JOB_CHANGED');
    return {
      state: {
        ...s,
        applications: s.applications.map((x) =>
          x.code === code ? { ...x, status: 'rejected' as const, rejectReason: reason } : x,
        ),
      },
      result: ok(null),
    };
  });
}

const INVITE_HOURS = 72;
export function inviteAgent(
  input:
    | { applicationCode: string }
    | { name: string; phone: string; email?: string; cityCode: string; vehicleType: AgentVehicleType },
): Res<{ id: string; token: string; expiresAt: string }> {
  return change((s, now) => {
    const from =
      'applicationCode' in input ? s.applications.find((a) => a.code === input.applicationCode) : null;
    if ('applicationCode' in input && from?.status !== 'new') return fail('NOT_FOUND');
    const base = from ?? (input as Exclude<typeof input, { applicationCode: string }>);
    if (s.invites.some((i) => i.phone === base.phone && i.status === 'sent')) return fail('INVITE_OPEN');
    if (s.agents.some((a) => a.phone === base.phone)) return fail('ALREADY_AGENT');
    const invite: DemoAgentInvite = {
      id: newId(),
      token: token(),
      name: base.name,
      phone: base.phone,
      email: 'email' in base ? (base.email ?? null) : null,
      cityCode: base.cityCode,
      vehicleType: base.vehicleType,
      status: 'sent',
      applicationCode: from?.code ?? null,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + INVITE_HOURS * 3_600_000).toISOString(),
    };
    return {
      state: {
        ...s,
        invites: [invite, ...s.invites],
        applications: from
          ? s.applications.map((a) => (a.code === from.code ? { ...a, status: 'invited' as const } : a))
          : s.applications,
      },
      result: ok({ id: invite.id, token: invite.token, expiresAt: invite.expiresAt }),
    };
  });
}
export function revokeInvite(id: string): Res {
  return change((s) => {
    const i = s.invites.find((x) => x.id === id);
    if (!i) return fail('NOT_FOUND');
    if (i.status !== 'sent') return fail('JOB_CHANGED');
    return {
      state: {
        ...s,
        invites: s.invites.map((x) => (x.id === id ? { ...x, status: 'revoked' as const } : x)),
      },
      result: ok(null),
    };
  });
}
const inviteStatus = (i: DemoAgentInvite): AgentInviteStatus =>
  i.status === 'sent' && Date.parse(i.expiresAt) <= Date.now() ? 'expired' : i.status;
export const agentInvites = () => deliveryState().invites.map((i) => ({ ...i, status: inviteStatus(i) }));

export function previewInvite(tokenValue: string) {
  const i = deliveryState().invites.find((x) => x.token === tokenValue);
  if (!i || inviteStatus(i) !== 'sent') return null;
  return {
    name: i.name,
    cityCode: i.cityCode,
    phoneLast4: i.phone.slice(-4),
    vehicleType: i.vehicleType,
    expiresAt: i.expiresAt,
  };
}

/** The signed-in account takes the invite: the OTP-proven phone must equal the invite's; the account becomes an agent. */
export function acceptInvite(
  tokenValue: string,
  account: Pick<DemoAccount, 'id' | 'phone'>,
): Res<{ agentId: string; status: AgentStatus }> {
  const res = change<{ agentId: string; status: AgentStatus }>((s, now) => {
    const i = s.invites.find((x) => x.token === tokenValue);
    if (!i) return fail('NOT_FOUND');
    if (inviteStatus(i) === 'expired') return fail('INVITE_EXPIRED');
    if (i.status !== 'sent') return fail('NOT_FOUND');
    if (i.phone !== account.phone) return fail('INVITE_PHONE_MISMATCH');
    const agent: DemoAgent = {
      id: newId(),
      accountId: account.id,
      name: i.name,
      phone: i.phone,
      cityCode: i.cityCode,
      vehicleType: i.vehicleType,
      status: 'onboarding',
      statusReason: null,
      online: false,
      lat: 21.2514,
      lng: 81.6296,
      documents: [],
      history: [{ at: now, fromStatus: null, toStatus: 'onboarding', reasonCode: null, note: null }],
      createdAt: now,
      version: 0,
    };
    return {
      state: {
        ...s,
        agents: [...s.agents, agent],
        invites: s.invites.map((x) => (x.id === i.id ? { ...x, status: 'used' as const } : x)),
      },
      result: ok({ agentId: agent.id, status: agent.status }),
    };
  });
  if (res.ok) promoteAccount(account.id);
  return res;
}
/** The demo account now lands on the agent portal (the API grants the `delivery_agent` role the same way). */
function promoteAccount(accountId: string): void {
  const stored = read(KEYS.accounts, isAccount);
  const base = stored.find((a) => a.id === accountId) ?? SEEDED_ACCOUNTS.find((a) => a.id === accountId);
  if (base?.role !== 'customer') return;
  write(KEYS.accounts, [...stored.filter((a) => a.id !== accountId), { ...base, role: 'delivery_agent' }]);
}

// ── ratings (founder 2026-11-26) ───────────────────────────────────────────────────────────────────────────────────

export function rateDelivery(orderCode: string, stars: number, reasons: RatingReason[], note?: string): Res {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail('BAD_RATING');
  if (reasons.includes('other') && !note) return fail('NOTE_REQUIRED');
  return change((s, now) => {
    const j = s.jobs.find((x) => x.orderCode === orderCode && x.status === 'delivered');
    if (!j?.agentId) return fail('NOT_FOUND');
    const prior = s.ratings.find((r) => r.jobId === j.id);
    if (prior && Date.parse(prior.editableUntil) <= Date.parse(now)) return fail('RATING_LOCKED');
    const row: DemoRating = {
      jobId: j.id,
      agentId: j.agentId,
      stars,
      reasons: [...new Set(reasons)],
      note: note ?? null,
      createdAt: prior?.createdAt ?? now,
      editableUntil: prior?.editableUntil ?? new Date(Date.parse(now) + 86_400_000).toISOString(),
    };
    return {
      state: { ...s, ratings: [...s.ratings.filter((r) => r.jobId !== j.id), row] },
      result: ok(null),
    };
  });
}
export function agentRating(agentId: string): { avg: number | null; count: number } {
  const rows = deliveryState().ratings.filter((r) => r.agentId === agentId);
  if (rows.length === 0) return { avg: null, count: 0 };
  return {
    avg: Math.round((rows.reduce((n, r) => n + r.stars, 0) / rows.length) * 10) / 10,
    count: rows.length,
  };
}

// ── views (contract shapes, `@mechdost/shared/delivery/api`) ───────────────────────────────────────────────────────

export function agentProfile(agentId: string) {
  const s = deliveryState();
  const a = s.agents.find((x) => x.id === agentId);
  if (!a) return null;
  return {
    id: a.id,
    firstName: firstName(a.name),
    cityCode: a.cityCode,
    vehicleType: a.vehicleType,
    status: a.status,
    statusReason: a.statusReason,
    online: a.online,
    canReceiveOffers: a.status === 'active' && a.online && s.settings.agentsEnabled,
    documents: a.documents.map((d) => ({
      kind: d.kind,
      status: d.status,
      numberMasked: maskDocumentNumber(d.number),
      rejectReason: d.rejectReason,
      submittedAt: d.submittedAt,
    })),
    missingDocuments: AGENT_DOCUMENT_KINDS.filter(
      (k) => !a.documents.some((d) => d.kind === k && d.status !== 'rejected'),
    ),
    rating: agentRating(a.id).avg,
    version: a.version,
  };
}

function card(s: DeliveryState, j: DemoJob, agentId: string | null) {
  const o = findOrder(j.orderCode);
  const shop = findShop(j.shopSlug);
  const agent = s.agents.find((x) => x.id === agentId);
  const offer = openOffer(j);
  const mine = offer && (agentId === null || offer.agentId === agentId) ? offer : null;
  return {
    jobId: j.id,
    orderCode: j.orderCode,
    status: j.status,
    offerId: mine?.id ?? null,
    offerExpiresAt: mine?.expiresAt ?? null,
    itemCount: o?.lines.reduce((n, l) => n + l.qty, 0) ?? 0,
    loadClass: o ? loadOf(o) : ('light' as LoadClass),
    weightKg: null,
    shopArea: shop?.area ?? null,
    customerPincode: o?.customer.pincode ?? '',
    distanceM: agent && shop ? distanceM(agent, shop) : null,
    attempt: j.attempt,
    updatedAt: j.statusAt,
  };
}
export type AgentJobView = 'offers' | 'active' | 'done';
export function agentJobs(agentId: string, view: AgentJobView) {
  const s = deliveryState();
  const list = s.jobs.filter((j) => {
    if (view === 'offers') return j.status === 'offered' && openOffer(j)?.agentId === agentId;
    if (view === 'active') return j.agentId === agentId && HELD.includes(j.status);
    return j.offers.some((o) => o.agentId === agentId && o.status === 'accepted') && !isActiveJob(j);
  });
  return list.toSorted((a, b) => b.statusAt.localeCompare(a.statusAt)).map((j) => card(s, j, agentId));
}

/** One job for this agent, contacts by stage (Lead's call 6); null (= 404) for a job never offered to them. */
export function agentJobDetail(agentId: string, jobId: string, locale: string) {
  const s = deliveryState();
  const j = s.jobs.find((x) => x.id === jobId);
  const everHeld = j?.offers.some((o) => o.agentId === agentId && o.status === 'accepted') ?? false;
  if (!j || !(agentMaySee(j, agentId) || everHeld)) return null;
  // A job this agent no longer holds shows codes only.
  const stage = j.agentId === agentId || openOffer(j)?.agentId === agentId ? contactStage(j.status) : 'none';
  const o = findOrder(j.orderCode);
  const found = findShop(j.shopSlug);
  const shop = found ? localizeShop(found, locale) : null;
  const shopBlock =
    shop && stage !== 'none'
      ? {
          name: shop.name,
          addressLine: shop.area,
          pincode: shop.pincode,
          phone: shopPhone(j.shopSlug),
          lat: shop.lat,
          lng: shop.lng,
        }
      : null;
  const area = o ? areaOfPin(o.customer.pincode, locale) : null;
  const customer =
    !o || stage === 'none' || stage === 'return'
      ? null
      : stage === 'pickup'
        ? { area, pincode: o.customer.pincode, name: null, addressLine: null, landmark: null, phone: null }
        : {
            area,
            pincode: o.customer.pincode,
            name: o.customer.name,
            addressLine: o.customer.address,
            landmark: null,
            phone: o.customer.phone,
          };
  return {
    ...card(s, j, agentId),
    items: (o?.lines ?? []).map((l) => ({
      name: `${l.brand} ${productNameFor(l.slug, l.name, locale)}`,
      quantity: l.qty,
    })),
    contact: { stage, shop: shopBlock, customer },
    returnCode: j.status === 'returning' && j.agentId === agentId ? j.returnCode : null,
    photosRequired: s.settings.photosRequired,
    pickupLocked: j.pickupAttempts >= HANDOVER_CODE_MAX_ATTEMPTS,
    deliveryLocked: (o?.delivery?.attempts ?? 0) >= HANDOVER_CODE_MAX_ATTEMPTS,
    failReason: j.failReason,
    version: j.version,
  };
}

/** Shop phone numbers come from the shop's seeded owner login (demo): agents call the shop at pickup. */
function shopPhone(slug: string): string {
  return SEEDED_ACCOUNTS.find((a) => a.partner === slug)?.phone ?? '9000000000';
}
const PIN_AREA: Record<string, string> = {
  '492001': 'Civil Lines',
  '492004': 'Pandri',
  '492006': 'Telibandha',
  '492007': 'Shankar Nagar',
  '492099': 'Tatibandh',
};
function areaOfPin(pin: string, locale: string): string | null {
  const area = PIN_AREA[pin] ?? DEMO_SHOPS.find((x) => x.pincode === pin)?.area;
  return area ? localizeArea(area, locale) : null;
}

/** The customer's block (Lead's call 7): stage, the agent's first name and vehicle; never the shop or a phone. */
export function customerDelivery(orderCode: string) {
  const s = deliveryState();
  const jobs = s.jobs.filter((j) => j.orderCode === orderCode);
  const j = jobs.at(-1);
  if (!j || j.status === 'cancelled') return null;
  const agent = s.agents.find((a) => a.id === j.agentId);
  const o = findOrder(orderCode);
  const failed = jobs.some((x) => x.failReason);
  const stage =
    o?.returned || j.status === 'returned'
      ? 'returned'
      : j.status === 'delivered'
        ? 'delivered'
        : j.status === 'failed'
          ? 'attempt_failed'
          : j.status === 'returning'
            ? j.returnOutcome === 'retry'
              ? 'retrying'
              : 'returning'
            : j.status === 'picked_up'
              ? failed
                ? 'retrying'
                : 'picked_up'
              : j.status === 'accepted'
                ? 'agent_assigned'
                : failed
                  ? 'retrying'
                  : 'finding_agent';
  const named =
    ['agent_assigned', 'picked_up', 'retrying', 'delivered'].includes(stage) && agent && j.agentId;
  const rating = s.ratings.find((r) => r.jobId === j.id) ?? null;
  return {
    stage,
    agentFirstName: named ? firstName(agent.name) : null,
    vehicleType: named ? agent.vehicleType : null,
    failReason:
      stage === 'attempt_failed' || stage === 'returned'
        ? (jobs.findLast((x) => x.failReason)?.failReason ?? null)
        : null,
    refund: o?.returned?.refund ?? null,
    rating: rating
      ? {
          stars: rating.stars,
          reasons: rating.reasons,
          note: rating.note,
          editableUntil: rating.editableUntil,
        }
      : null,
    canRate: j.status === 'delivered' && (!rating || Date.parse(rating.editableUntil) > Date.now()),
  };
}

export type AdminJobView = 'needs_agent' | 'offered' | 'active' | 'failed' | 'returning' | 'done';
const VIEW_STATES: Record<AdminJobView, readonly DeliveryJobStatus[]> = {
  needs_agent: ['needs_agent'],
  offered: ['offered'],
  active: ['accepted', 'picked_up'],
  failed: ['failed'],
  returning: ['returning'],
  done: ['delivered', 'returned', 'cancelled'],
};
function adminRow(s: DeliveryState, j: DemoJob, locale = 'en') {
  const o = findOrder(j.orderCode);
  const shop = findShop(j.shopSlug);
  const agent = s.agents.find((a) => a.id === (j.agentId ?? openOffer(j)?.agentId));
  return {
    jobId: j.id,
    orderCode: j.orderCode,
    cityCode: 'RPR',
    status: j.status,
    orderStatus: orderStatusOf(o, j),
    shopName: shop ? localizeShop(shop, locale).name : j.shopSlug,
    customerPincode: o?.customer.pincode ?? '',
    agent: agent ? { id: agent.id, name: agent.name, vehicleType: agent.vehicleType } : null,
    offerExpiresAt: openOffer(j)?.expiresAt ?? null,
    loadClass: o ? loadOf(o) : ('light' as LoadClass),
    weightKg: null,
    attempt: j.attempt,
    failReason: j.failReason,
    waitingMin: Math.max(0, Math.floor((Date.now() - Date.parse(j.statusAt)) / 60_000)),
    version: j.version,
  };
}
function orderStatusOf(o: DemoOrder | undefined, j: DemoJob) {
  if (!o) return 'packed' as const;
  if (o.returned) return 'returned' as const;
  if (o.stage >= STAGE_DELIVERED) return 'delivered' as const;
  if (o.stage === STAGE_OUT) return 'out_for_delivery' as const;
  return isActiveJob(j) ? ('ready_for_pickup' as const) : ('packed' as const);
}
export function adminJobs(view: AdminJobView, locale = 'en') {
  const s = deliveryState();
  return s.jobs
    .filter((j) => VIEW_STATES[view].includes(j.status))
    .toSorted((a, b) => a.statusAt.localeCompare(b.statusAt))
    .map((j) => adminRow(s, j, locale));
}
export function adminJob(jobId: string, locale = 'en') {
  const s = deliveryState();
  const j = s.jobs.find((x) => x.id === jobId);
  if (!j) return null;
  const o = findOrder(j.orderCode);
  const shop = findShop(j.shopSlug);
  const load = o ? loadOf(o) : 'light';
  const suggestions = s.agents
    .filter((a) => a.status === 'active' && a.online)
    .map((a) => ({
      agentId: a.id,
      name: a.name,
      vehicleType: a.vehicleType,
      distanceM: shop ? distanceM(a, shop) : null,
      activeJobs: heldBy(s, a.id),
      acceptanceRateBp: acceptanceBp(s, a.id),
      carriesLoad: vehicleCarries(
        a.vehicleType,
        { knownWeightG: 0, unknownClass: load },
        s.settings.maxLoadKg,
      ),
    }))
    .toSorted(
      (a, b) =>
        Number(b.carriesLoad) - Number(a.carriesLoad) ||
        a.activeJobs - b.activeJobs ||
        (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9),
    );
  return {
    ...adminRow(s, j, locale),
    suggestions,
    events: j.events,
    offers: j.offers.map((x) => ({
      id: x.id,
      agentName: s.agents.find((a) => a.id === x.agentId)?.name ?? '',
      status: x.status,
      reasonCode: x.reasonCode,
      createdAt: x.createdAt,
      decidedAt: x.decidedAt,
    })),
    photos: j.photos.map((p) => ({ purpose: p.purpose, url: '', at: p.at })),
    pickupLocked: j.pickupAttempts >= HANDOVER_CODE_MAX_ATTEMPTS,
    deliveryLocked: (o?.delivery?.attempts ?? 0) >= HANDOVER_CODE_MAX_ATTEMPTS,
    retryAllowed: retryAllowed({ failedAttempts: j.attempt, maxAttempts: s.settings.maxAttempts }),
  };
}
/** Every job of one order, oldest first (admin order detail → job timeline). */
export function adminJobsForOrder(orderCode: string, locale = 'en') {
  return deliveryState()
    .jobs.filter((j) => j.orderCode === orderCode)
    .map((j) => adminJob(j.id, locale))
    .filter((x) => x !== null);
}
function acceptanceBp(s: DeliveryState, agentId: string): number | null {
  const offers = s.jobs.flatMap((j) =>
    j.offers.filter((o) => o.agentId === agentId && o.status !== 'offered'),
  );
  if (offers.length === 0) return null;
  return Math.round(
    (offers.filter((o) => o.status === 'accepted' || o.status === 'given_up').length / offers.length) *
      10_000,
  );
}

export function adminAgents() {
  const s = deliveryState();
  return s.agents.map((a) => adminAgentRow(s, a));
}
function adminAgentRow(s: DeliveryState, a: DemoAgent) {
  const r = agentRating(a.id);
  return {
    id: a.id,
    name: a.name,
    phoneMasked: `••••••${a.phone.slice(-4)}`,
    cityCode: a.cityCode,
    vehicleType: a.vehicleType,
    status: a.status,
    statusReason: a.statusReason,
    online: a.online,
    activeJobs: heldBy(s, a.id),
    documentsVerified: a.documents.filter((d) => d.status === 'verified').length,
    ratingAvg: r.avg,
    ratingCount: r.count,
    createdAt: a.createdAt,
    version: a.version,
  };
}
export function adminAgent(id: string) {
  const s = deliveryState();
  const a = s.agents.find((x) => x.id === id);
  if (!a) return null;
  const since = Date.now() - 30 * 86_400_000;
  const offers = s.jobs.flatMap((j) =>
    j.offers.filter((o) => o.agentId === id && Date.parse(o.createdAt) >= since),
  );
  const held = s.jobs.filter((j) => j.agentId === id);
  return {
    ...adminAgentRow(s, a),
    documents: agentProfile(id)?.documents ?? [],
    history: a.history,
    kpis: {
      offers30d: offers.length,
      accepted30d: offers.filter((o) => o.status === 'accepted' || o.status === 'given_up').length,
      delivered30d: held.filter((j) => j.status === 'delivered').length,
      failed30d: held.filter((j) => j.failReason).length,
    },
  };
}
/** Audited staff view of one document (demo: the stored number; photos are never kept in the browser). */
export function adminDocument(id: string, kind: AgentDocumentKind) {
  const d = deliveryState()
    .agents.find((a) => a.id === id)
    ?.documents.find((x) => x.kind === kind);
  return d ? { kind, number: d.number, photoUrl: '', status: d.status } : null;
}
export const agentApplications = () => deliveryState().applications;
