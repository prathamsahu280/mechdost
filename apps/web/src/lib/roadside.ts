import type { RsaProblemType, RsaSettings } from '@mechdost/shared/rsa';
import type { RsaStatus } from '@mechdost/shared/state';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { adminApi, type AdminResult, type ResponseSchema } from './admin-api';

/**
 * Roadside assistance on the web (spec 22): the shapes the API sends and the calls the screens make. Real mode calls
 * the API (`adminApi` carries the Firebase token and returns the API's error code); the browser demo has its own store
 * (`@/demo/roadside`) with the same shapes, so the pages are the same in both. Nothing here holds a location after the
 * request page is left.
 */
export interface RoadsideAvailability {
  available: boolean;
  reason: 'RSA_NOT_AVAILABLE' | 'RSA_OUT_OF_AREA' | 'RSA_CLOSED' | null;
  cityCode: string | null;
  centroid: { lat: number; lng: number } | null;
  vehicleTypes: VehicleType[];
  advancePaise: Partial<Record<VehicleType, number>>;
  problemTypes: RsaProblemType[];
  sosPhone: string | null;
}

export interface RoadsideBill {
  lines: {
    kind: string;
    description: string;
    quantity: number;
    unitPricePaise: number;
    totalPaise: number;
  }[];
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  overpaidPaise: number;
  balanceMethod: string | null;
}

export interface RoadsideView {
  code: string;
  status: RsaStatus;
  version: number;
  vehicleType: VehicleType;
  problemType: RsaProblemType | null;
  pincode: string;
  advancePaise: number;
  advancePaid: boolean;
  cancelReason: string | null;
  responder: { workshopName: string; workshopNameHi: string | null } | null;
  arrivalCode: string | null;
  bill: RoadsideBill | null;
  timeline: { status: RsaStatus; at: string }[];
  refunds: {
    amountPaise: number;
    stage: 'under_review' | 'processing' | 'refunded' | 'declined' | 'failed';
  }[];
}

export interface RoadsideQueueItem {
  code: string;
  status: RsaStatus;
  version: number;
  vehicleType: string;
  problemType: string | null;
  pincode: string;
  waitingSeconds: number;
  workshopName: string | null;
  offerExpiresAt: string | null;
  attempts: number;
}

export interface RoadsideSuggestion {
  workshopId: string;
  name: string;
  nameHi: string | null;
  distanceM: number;
  acceptRate: number;
}

export interface RoadsideOffer {
  code: string;
  vehicleType: string;
  problemType: RsaProblemType | null;
  pincode: string;
  addressLine: string | null;
  distanceM: number | null;
  expiresAt: string;
}

export interface RoadsideJob {
  code: string;
  status: RsaStatus;
  version: number;
  vehicleType: string;
  problemType: RsaProblemType | null;
  pincode: string;
  addressLine: string | null;
  lat: number;
  lng: number;
  advancePaise: number;
  totalPaise: number | null;
  balancePaise: number | null;
}

export interface RoadsideOptIn {
  workshopId: string;
  name: string;
  nameHi: string | null;
  enabled: boolean;
  radiusKm: number;
  vehicleTypes: VehicleType[];
  problemTypes: RsaProblemType[];
  towing: boolean;
  version: number;
}

export interface RoadsideWorkshopOverview {
  offers: RoadsideOffer[];
  jobs: RoadsideJob[];
  optIns: RoadsideOptIn[];
}

export type RoadsideSettings = RsaSettings;

/** The API's answer is trusted for its shape only after this object check; the screens read named fields. */
export function shape<T>(): ResponseSchema<T> {
  return {
    safeParse: (v) =>
      typeof v === 'object' && v !== null ? { success: true, data: v as T } : { success: false },
  };
}

export function roadsideCall<T>(
  locale: string,
  path: string,
  init: Parameters<typeof adminApi>[3] = {},
): Promise<AdminResult<T>> {
  return adminApi<T>(locale, path, shape<T>(), init);
}

const KNOWN_ERRORS = [
  'RSA_NOT_AVAILABLE',
  'RSA_OUT_OF_AREA',
  'RSA_CLOSED',
  'RSA_VEHICLE_NOT_OFFERED',
  'RSA_PROBLEM_NOT_OFFERED',
  'RSA_ALREADY_OPEN',
  'RSA_NOT_PAYABLE',
  'PINCODE_NOT_SERVED',
  'AUTH_REQUIRED',
  'STALE_REQUEST',
  'STALE_SETTINGS',
  'WRONG_STEP',
  'OFFER_EXPIRED',
  'WORKSHOP_NOT_ELIGIBLE',
  'ARRIVAL_CODE_WRONG',
  'ARRIVAL_CODE_LOCKED',
  'RSA_PINCODE_UNKNOWN',
  'PAYMENT_METHOD_UNAVAILABLE',
  'NOTHING_TO_PAY',
  'UNAVAILABLE',
  'NETWORK',
] as const;

/** The `roadside.err_*` message key of an API error code (unknown codes get the generic one). */
export function roadsideErrorKey(code: string): string {
  return (KNOWN_ERRORS as readonly string[]).includes(code) ? `err_${code}` : 'err_generic';
}

/** Status steps the customer sees, in order (the side exits are shown as their own state). */
export const CUSTOMER_STEPS = [
  'requested',
  'accepted',
  'arrived',
  'in_progress',
  'billed',
  'completed',
] as const;

/** Where a status sits on the customer's steps (offered and en route belong to the step before them). */
export function stepIndex(status: RsaStatus): number {
  if (status === 'awaiting_payment') return -1;
  if (status === 'requested' || status === 'offered') return 0;
  if (status === 'accepted' || status === 'en_route') return 1;
  if (status === 'cancelled') return 0;
  return CUSTOMER_STEPS.indexOf(status);
}
