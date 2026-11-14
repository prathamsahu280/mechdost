import type { SavedAddress } from '@mechdost/shared/account-api';
import { VISIT_FEE_GST_RATE_BP } from '@mechdost/shared/service-bill';
import { MOVE_REASONS, MOVE_TRANSPORTS, VISIT_FEE_WAIVE_REASONS } from '@mechdost/shared/state';
import type { HomeVisit, ServiceRequestDetail } from '@mechdost/shared/service-api';
import { workshopNextAction, type WorkshopAction } from './service-views';

/**
 * Pure view helpers for home servicing (spec 06, design 2026-11-15; no React, unit-tested in
 * `test/home-service-views.test.ts`): API error code → `homeService.err_*` key, the visit-fee line, which saved
 * addresses can be used, the arrival-code display, and the next workshop step for a home job.
 */

/** API error codes with their own `homeService.err_*` message (others fall back to `request.api_err_*`). */
export const HOME_ERROR_CODES = [
  'FEE_CHANGED',
  'FEE_ABOVE_CAP',
  'ADDRESS_NOT_PINNED',
  'ADDRESS_REQUIRED',
  'PINCODE_MISMATCH',
  'HOME_NOT_OFFERED',
  'HOME_NEEDS_PIN',
  'WORKSHOP_OUT_OF_RADIUS',
  'SERVICE_NOT_AT_HOME',
  'SERVICE_REQUIRED',
  'MECHANIC_REQUIRED',
  'ARRIVAL_CODE_REQUIRED',
  'ARRIVAL_CODE_FORMAT',
  'ARRIVAL_CODES_UNAVAILABLE',
  'MOVE_PENDING',
  'NO_MOVE',
  'NOT_HOME',
  'VISIT_FEE_DUE',
  'NO_VISIT_FEE',
  'ALREADY_WAIVED',
  'OVERRIDE_REASON',
] as const;

/** `homeService.err_<CODE>` for a home servicing error code; null for any other code. */
export function homeErrorKey(code: string): string | null {
  return (HOME_ERROR_CODES as readonly string[]).includes(code) ? `err_${code}` : null;
}

/** GST on the visit fee when the workshop is registered (shown next to the fee, never a surprise at the bill). */
export function visitFeeGstPaise(feePaise: number, gstRegistered: boolean): number {
  return gstRegistered ? Math.round((feePaise * VISIT_FEE_GST_RATE_BP) / 10_000) : 0;
}

/** Saved addresses that can be used for a home visit: those with a map pin (the API refuses the rest). */
export function pinnedAddresses(list: readonly SavedAddress[]): SavedAddress[] {
  return list.filter((a) => a.lat !== null && a.lng !== null);
}

/** The code split for reading aloud at a door: "4 8 2 1". */
export function spacedCode(code: string): string {
  return code.split('').join(' ');
}

/** Home job whose visit fee will still be charged: not waived and above zero. */
export function visitFeeDue(detail: Pick<ServiceRequestDetail, 'home'>): boolean {
  const h = detail.home;
  return h !== null && h.feeWaivedReason === null && h.visitFeePaise > 0;
}

/** The workshop's next step: as `workshopNextAction`, except a declined move bills the visit fee first. */
export function homeJobNextAction(
  detail: Pick<ServiceRequestDetail, 'status' | 'home'>,
): WorkshopAction | null {
  if (detail.status === 'no_work_approved' && visitFeeDue(detail)) return 'bill';
  return workshopNextAction(detail.status);
}

/** An offer to move the job is waiting for the customer's answer. */
export function pendingMove(home: HomeVisit | null): HomeVisit['move'] {
  return home?.move?.status === 'proposed' ? home.move : null;
}

/** The workshop may offer a move while the job is at the customer's home (arrived, or an estimate is out). */
export function mayOfferMove(detail: Pick<ServiceRequestDetail, 'status' | 'serviceMode' | 'home'>): boolean {
  return (
    detail.serviceMode === 'home' &&
    (detail.status === 'vehicle_received' || detail.status === 'estimate_sent') &&
    pendingMove(detail.home) === null
  );
}

/** The workshop may waive the visit fee until the bill exists. */
export function mayWaiveFee(detail: Pick<ServiceRequestDetail, 'status' | 'home'>): boolean {
  return (
    detail.home !== null &&
    detail.home.feeWaivedReason === null &&
    detail.home.visitFeePaise > 0 &&
    [
      'confirmed',
      'vehicle_received',
      'estimate_sent',
      'approved',
      'no_work_approved',
      'in_progress',
      'ready',
    ].includes(detail.status)
  );
}

export const moveReasonOf = (code: string) => MOVE_REASONS.find((r) => r === code) ?? 'other';
export const moveTransportOf = (code: string) => MOVE_TRANSPORTS.find((r) => r === code) ?? 'customer_drops';
export const waiveReasonOf = (code: string | null) => VISIT_FEE_WAIVE_REASONS.find((r) => r === code) ?? null;

/** A name the workshop enters for the visiting mechanic: 2 to 30 letters, spaces, dots, apostrophes, hyphens. */
export function validMechanicName(raw: string): boolean {
  const v = raw.trim();
  return v.length >= 2 && v.length <= 30 && /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v);
}

/** A visit fee typed in rupees (up to 2 decimals) as paise; null when it is not a plain amount. */
export function feeRupeesToPaise(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  return /^\d{1,3}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
}

/** Radius and fee typed by the workshop owner: whole km 1–25, rupees up to the city maximum. */
export function parseHomeSettingsInput(
  raw: { radiusKm: string; feeRupees: string },
  maxFeePaise: number,
): { ok: true; radiusKm: number; feePaise: number } | { ok: false; field: 'radius' | 'fee' } {
  const km = raw.radiusKm.trim();
  if (!/^\d{1,2}$/.test(km) || Number(km) < 1 || Number(km) > 25) return { ok: false, field: 'radius' };
  const feePaise = feeRupeesToPaise(raw.feeRupees);
  if (feePaise === null || feePaise > maxFeePaise) return { ok: false, field: 'fee' };
  return { ok: true, radiusKm: Number(km), feePaise };
}
