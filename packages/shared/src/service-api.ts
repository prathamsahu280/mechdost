/**
 * Response shapes of the workshop and service-request routes (`apps/api/src/routes/workshops.ts`,
 * `service-requests.ts`, `workshop-portal.ts`, `admin-service-requests.ts`, schemas in `service-schemas.ts`), for
 * the website in real-API mode to validate what it receives (hard rule 4). Loaded only by the real-mode screens
 * (lazy imports) and server components, never by demo pages. Money in integer paise; times as ISO strings.
 */
import { z } from 'zod';
import { SERVICE_MODES, SERVICE_REQUEST_STATES } from './state';
import { VEHICLE_TYPES } from './vehicles';

const SLOTS = ['morning', 'afternoon', 'evening'] as const;
const Status = z.enum(SERVICE_REQUEST_STATES);
const Vehicle = z.enum(VEHICLE_TYPES);

// ── Public workshops (/v1/workshops) ──────────────────────────────────────────────────────────────────────────

const Hours = z.object({ open: z.string(), close: z.string(), days: z.array(z.number().int()) });

export const WorkshopMenuItemDto = z.object({
  key: z.string(),
  title: z.string(),
  included: z.string().nullable(),
  lowPaise: z.number().int(),
  highPaise: z.number().int(),
  minMinutes: z.number().int(),
  maxMinutes: z.number().int(),
  vehicleType: Vehicle.nullable(),
  homeAvailable: z.boolean(),
});
export type WorkshopMenuItem = z.infer<typeof WorkshopMenuItemDto>;

export const PublicWorkshopDto = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  area: z.string(),
  address: z.string(),
  pincode: z.string(),
  lat: z.number(),
  lng: z.number(),
  distanceKm: z.number(),
  vehicleTypes: z.array(Vehicle),
  evBasic: z.boolean(),
  pickup: z.boolean(),
  hours: Hours,
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  gstRegistered: z.boolean(),
  /** Home servicing: null when the workshop does not do home visits. */
  home: z.object({ radiusKm: z.number().int(), visitFeePaise: z.number().int() }).nullable(),
  services: z.array(WorkshopMenuItemDto),
  /** Days of the labour promise while it is on (workshop page only; absent or null = no promise). */
  labourPromiseDays: z.number().int().nullable().optional(),
});
export type PublicWorkshop = z.infer<typeof PublicWorkshopDto>;

export const NearbyWorkshopsDto = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  workshops: z.array(PublicWorkshopDto),
});
export type NearbyWorkshops = z.infer<typeof NearbyWorkshopsDto>;

// ── Service requests (customer, workshop and staff views share these) ───────────────────────────────────────

const Line = z.object({
  key: z.string(),
  title: z.string(),
  lowPaise: z.number().int(),
  highPaise: z.number().int(),
});

export const ServiceRequestSummaryDto = z.object({
  code: z.string(),
  status: Status,
  version: z.number().int(),
  workshop: z.object({ slug: z.string(), name: z.string() }).nullable(),
  vehicle: z.object({ type: Vehicle, text: z.string() }),
  services: z.array(Line),
  preferredDate: z.string(),
  preferredSlot: z.enum(SLOTS),
  pincode: z.string(),
  waitingForCustomer: z.boolean(),
  serviceMode: z.enum(SERVICE_MODES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServiceRequestSummary = z.infer<typeof ServiceRequestSummaryDto>;

export const ServiceRequestPageDto = z.object({
  items: z.array(ServiceRequestSummaryDto),
  nextCursor: z.string().nullable(),
});
export type ServiceRequestPage = z.infer<typeof ServiceRequestPageDto>;

export const EstimateItemDto = z.object({
  id: z.string(),
  lineNo: z.number().int(),
  description: z.string(),
  serviceKey: z.string().nullable(),
  qty: z.number().int(),
  unitPaise: z.number().int(),
  gstRateBp: z.number().int(),
  decision: z.enum(['pending', 'approved', 'declined']),
});
export type EstimateItem = z.infer<typeof EstimateItemDto>;

export const ServiceBillDto = z.object({
  lines: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      qty: z.number().int(),
      unitPaise: z.number().int(),
      gstRateBp: z.number().int(),
      taxablePaise: z.number().int(),
      gstPaise: z.number().int(),
      kind: z.literal('visit_fee').optional(),
    }),
  ),
  gstRegistered: z.boolean(),
  taxablePaise: z.number().int(),
  cgstPaise: z.number().int(),
  sgstPaise: z.number().int(),
  roundOffPaise: z.number().int(),
  totalPaise: z.number().int(),
  billedAt: z.string(),
  /** Days of labour promise frozen on the bill; null/absent = none (older bills have no field). */
  labourPromiseDays: z.number().int().nullable().default(null),
  paidAt: z.string().nullable(),
  method: z.string().nullable(),
});
export type ServiceBillView = z.infer<typeof ServiceBillDto>;

