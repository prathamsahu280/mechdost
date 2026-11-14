/**
 * Workshops and service requests (spec 06): the request DTOs shared by the API and the web, so both validate the
 * same way (Zod at every boundary, hard rule 4). Responses are described by the API's OpenAPI document.
 * Money in integer paise; times as ISO strings; reason and status values are codes (hard rule 16).
 */
import { z } from 'zod';
import { ESTIMATE_GST_RATES_BP, ESTIMATE_MAX_LINES, ESTIMATE_MAX_UNIT_PAISE } from './service-bill';
import {
  MOVE_REASONS,
  MOVE_TRANSPORTS,
  SERVICE_CANCEL_REASONS,
  SERVICE_DECLINE_REASONS,
  SERVICE_MODES,
  SERVICE_REJECT_REASONS,
  VISIT_FEE_WAIVE_REASONS,
} from './state';
import { VEHICLE_TYPES } from './vehicles';

/** Part of the day the customer prefers or the workshop proposes (the demo's three slots). */
export const SERVICE_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type ServiceSlot = (typeof SERVICE_SLOTS)[number];

/** How the workshop was chosen: by the customer, or "Let MechDost choose" (admin routes it). */
export const SERVICE_ROUTING_MODES = ['chosen', 'mechdost'] as const;
export type ServiceRoutingMode = (typeof SERVICE_ROUTING_MODES)[number];

/** How a bill was settled at the workshop. */
export const SERVICE_PAYMENT_METHODS = ['cash', 'upi', 'card'] as const;
export type ServicePaymentMethod = (typeof SERVICE_PAYMENT_METHODS)[number];

export { ESTIMATE_SENDABLE_FROM, SERVICE_CUSTOMER_CANCELLABLE } from './state';

export const NEARBY_DEFAULT_RADIUS_KM = 15;
export const NEARBY_MAX_RADIUS_KM = 50;
export const MAX_REQUEST_SERVICES = 8;
export const MAX_MENU_ITEMS = 40;
export const ODOMETER_MAX_KM = 2_000_000;
/** Home servicing bounds (spec 06): travel radius in km and the visit fee in paise (the per-city setting caps it further). */
export const HOME_RADIUS_MIN_KM = 1;
export const HOME_RADIUS_MAX_KM = 25;
export const HOME_RADIUS_DEFAULT_KM = 5;
export const HOME_FEE_MAX_PAISE = 50_000;
export const HOME_FEE_DEFAULT_PAISE = 9_900;
export const ARRIVAL_CODE_RE = /^\d{4}$/;

export const SERVICE_CODE_RE = /^SR-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;
export const WORKSHOP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SERVICE_KEY_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const paise = z
  .number()
  .int()
  .min(0)
  .max(ESTIMATE_MAX_UNIT_PAISE * 10);
const isoDate = z
  .string()
  .regex(DATE_RE)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'invalid date');

const HomeRadius = z.number().int().min(HOME_RADIUS_MIN_KM).max(HOME_RADIUS_MAX_KM);
const HomeFee = z.number().int().min(0).max(HOME_FEE_MAX_PAISE);

/** Opening hours: one window on the listed weekdays (0 = Sunday), times in IST. */
export const WorkshopHoursSchema = z
  .object({
    open: z.string().regex(HHMM_RE),
    close: z.string().regex(HHMM_RE),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })
  .strict()
  .refine((h) => h.open < h.close, { message: 'close must be after open', path: ['close'] })
  .refine((h) => new Set(h.days).size === h.days.length, { message: 'duplicate day', path: ['days'] });
export type WorkshopHours = z.infer<typeof WorkshopHoursSchema>;

/** One line of a workshop's service menu (admin editor). */
export const MenuItemSchema = z
  .object({
    key: z.string().min(2).max(40).regex(SERVICE_KEY_RE),
    title: text(2, 80),
    titleHi: text(2, 80).nullable().optional(),
    included: text(2, 300).nullable().optional(),
    includedHi: text(2, 300).nullable().optional(),
    lowPaise: paise,
    highPaise: paise,
    minMinutes: z.number().int().min(5).max(10_080),
    maxMinutes: z.number().int().min(5).max(10_080),
    /** null: every vehicle type the workshop serves. */
    vehicleType: z.enum(VEHICLE_TYPES).nullable().optional(),
    active: z.boolean().default(true),
    /** Can be done at the customer's home (home servicing). */
    homeAvailable: z.boolean().optional(),
  })
  .strict()
  .refine((m) => m.highPaise >= m.lowPaise, { message: 'high below low', path: ['highPaise'] })
  .refine((m) => m.maxMinutes >= m.minMinutes, { message: 'max below min', path: ['maxMinutes'] });
export type MenuItemInput = z.infer<typeof MenuItemSchema>;

