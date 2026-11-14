import {
  MoveProposedDto,
  NearbyWorkshopsDto,
  PublicWorkshopDto,
  ServiceChangedDto,
  ServiceRequestCreatedDto,
  ServiceRequestDetailDto,
  ServiceRequestPageDto,
  type NearbyWorkshops,
  type PublicWorkshop,
  type ServiceRequestDetail,
  type ServiceRequestPage,
} from '@mechdost/shared/service-api';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { authed, call, type ApiResult } from './orders-api';

/**
 * The customer's workshop search and service requests on the MechDost API (real data mode; spec 06). Answers are
 * validated with the shared response schemas (hard rule 4); errors come back as the API's code for the screen to
 * translate (`serviceErrorKey`). Loaded only by the real-mode screens (lazy imports).
 */
const loc = (locale: string) => (locale === 'hi' ? 'hi' : 'en');

export type NearbyQuery =
  | { pincode: string; vehicleType?: VehicleType; ev?: boolean }
  | { lat: number; lng: number; vehicleType?: VehicleType; ev?: boolean; mode?: 'workshop' | 'home' };

/** Bookable workshops near a point or a PIN code, nearest first (public; 422 `PINCODE_UNKNOWN`). */
export function fetchNearbyWorkshops(locale: string, q: NearbyQuery): Promise<ApiResult<NearbyWorkshops>> {
  const p = new URLSearchParams({ locale: loc(locale), radiusKm: '25' });
  if ('pincode' in q) p.set('pincode', q.pincode);
  else {
    p.set('lat', q.lat.toFixed(5));
    p.set('lng', q.lng.toFixed(5));
    if (q.mode === 'home') p.set('mode', 'home');
  }
  if (q.vehicleType) p.set('vehicleType', q.vehicleType);
  if (q.ev) p.set('ev', 'true');
  return call(`/workshops?${p.toString()}`, NearbyWorkshopsDto);
}

/** One bookable workshop (public). 404 when it is not bookable now (paused, busy, unpublished). */
export function fetchWorkshop(locale: string, slug: string): Promise<ApiResult<PublicWorkshop>> {
  return call(`/workshops/${encodeURIComponent(slug)}?locale=${loc(locale)}`, PublicWorkshopDto);
}

export interface NewServiceRequest {
  workshopSlug: string | null;
  vehicleType: VehicleType;
  vehicle: string;
  serviceKeys: string[];
  concern: string | null;
  pincode: string;
  lat: number | null;
  lng: number | null;
  preferredDate: string;
  preferredSlot: 'morning' | 'afternoon' | 'evening';
  pickup: boolean;
  /** Home servicing: `home` needs the saved address (pinned) and the visit fee the customer saw. */
  mode?: 'workshop' | 'home';
  addressId?: string | null;
  visitFeePaise?: number | null;
}

/** Book. The same key for a retry of the same attempt never makes a second request (200 replay). */
export function createServiceRequest(locale: string, body: NewServiceRequest, idempotencyKey: string) {
  return authed(locale, '/service-requests', ServiceRequestCreatedDto, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body,
  });
}

export function fetchMyServiceRequests(
  locale: string,
  cursor?: string,
): Promise<ApiResult<ServiceRequestPage>> {
  const p = new URLSearchParams({ limit: '20', locale: loc(locale) });
  if (cursor) p.set('cursor', cursor);
  return authed(locale, `/service-requests?${p.toString()}`, ServiceRequestPageDto);
}

export function fetchMyServiceRequest(
  locale: string,
  code: string,
): Promise<ApiResult<ServiceRequestDetail>> {
  return authed(
    locale,
    `/service-requests/${encodeURIComponent(code)}?locale=${loc(locale)}`,
    ServiceRequestDetailDto,
  );
}

const act = (locale: string, code: string, step: string, body: unknown) =>
  authed(locale, `/service-requests/${encodeURIComponent(code)}/${step}`, ServiceChangedDto, {
    method: 'POST',
    body,
  });

export function decideProposal(locale: string, code: string, accept: boolean, version: number) {
  return act(locale, code, 'proposal', { accept, version });
}

/** Answer the workshop's offer to move a home job to its workshop. */
export function answerMove(locale: string, code: string, accept: boolean, version: number) {
  return act(locale, code, 'move', { accept, version });
}

export function cancelServiceRequest(locale: string, code: string, reasonCode: string, version: number) {
  return act(locale, code, 'cancel', { reasonCode, version });
}

export function decideServiceEstimate(
  locale: string,
  code: string,
  body: {
    revision: number;
    version: number;
    decisions: { itemId: string; decision: 'approved' | 'declined' }[];
  },
) {
  return act(locale, code, 'estimate', { ...body, consent: true });
}
