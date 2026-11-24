/**
 * DEMO ROADSIDE ASSISTANCE (spec 22): one sample request that the customer page, the admin queue and the workshop
 * portal all read, so the browser demo shows the whole flow without the API. Kept in this browser only (nothing is
 * sent anywhere, no real payment or message). The rules mirror the API: the advance is snapshotted when the request is
 * made, the balance is max(total - advance, 0), a total under the advance raises a refund request that waits for
 * approval, and only an admin cancels, and only before a workshop accepted.
 */
import {
  defaultRsaSettings,
  rsaBalancePaise,
  rsaLineTotalPaise,
  rsaOverpaidPaise,
} from '@mechdost/shared/rsa';
import type { RsaProblemType } from '@mechdost/shared/rsa';
import type { RsaStatus } from '@mechdost/shared/state';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { useSyncExternalStore } from 'react';
import type {
  RoadsideAvailability,
  RoadsideJob,
  RoadsideOffer,
  RoadsideQueueItem,
  RoadsideSuggestion,
  RoadsideView,
} from '@/lib/roadside';

const KEY = 'mechdost-demo-roadside-v1';
const DEMO_PINS = ['492001', '492004', '492009'];
const DEMO_WORKSHOP = { name: 'Raipur Auto Care', nameHi: 'रायपुर ऑटो केयर' };
const DEMO_RESPONDER = { workshopName: DEMO_WORKSHOP.name, workshopNameHi: DEMO_WORKSHOP.nameHi };
export const DEMO_ARRIVAL_CODE = '4821';

export interface Demo {
  code: string;
  status: RsaStatus;
  version: number;
  vehicleType: VehicleType;
  problemType: RsaProblemType | null;
  pincode: string;
  advancePaise: number;
  paid: boolean;
  cancelReason: string | null;
  lines: { kind: string; description: string; quantity: number; unitPricePaise: number }[];
  totalPaise: number | null;
  method: string | null;
  refunds: RoadsideView['refunds'];
  timeline: { status: RsaStatus; at: string }[];
  offerExpiresAt: string | null;
}

let cache: Demo | null | undefined;
const listeners = new Set<() => void>();

function load(): Demo | null {
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Demo) : null;
  } catch {
    cache = null;
  }
  return cache;
}

function save(next: Demo | null): void {
  cache = next;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: the demo keeps working for this page view.
  }
  for (const l of listeners) l();
}