const WorkshopFields = {
  name: text(2, 80),
  nameHi: text(2, 80).nullable().optional(),
  addressLine: text(5, 200),
  addressLineHi: text(5, 200).nullable().optional(),
  area: text(2, 60),
  areaHi: text(2, 60).nullable().optional(),
  pincode: z.string().regex(PINCODE_RE),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z
    .string()
    .regex(/^\+91[6-9][0-9]{9}$/)
    .nullable()
    .optional(),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1).max(3),
  evBasic: z.boolean().default(false),
  pickup: z.boolean().default(false),
  hours: WorkshopHoursSchema,
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .nullable()
    .optional(),
  locationVerified: z.boolean().default(false),
  published: z.boolean().default(false),
};

/** Admin: create a workshop with its menu (the DB starts empty; staff add workshops, spec 08). */
export const CreateWorkshopSchema = z
  .object({
    ...WorkshopFields,
    slug: z.string().min(3).max(80).regex(WORKSHOP_SLUG_RE),
    menu: z.array(MenuItemSchema).max(MAX_MENU_ITEMS).default([]),
  })
  .strict();
export type CreateWorkshopInput = z.infer<typeof CreateWorkshopSchema>;

/** Admin: edit a workshop (any subset of fields; `menu` replaces the whole menu by key). */
export const UpdateWorkshopSchema = z
  .object({
    version: z.number().int().min(1),
    name: WorkshopFields.name.optional(),
    nameHi: WorkshopFields.nameHi,
    addressLine: WorkshopFields.addressLine.optional(),
    addressLineHi: WorkshopFields.addressLineHi,
    area: WorkshopFields.area.optional(),
    areaHi: WorkshopFields.areaHi,
    pincode: WorkshopFields.pincode.optional(),
    lat: WorkshopFields.lat.optional(),
    lng: WorkshopFields.lng.optional(),
    phone: WorkshopFields.phone,
    vehicleTypes: WorkshopFields.vehicleTypes.optional(),
    evBasic: z.boolean().optional(),
    pickup: z.boolean().optional(),
    hours: WorkshopHoursSchema.optional(),
    gstin: WorkshopFields.gstin,
    locationVerified: z.boolean().optional(),
    published: z.boolean().optional(),
    busy: z.boolean().optional(),
    homeService: z.boolean().optional(),
    homeRadiusKm: HomeRadius.optional(),
    homeVisitFeePaise: HomeFee.optional(),
    menu: z.array(MenuItemSchema).max(MAX_MENU_ITEMS).optional(),
  })
  .strict()
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), {
    message: 'lat and lng go together',
    path: ['lng'],
  });
export type UpdateWorkshopInput = z.infer<typeof UpdateWorkshopSchema>;

/** Admin: pause, suspend or reactivate a workshop (reason kept in partner_status_events-style history). */
export const WorkshopStandingSchema = z
  .object({
    status: z.enum(['approved', 'paused', 'suspended']),
    reason: text(5, 300),
    version: z.number().int().min(1),
  })
  .strict();

/** Admin: give a signed-up person access to a workshop's portal. */
export const WorkshopMemberSchema = z
  .object({
    phone: z.string().regex(/^\+91[6-9][0-9]{9}$/),
    role: z.enum(['workshop_owner', 'workshop_staff']),
  })
  .strict();

/** Customer: a new service request (the workshop, or "Let MechDost choose" with `workshopSlug` null). */
export const CreateServiceRequestSchema = z
  .object({
    workshopSlug: z.string().min(3).max(80).regex(WORKSHOP_SLUG_RE).nullable(),
    vehicleType: z.enum(VEHICLE_TYPES),
    /** A saved vehicle of the customer (odometer history follows it), or free text only. */
    vehicleId: z.uuid().nullable().optional(),
    vehicle: text(2, 80),
    /** Menu keys of the chosen workshop (ignored for "Let MechDost choose", which uses the concern). */
    serviceKeys: z
      .array(z.string().min(2).max(40).regex(SERVICE_KEY_RE))
      .max(MAX_REQUEST_SERVICES)
      .default([]),
    concern: text(3, 500).nullable().optional(),
    pincode: z.string().regex(PINCODE_RE),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    preferredDate: isoDate,
    preferredSlot: z.enum(SERVICE_SLOTS),
    pickup: z.boolean().default(false),
    /** Where the service happens; `home` needs a chosen workshop, a pinned saved address and the fee the customer saw. */
    mode: z.enum(SERVICE_MODES).optional(),
    addressId: z.uuid().nullable().optional(),
    visitFeePaise: HomeFee.nullable().optional(),
  })
  .strict()
  .refine(
    (b) =>
      (b.mode ?? 'workshop') === 'workshop' ||
      (b.workshopSlug !== null && Boolean(b.addressId) && !b.pickup && typeof b.visitFeePaise === 'number'),
    {
      message: 'a home visit needs a workshop, a saved address, no pickup and the visit fee',
      path: ['mode'],
    },
  )
  .refine((b) => (b.lat === undefined || b.lat === null) === (b.lng === undefined || b.lng === null), {
    message: 'lat and lng go together',
    path: ['lng'],
  })
  .refine((b) => b.serviceKeys.length > 0 || Boolean(b.concern), {
    message: 'pick a service or describe the concern',
    path: ['concern'],
  });
export type CreateServiceRequestInput = z.infer<typeof CreateServiceRequestSchema>;

export const VersionSchema = z.object({ version: z.number().int().min(1) }).strict();

