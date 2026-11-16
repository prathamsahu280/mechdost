import {
  ESTIMATE_SENDABLE_FROM,
  SERVICE_CUSTOMER_CANCELLABLE,
  type ServiceRequestStatus,
} from '@mechdost/shared/state';
import type { VehicleType } from '@mechdost/shared/vehicles';

/**
 * Pure view helpers for the workshop and service-request screens in real-API mode (Stream E, 2026-11-14): status →
 * step and label, what each side may do next, API error code → message key, expected-cost ranges, durations and
 * opening hours. Shared by the customer, workshop-portal and admin screens; no React, no Zod (unit-tested in
 * `test/service-views.test.ts`).
 */

// ── Customer stepper ────────────────────────────────────────────────────────────────────────────────────────────

/** The customer's stepper (spec 06 UI), the same steps as the demo (`request.step_*`). */
export const CUSTOMER_STEPS = [
  'requested',
  'confirmed',
  'received',
  'estimate',
  'in_progress',
  'ready',
  'billed',
  'completed',
] as const;

const STEP_INDEX: Partial<Record<ServiceRequestStatus, number>> = {
  requested: 0,
  needs_routing: 0,
  awaiting_workshop: 0,
  proposed: 0,
  confirmed: 1,
  vehicle_received: 2,
  estimate_sent: 3,
  approved: 4,
  in_progress: 4,
  ready: 5,
  billed: 6,
  paid: CUSTOMER_STEPS.length,
  completed: CUSTOMER_STEPS.length,
};

/** Index of the current step; `null` for outcomes shown as a box instead (cancelled, rejected, no work). */
export function customerStepIndex(status: ServiceRequestStatus): number | null {
  return STEP_INDEX[status] ?? null;
}

/** `request.*` key naming a status in lists and badges (existing demo labels where they fit). */
export function requestStatusKey(status: ServiceRequestStatus): string {
  switch (status) {
    case 'requested':
    case 'awaiting_workshop':
      return 'stage_requested';
    case 'needs_routing':
      return 'api_stage_needs_routing';
    case 'vehicle_received':
      return 'stage_received';
    case 'paid':
      return 'stage_completed';
    case 'cancelled':
      return 'cancelledTitle';
    case 'rejected':
      return 'api_stage_rejected';
    default:
      return `stage_${status}`;
  }
}

export function customerMayCancel(status: ServiceRequestStatus): boolean {
  return (SERVICE_CUSTOMER_CANCELLABLE as readonly string[]).includes(status);
}

// ── Workshop job card ───────────────────────────────────────────────────────────────────────────────────────────

export type WorkshopAction =
  | 'propose'
  | 'wait_customer'
  | 'receive'
  | 'estimate'
  | 'wait_approval'
  | 'start'
  | 'ready'
  | 'bill'
  | 'paid'
  | 'return';

/** The one next step a workshop takes for a request in this status (the API checks the same machine). */
export function workshopNextAction(status: ServiceRequestStatus): WorkshopAction | null {
  switch (status) {
    case 'awaiting_workshop':
      return 'propose';
    case 'proposed':
      return 'wait_customer';
    case 'confirmed':
      return 'receive';
    case 'vehicle_received':
      return 'estimate';
    case 'estimate_sent':
      return 'wait_approval';
    case 'approved':
      return 'start';
    case 'in_progress':
      return 'ready';
    case 'ready':
      return 'bill';
    case 'billed':
      return 'paid';
    case 'no_work_approved':
      return 'return';
    default:
      return null;
  }
}

/** A revised estimate may be sent from these states (never while the customer is deciding; spec 06). */
export function workshopMayRevise(status: ServiceRequestStatus): boolean {
  return status !== 'vehicle_received' && (ESTIMATE_SENDABLE_FROM as readonly string[]).includes(status);
}

/** API path segment of a one-click job step. */
export const STEP_PATH = {
  start: 'start',
  ready: 'ready',
  bill: 'bill',
  return: 'return-vehicle',
} as const;

// ── Money and ranges ────────────────────────────────────────────────────────────────────────────────────────────

/** Sum of the low and high ends of the requested services. */
export function rangeOf(lines: readonly { lowPaise: number; highPaise: number }[]): {
  low: number;
  high: number;
} {
  return {
    low: lines.reduce((s, l) => s + l.lowPaise, 0),
    high: lines.reduce((s, l) => s + l.highPaise, 0),
  };
}

/** "Services from" a workshop's cheapest menu line, or null for an empty menu. */
export function fromPaise(services: readonly { lowPaise: number }[]): number | null {
  if (services.length === 0) return null;
  return Math.min(...services.map((s) => s.lowPaise));
}