function move(d: Demo, to: RsaStatus, patch: Partial<Demo> = {}): Demo {
  return {
    ...d,
    ...patch,
    status: to,
    version: d.version + 1,
    timeline: [...d.timeline, { status: to, at: new Date().toISOString() }],
  };
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The sample request, or null; `undefined` until the browser store was read. */
export function useDemoRoadside(): Demo | null {
  return useSyncExternalStore(subscribe, load, () => null);
}

export function demoAvailability(pincode: string): RoadsideAvailability {
  const s = defaultRsaSettings();
  const ok = DEMO_PINS.includes(pincode);
  return {
    available: ok,
    reason: ok ? null : 'RSA_OUT_OF_AREA',
    cityCode: ok ? 'RPR' : null,
    centroid: ok ? { lat: 21.2514, lng: 81.6296 } : null,
    vehicleTypes: s.vehicleTypes,
    advancePaise: s.advancePaise,
    problemTypes: s.problemTypes,
    sosPhone: '+917978776551',
  };
}

export function demoCreate(input: {
  vehicleType: VehicleType;
  problemType: RsaProblemType | null;
  pincode: string;
}): { ok: true; code: string } | { ok: false; code: string } {
  const open = load();
  if (open && open.status !== 'completed' && open.status !== 'cancelled')
    return { ok: false, code: 'RSA_ALREADY_OPEN' };
  const a = demoAvailability(input.pincode);
  if (!a.available) return { ok: false, code: a.reason ?? 'RSA_OUT_OF_AREA' };
  const advancePaise = a.advancePaise[input.vehicleType];
  if (advancePaise === undefined) return { ok: false, code: 'RSA_VEHICLE_NOT_OFFERED' };
  const code = `RSA-RPR-2026-DEMO${String(Math.floor(Math.random() * 90) + 10)}`;
  save({
    code,
    status: 'awaiting_payment',
    version: 1,
    vehicleType: input.vehicleType,
    problemType: input.problemType,
    pincode: input.pincode,
    advancePaise,
    paid: false,
    cancelReason: null,
    lines: [],
    totalPaise: null,
    method: null,
    refunds: [],
    timeline: [{ status: 'awaiting_payment', at: new Date().toISOString() }],
    offerExpiresAt: null,
  });
  return { ok: true, code };
}

/** Each demo step does what the API does for that actor and refuses a wrong step (returns false). */
export function demoStep(
  action:
    | { kind: 'pay_advance' }
    | { kind: 'offer' }
    | { kind: 'accept' }
    | { kind: 'decline' }
    | { kind: 'expire' }
    | { kind: 'en_route' }
    | { kind: 'arrive'; code: string }
    | { kind: 'start' }
    | { kind: 'bill'; lines: Demo['lines'] }
    | { kind: 'pay_balance' }
    | { kind: 'cash' }
    | { kind: 'cancel'; reason: string }
    | { kind: 'reset' },
): boolean {
  const d = load();
  if (action.kind === 'reset') {
    save(null);
    return true;
  }
  if (!d) return false;
  const is = (...s: RsaStatus[]) => s.includes(d.status);
  switch (action.kind) {
    case 'pay_advance':
      if (!is('awaiting_payment')) return false;
      save(move(d, 'requested', { paid: true }));
      return true;
    case 'offer':
      if (!is('requested')) return false;
      save(move(d, 'offered', { offerExpiresAt: new Date(Date.now() + 150_000).toISOString() }));
      return true;
    case 'accept':
      if (!is('offered')) return false;
      save(move(d, 'accepted', { offerExpiresAt: null }));
      return true;
    case 'decline':
    case 'expire':
      if (!is('offered')) return false;
      save(move(d, 'requested', { offerExpiresAt: null }));
      return true;
    case 'en_route':
      if (!is('accepted')) return false;
      save(move(d, 'en_route'));
      return true;
    case 'arrive':
      if (!is('accepted', 'en_route') || action.code !== DEMO_ARRIVAL_CODE) return false;
      save(move(d, 'arrived'));
      return true;
    case 'start':
      if (!is('arrived')) return false;
      save(move(d, 'in_progress'));
      return true;
    case 'bill': {
      if (!is('in_progress') || action.lines.length === 0) return false;
      const total = action.lines.reduce((n, l) => n + rsaLineTotalPaise(l.quantity, l.unitPricePaise), 0);
      if (total <= 0) return false;
      const balance = rsaBalancePaise(total, d.advancePaise);
      const over = rsaOverpaidPaise(total, d.advancePaise);
      const billed = move(d, 'billed', { lines: action.lines, totalPaise: total });
      save(
        balance === 0
          ? move(billed, 'completed', {
              method: 'none',
              refunds: over > 0 ? [{ amountPaise: over, stage: 'under_review' }] : [],
            })
          : billed,
      );
      return true;
    }
    case 'pay_balance':
    case 'cash':
      if (!is('billed')) return false;
      save(move(d, 'completed', { method: action.kind === 'cash' ? 'cash' : 'online' }));
      return true;
    case 'cancel':
      if (!is('requested', 'offered')) return false;
      save(
        move(d, 'cancelled', {
          cancelReason: action.reason,
          refunds: [{ amountPaise: d.advancePaise, stage: 'under_review' }],
        }),
      );
      return true;
    default:
      return false;
  }
}

export function demoView(d: Demo): RoadsideView {
  const total = d.totalPaise;
  const bill =
    total === null
      ? null
      : {
          lines: d.lines.map((l) => ({ ...l, totalPaise: rsaLineTotalPaise(l.quantity, l.unitPricePaise) })),
          totalPaise: total,
          advancePaise: d.advancePaise,
          balancePaise: rsaBalancePaise(total, d.advancePaise),
          overpaidPaise: rsaOverpaidPaise(total, d.advancePaise),
          balanceMethod: d.method,
        };
  const attached = ['accepted', 'en_route', 'arrived', 'in_progress', 'billed', 'completed'].includes(
    d.status,
  );
  return {
    code: d.code,
    status: d.status,
    version: d.version,
    vehicleType: d.vehicleType,
    problemType: d.problemType,
    pincode: d.pincode,
    advancePaise: d.advancePaise,
    advancePaid: d.paid,
    cancelReason: d.cancelReason,
    responder: attached ? DEMO_RESPONDER : null,
    arrivalCode: d.status === 'accepted' || d.status === 'en_route' ? DEMO_ARRIVAL_CODE : null,
    bill,
    timeline: d.timeline,
    refunds: d.refunds,
  };
}

export function demoQueue(d: Demo | null): RoadsideQueueItem[] {
  if (!d || d.status === 'awaiting_payment') return [];
  return [
    {
      code: d.code,
      status: d.status,
      version: d.version,
      vehicleType: d.vehicleType,
      problemType: d.problemType,
      pincode: d.pincode,
      waitingSeconds: Math.max(
        0,
        Math.round((Date.now() - new Date(d.timeline[0]?.at ?? Date.now()).getTime()) / 1000),
      ),
      workshopName: ['offered', 'accepted', 'en_route', 'arrived', 'in_progress', 'billed'].includes(d.status)
        ? DEMO_WORKSHOP.name
        : null,
      offerExpiresAt: d.offerExpiresAt,
      attempts: d.status === 'requested' ? 0 : 1,
    },
  ];
}

export const DEMO_SUGGESTIONS: readonly RoadsideSuggestion[] = [
  { workshopId: 'demo-w1', ...DEMO_WORKSHOP, distanceM: 1200, acceptRate: 0.9 },
  {
    workshopId: 'demo-w2',
    name: 'Shankar Nagar Garage',
    nameHi: 'शंकर नगर गैराज',
    distanceM: 3100,
    acceptRate: 0.7,
  },
];

export function demoOffers(d: Demo | null): RoadsideOffer[] {
  if (d?.status !== 'offered' || !d.offerExpiresAt) return [];
  return [
    {
      code: d.code,
      vehicleType: d.vehicleType,
      problemType: d.problemType,
      pincode: d.pincode,
      addressLine: null,
      distanceM: 1200,
      expiresAt: d.offerExpiresAt,
    },
  ];
}

export function demoJobs(d: Demo | null): RoadsideJob[] {
  if (!d || !['accepted', 'en_route', 'arrived', 'in_progress', 'billed'].includes(d.status)) return [];
  return [
    {
      code: d.code,
      status: d.status,
      version: d.version,
      vehicleType: d.vehicleType,
      problemType: d.problemType,
      pincode: d.pincode,
      addressLine: null,
      lat: 21.2514,
      lng: 81.6296,
      advancePaise: d.advancePaise,
      totalPaise: d.totalPaise,
      balancePaise: d.totalPaise === null ? null : rsaBalancePaise(d.totalPaise, d.advancePaise),
    },
  ];
}