export const CancelServiceRequestSchema = z
  .object({ reasonCode: z.enum(SERVICE_CANCEL_REASONS), version: z.number().int().min(1) })
  .strict();

/** Customer: accept the workshop's proposal, or turn it down (the workshop proposes again). */
export const ProposalDecisionSchema = z
  .object({ accept: z.boolean(), version: z.number().int().min(1) })
  .strict();

/** Customer: a decision on every line of the current estimate, with consent. */
export const EstimateDecisionSchema = z
  .object({
    revision: z.number().int().min(1),
    version: z.number().int().min(1),
    decisions: z
      .array(z.object({ itemId: z.uuid(), decision: z.enum(['approved', 'declined']) }).strict())
      .min(1)
      .max(ESTIMATE_MAX_LINES),
    consent: z.literal(true),
  })
  .strict()
  .refine((b) => new Set(b.decisions.map((d) => d.itemId)).size === b.decisions.length, {
    message: 'duplicate line',
    path: ['decisions'],
  });
export type EstimateDecisionInput = z.infer<typeof EstimateDecisionSchema>;

/** Workshop: propose a date, slot and expected cost range. */
export const ProposeSchema = z
  .object({
    date: isoDate,
    slot: z.enum(SERVICE_SLOTS),
    lowPaise: paise,
    highPaise: paise,
    note: text(1, 300).nullable().optional(),
    /** First name of the visiting mechanic (required for a home visit; shown to the customer). */
    mechanicName: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u)
      .nullable()
      .optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((p) => p.highPaise >= p.lowPaise, { message: 'high below low', path: ['highPaise'] });

export const WorkshopDeclineSchema = z
  .object({ reasonCode: z.enum(SERVICE_DECLINE_REASONS), version: z.number().int().min(1) })
  .strict();

export const VehicleReceivedSchema = z
  .object({
    odometerKm: z.number().int().min(0).max(ODOMETER_MAX_KM),
    /** Home visits: the code the customer shows at the door. */
    arrivalCode: z.string().regex(ARRIVAL_CODE_RE).optional(),
    version: z.number().int().min(1),
  })
  .strict();

/** Workshop: offer to move a home job to the workshop. */
export const MoveProposalSchema = z
  .object({
    reasonCode: z.enum(MOVE_REASONS),
    transport: z.enum(MOVE_TRANSPORTS),
    version: z.number().int().min(1),
  })
  .strict();

/** Customer: accept or decline the offer to move the job to the workshop. */
export const MoveDecisionSchema = z
  .object({ accept: z.boolean(), version: z.number().int().min(1) })
  .strict();

/** Workshop: waive the home visit fee (the bill keeps the line at 0). */
export const WaiveVisitFeeSchema = z
  .object({ reasonCode: z.enum(VISIT_FEE_WAIVE_REASONS), version: z.number().int().min(1) })
  .strict();

/** Admin: confirm the mechanic's arrival without the code (audited with a reason). */
export const ArrivalOverrideSchema = z
  .object({
    reason: text(5, 300),
    odometerKm: z.number().int().min(0).max(ODOMETER_MAX_KM),
    version: z.number().int().min(1),
  })
  .strict();

/** Workshop portal: the workshop's own home settings and which menu lines it does at home. */
export const HomeSettingsSchema = z
  .object({
    homeService: z.boolean(),
    homeRadiusKm: HomeRadius,
    homeVisitFeePaise: HomeFee,
    homeServiceKeys: z.array(z.string().min(2).max(40).regex(SERVICE_KEY_RE)).max(MAX_MENU_ITEMS),
    version: z.number().int().min(1),
  })
  .strict();
export type HomeSettingsInput = z.infer<typeof HomeSettingsSchema>;

export const EstimateLineSchema = z
  .object({
    description: text(2, 120),
    serviceKey: z.string().min(2).max(40).regex(SERVICE_KEY_RE).nullable().optional(),
    qty: z.number().int().min(1).max(99),
    unitPaise: z.number().int().min(1).max(ESTIMATE_MAX_UNIT_PAISE),
    gstRateBp: z
      .number()
      .int()
      .refine((r) => (ESTIMATE_GST_RATES_BP as readonly number[]).includes(r), 'GST slab'),
  })
  .strict();

export const SendEstimateSchema = z
  .object({
    lines: z.array(EstimateLineSchema).min(1).max(ESTIMATE_MAX_LINES),
    version: z.number().int().min(1),
  })
  .strict();
export type SendEstimateInput = z.infer<typeof SendEstimateSchema>;

export const MarkPaidSchema = z
  .object({ method: z.enum(SERVICE_PAYMENT_METHODS), version: z.number().int().min(1) })
  .strict();

/** Admin: send the request to an eligible workshop (from needs_routing, awaiting_workshop or proposed). */
export const ReassignSchema = z.object({ workshopId: z.uuid(), version: z.number().int().min(1) }).strict();

export const RejectServiceRequestSchema = z
  .object({
    reasonCode: z.enum(SERVICE_REJECT_REASONS),
    message: text(10, 500),
    version: z.number().int().min(1),
  })
  .strict();