/** Home servicing details of a request (null when it was booked at the workshop). */
export const HomeVisitDto = z.object({
  visitFeePaise: z.number().int(),
  gstRegistered: z.boolean(),
  feeWaivedReason: z.string().nullable(),
  mechanicName: z.string().nullable(),
  address: z
    .object({ line1: z.string(), line2: z.string().nullable(), landmark: z.string().nullable() })
    .nullable(),
  /** The customer's own view only, while the visit is confirmed. */
  arrivalCode: z.string().nullable(),
  arrivalLocked: z.boolean(),
  arrivedVia: z.enum(['code', 'override']).nullable(),
  move: z
    .object({
      id: z.string(),
      reasonCode: z.string(),
      transport: z.string(),
      status: z.enum(['proposed', 'accepted', 'declined']),
    })
    .nullable(),
});
export type HomeVisit = z.infer<typeof HomeVisitDto>;

export const ServiceRequestDetailDto = z.object({
  code: z.string(),
  serviceMode: z.enum(SERVICE_MODES),
  home: HomeVisitDto.nullable(),
  status: Status,
  version: z.number().int(),
  routingMode: z.enum(['chosen', 'mechdost']),
  workshop: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      area: z.string(),
      phone: z.string().nullable(),
      ratingAvg: z.number().nullable(),
      ratingCount: z.number().int(),
    })
    .nullable(),
  vehicle: z.object({ type: Vehicle, text: z.string(), vehicleId: z.string().nullable() }),
  services: z.array(Line),
  concern: z.string().nullable(),
  pincode: z.string(),
  preferredDate: z.string(),
  preferredSlot: z.enum(SLOTS),
  pickup: z.boolean(),
  odometerKm: z.number().int().nullable(),
  reasonCode: z.string().nullable(),
  customerMessage: z.string().nullable(),
  proposal: z
    .object({
      id: z.string(),
      date: z.string(),
      slot: z.enum(SLOTS),
      lowPaise: z.number().int(),
      highPaise: z.number().int(),
      note: z.string().nullable(),
      status: z.enum(['pending', 'accepted']),
    })
    .nullable(),
  estimate: z
    .object({
      id: z.string(),
      revision: z.number().int(),
      status: z.enum(['sent', 'decided']),
      items: z.array(EstimateItemDto),
    })
    .nullable(),
  bill: ServiceBillDto.nullable(),
  customer: z.object({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  timeline: z.array(
    z.object({ from: z.string().nullable(), to: z.string(), actor: z.string(), at: z.string() }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServiceRequestDetail = z.infer<typeof ServiceRequestDetailDto>;

/** Every state change answers with the new status and version. */
export const ServiceChangedDto = z.object({ status: Status, version: z.number().int() });
export type ServiceChanged = z.infer<typeof ServiceChangedDto>;
/** `POST …/estimates` also answers with the new revision. */
export const EstimateSentDto = ServiceChangedDto.extend({ revision: z.number().int() });
/** `POST …/vehicle-received`: the arrival check (a wrong or locked code is a 200 with `ok: false`). */
export const ArrivalResultDto = z.object({
  ok: z.boolean(),
  status: Status.optional(),
  version: z.number().int().optional(),
  reason: z.enum(['wrong', 'locked']).optional(),
  attemptsLeft: z.number().int().optional(),
});
export type ArrivalResult = z.infer<typeof ArrivalResultDto>;
/** `POST …/move` (workshop): the offer id with the unchanged status and version. */
export const MoveProposedDto = ServiceChangedDto.extend({ id: z.string() });
/** `GET /v1/workshop/home-settings` and `PUT …/{workshopId}`. */
export const HomeSettingsListDto = z.object({
  workshops: z.array(
    z.object({
      workshopId: z.string(),
      name: z.string(),
      homeService: z.boolean(),
      homeRadiusKm: z.number().int(),
      homeVisitFeePaise: z.number().int(),
      maxFeePaise: z.number().int(),
      gstRegistered: z.boolean(),
      version: z.number().int(),
      services: z.array(
        z.object({
          key: z.string(),
          title: z.string(),
          titleHi: z.string().nullable(),
          homeAvailable: z.boolean(),
        }),
      ),
    }),
  ),
});
export type HomeSettingsList = z.infer<typeof HomeSettingsListDto>;
export const HomeSettingsSavedDto = z.object({ version: z.number().int() });

/** `POST …/bill` also answers with the bill total. */
export const BillCreatedDto = ServiceChangedDto.extend({ totalPaise: z.number().int() });

/** `POST /v1/service-requests` (201 new, 200 replay of the same Idempotency-Key). */
export const ServiceRequestCreatedDto = z.object({
  code: z.string(),
  status: z.string(),
  version: z.number().int(),
});
export type ServiceRequestCreated = z.infer<typeof ServiceRequestCreatedDto>;

// ── Staff workshop management (/v1/admin/workshops) ──────────────────────────────────────────────────────────

export const AdminMenuItemDto = z.object({
  key: z.string(),
  title: z.string(),
  titleHi: z.string().nullable(),
  included: z.string().nullable(),
  includedHi: z.string().nullable(),
  lowPaise: z.number().int(),
  highPaise: z.number().int(),
  minMinutes: z.number().int(),
  maxMinutes: z.number().int(),
  vehicleType: Vehicle.nullable(),
  active: z.boolean(),
  homeAvailable: z.boolean(),
});
export type AdminMenuItem = z.infer<typeof AdminMenuItemDto>;

export const AdminWorkshopDto = z.object({
  id: z.string(),
  cityId: z.string(),
  slug: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
  addressLine: z.string(),
  addressLineHi: z.string().nullable(),
  area: z.string(),
  areaHi: z.string().nullable(),
  pincode: z.string(),
  lat: z.number(),
  lng: z.number(),
  phone: z.string().nullable(),
  vehicleTypes: z.array(Vehicle),
  evBasic: z.boolean(),
  pickup: z.boolean(),
  hours: Hours,
  gstin: z.string().nullable(),
  gstRegistered: z.boolean(),
  locationVerified: z.boolean(),
  published: z.boolean(),
  status: z.enum(['approved', 'paused', 'suspended']),
  statusReason: z.string().nullable(),
  busy: z.boolean(),
  homeService: z.boolean(),
  homeRadiusKm: z.number().int(),
  homeVisitFeePaise: z.number().int(),
  version: z.number().int(),
  missingHindi: z.array(z.string()),
  menu: z.array(AdminMenuItemDto),
});
export type AdminWorkshop = z.infer<typeof AdminWorkshopDto>;

export const AdminWorkshopListDto = z.object({ workshops: z.array(AdminWorkshopDto) });
export const WorkshopSavedDto = z.object({ id: z.string(), version: z.number().int() });
export const WorkshopCreatedDto = WorkshopSavedDto.extend({ slug: z.string() });
export const WorkshopStandingSavedDto = z.object({ status: z.string(), version: z.number().int() });
export const WorkshopMemberAddedDto = z.object({ userId: z.string() });