/** Menu lines a vehicle type can book (`null` vehicle type = every type the workshop serves). */
export function servicesFor<T extends { vehicleType: VehicleType | null }>(
  services: readonly T[],
  vehicle: VehicleType,
): T[] {
  return services.filter((s) => s.vehicleType === null || s.vehicleType === vehicle);
}

/** "18" for 1800 bp, "2.5" for 250 bp (as `service-estimate.tsx`, without its demo imports). */
export const ratePct = (bp: number) => String(bp / 100);

/** Whole rupees typed by a person → paise; null when not a whole non-negative amount up to ₹10,00,000. */
export function rupeesToPaise(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, '');
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n <= 1_000_000 ? n * 100 : null;
}

/** Odometer text → km (commas and spaces allowed); null when not a whole number up to the API's maximum. */
export function parseOdometerKm(text: string): number | null {
  const t = text.replace(/[,\s]/g, '');
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n <= 2_000_000 ? n : null;
}

// ── Durations and opening hours ─────────────────────────────────────────────────────────────────────────────────

/** A menu line's time as minutes (under 2 h) or hours rounded to the half hour. */
export function durationParts(
  minMinutes: number,
  maxMinutes: number,
): {
  unit: 'min' | 'h';
  min: string;
  max: string;
} {
  if (maxMinutes < 120) return { unit: 'min', min: String(minMinutes), max: String(maxMinutes) };
  const h = (m: number) => String(Math.round(m / 30) / 2);
  return { unit: 'h', min: h(minMinutes), max: h(maxMinutes) };
}

/** Short weekday names in the page language, 0 = Sunday (2026-11-15 was a Sunday). */
function weekday(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 10, 15 + day)));
}

/** "Mon–Sat" / "Mon, Wed, Fri": runs of consecutive days (Monday first) joined with a dash. */
export function daysLabel(days: readonly number[], locale: string): string {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
  if (order.length === 7) return `${weekday(1, locale)}–${weekday(0, locale)}`;
  const runs: number[][] = [];
  for (const d of order) {
    const last = runs.at(-1);
    const prev = last?.at(-1);
    const pos = (x: number) => (x === 0 ? 7 : x);
    if (last && prev !== undefined && pos(d) === pos(prev) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .flatMap((r) => {
      const first = r[0];
      const end = r.at(-1);
      if (first === undefined || end === undefined) return [];
      if (r.length >= 3) return [`${weekday(first, locale)}–${weekday(end, locale)}`];
      return r.map((d) => weekday(d, locale));
    })
    .join(', ');
}

// ── Error codes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** API error codes the service screens explain in their own words (`request.api_err_*`, en + hi). */
export const SERVICE_ERROR_CODES = [
  'NETWORK',
  'UNAVAILABLE',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'VERIFICATION_REQUIRED',
  'STAFF_2FA_REQUIRED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'VALIDATION',
  'STALE_REQUEST',
  'WRONG_STEP',
  'PHOTOS_REQUIRED',
  'DATE_OUT_OF_RANGE',
  'PINCODE_NOT_SERVED',
  'PINCODE_UNKNOWN',
  'WORKSHOP_OUT_OF_AREA',
  'VEHICLE_NOT_SERVED',
  'UNKNOWN_SERVICE',
  'CONCERN_REQUIRED',
  'NO_PROPOSAL',
  'STALE_ESTIMATE',
  'DECISION_INCOMPLETE',
  'NO_WORKSHOP',
  'WORKSHOP_NOT_ACTIVE',
  'RANGE',
  'ODOMETER_BELOW_LAST',
  'ESTIMATE_LINE',
  'NO_APPROVED_ESTIMATE',
  'NO_APPROVED_LINES',
  'ALREADY_PAID',
  'SAME_WORKSHOP',
  'WORKSHOP_NOT_ELIGIBLE',
  'MENU_KEY_DUPLICATE',
  'SLUG_TAKEN',
  'STALE_WORKSHOP',
  'SAME_STANDING',
  'BILL_NOT_PAYABLE',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PAYABLE_CHANGED',
  'SIGNATURE_INVALID',
  'PAYMENT_PROVIDER_MISMATCH',
] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

const ALIASES: Record<string, ServiceErrorCode> = {
  CONFLICT: 'STALE_REQUEST',
  RETRY: 'STALE_REQUEST',
  SERIALIZATION_FAILURE: 'STALE_REQUEST',
  CODE_COLLISION: 'STALE_REQUEST',
  ILLEGAL_TRANSITION: 'WRONG_STEP',
  ACTOR_NOT_ALLOWED: 'FORBIDDEN',
  SCOPE_REQUIRED: 'FORBIDDEN',
  HTTP_400: 'VALIDATION',
  HTTP_401: 'AUTH_REQUIRED',
  HTTP_403: 'FORBIDDEN',
  HTTP_404: 'NOT_FOUND',
  HTTP_429: 'RATE_LIMITED',
};

/** `request.*` key explaining an API error code (unknown codes → a generic "did not work"). */
export function serviceErrorKey(code: string): string {
  const known = (SERVICE_ERROR_CODES as readonly string[]).includes(code)
    ? code
    : (ALIASES[code] ?? (/^HTTP_5\d\d$/.test(code) ? 'UNAVAILABLE' : null));
  return known ? `api_err_${known}` : 'api_err_generic';
}

/** The last odometer reading the API reported with `ODOMETER_BELOW_LAST` (`details.lastKm`). */
export function lastKmFrom(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('lastKm' in details)) return null;
  const { lastKm } = details;
  return typeof lastKm === 'number' && Number.isFinite(lastKm) ? lastKm : null;
}

/** The estimate line the API refused with `ESTIMATE_LINE` (`details.line`, 1-based) and its field. */
export function badLineFrom(
  details: unknown,
): { line: number; field: 'description' | 'qty' | 'price' | 'gst' } | null {
  if (typeof details !== 'object' || details === null) return null;
  const line = 'line' in details ? details.line : undefined;
  const field = 'field' in details ? details.field : undefined;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return null;
  return field === 'description' || field === 'qty' || field === 'price' || field === 'gst'
    ? { line, field }
    : null;
}

// ── Estimates ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The body's `decisions` for the current estimate: every line decided, in line order. `missing` is the first line
 * without a choice (nothing is pre-chosen for the customer).
 */
export function estimateDecisions(
  items: readonly { id: string }[],
  choices: Readonly<Record<string, 'approved' | 'declined'>>,
):
  | { ok: true; decisions: { itemId: string; decision: 'approved' | 'declined' }[] }
  | { ok: false; missing: string } {
  const decisions: { itemId: string; decision: 'approved' | 'declined' }[] = [];
  for (const it of items) {
    const d = choices[it.id];
    if (!d) return { ok: false, missing: it.id };
    decisions.push({ itemId: it.id, decision: d });
  }
  return { ok: true, decisions };
}

// ── Admin routing ───────────────────────────────────────────────────────────────────────────────────────────────

interface RoutableWorkshop {
  id: string;
  slug: string;
  pincode: string;
  vehicleTypes: readonly VehicleType[];
  status: string;
  published: boolean;
  locationVerified: boolean;
  busy: boolean;
}

/**
 * Workshops staff may send a request to, as the API allows (bookable: published, location verified, approved
 * standing, not busy; serves the vehicle type; not the current one). Same PIN code first, then by name order given.
 * The API still decides (`WORKSHOP_NOT_ELIGIBLE` / `WORKSHOP_OUT_OF_AREA` when the city differs).
 */
export function routableWorkshops<T extends RoutableWorkshop>(
  workshops: readonly T[],
  request: { vehicleType: VehicleType; pincode: string; workshopSlug: string | null },
): T[] {
  const ok = workshops.filter(
    (w) =>
      w.status === 'approved' &&
      w.published &&
      w.locationVerified &&
      !w.busy &&
      w.vehicleTypes.includes(request.vehicleType) &&
      w.slug !== request.workshopSlug,
  );
  return [
    ...ok.filter((w) => w.pincode === request.pincode),
    ...ok.filter((w) => w.pincode !== request.pincode),
  ];
}

/** A fresh Idempotency-Key for one booking attempt (the API accepts 16–64 of `[A-Za-z0-9_-]`). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** `YYYY-MM-DD` in India today, plus `days`. */
export function istDate(days = 0, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() + days * 86_400_000));
}

/**
 * The server refuses an hour that has already started today (IST); the picker leaves those hours out (QA 2026-11-16,
 * bug 5). Built on `Intl` like `istDate`: importing the shared IST helpers here split the first-load chunks of every
 * page (+0.5 KB gz, JS budget 2026-11-16). India has no daylight saving, so the hour is exact.
 */
export function hourHasStarted(date: string, hour: number, now: Date): boolean {
  const istHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(
      now,
    ),
  );
  return date === istDate(0, now) && hour <= istHour;
}

/** "Request sent to …" is the headline only while the request waits for a proposal (QA 2026-11-16, bug 7). */
export function thanksHeadlineShown(status: ServiceRequestStatus): boolean {
  return status === 'requested' || status === 'needs_routing' || status === 'awaiting_workshop';
}

/** "Ready for pickup" needs an after photo when the admin requires photos (the API answers PHOTOS_REQUIRED otherwise). */
export function afterPhotoMissing(photos: {
  required: boolean;
  photos: readonly { stage: string }[];
}): boolean {
  return photos.required && !photos.photos.some((p) => p.stage === 'after');
}
