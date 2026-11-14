import { z } from '@hono/zod-openapi';
import type { ServiceRequestSummary, ServiceRequestView } from '@mechdost/db/repo';
import { SERVICE_CODE_RE, SERVICE_SLOTS } from '@mechdost/shared/service-requests';
import { SERVICE_MODES, SERVICE_REQUEST_STATES } from '@mechdost/shared/state';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { ErrorSchema } from './schemas';

/**
 * OpenAPI response schemas and serializers shared by the workshop, service-request, workshop-portal and admin
 * routes (spec 06). Dates leave the API as ISO strings; money as integer paise.
 */
export const Locale = z.enum(['en', 'hi']).default('en');

export const RequestCode = z
  .string()
  .regex(SERVICE_CODE_RE)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'SR-RPR-2026-7K3Q9X' });

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

export const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});

export const conflict = {
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Changed meanwhile or not allowed at this step'),
  422: json(ErrorSchema, 'A business rule was not met'),
};

export const Changed = z
  .object({ status: z.enum(SERVICE_REQUEST_STATES), version: z.number().int() })
  .openapi('ServiceRequestChanged');

const Hours = z.object({ open: z.string(), close: z.string(), days: z.array(z.number().int()) });

const MenuItem = z.object({
  key: z.string(),
  title: z.string(),
  included: z.string().nullable(),
  lowPaise: z.number().int(),
  highPaise: z.number().int(),
  minMinutes: z.number().int(),
  maxMinutes: z.number().int(),
  vehicleType: z.enum(VEHICLE_TYPES).nullable(),
  homeAvailable: z.boolean(),
});

export const PublicWorkshop = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    area: z.string(),
    address: z.string(),
    pincode: z.string(),
    lat: z.number(),
    lng: z.number(),
    distanceKm: z.number(),
    vehicleTypes: z.array(z.enum(VEHICLE_TYPES)),
    evBasic: z.boolean(),
    pickup: z.boolean(),
    hours: Hours,
    ratingAvg: z.number().nullable(),
    ratingCount: z.number().int(),
    gstRegistered: z.boolean(),
    home: z.object({ radiusKm: z.number().int(), visitFeePaise: z.number().int() }).nullable(),
    services: z.array(MenuItem),
    /** Only on one workshop's page: days of the labour promise while it is on (admin setting), else null. */
    labourPromiseDays: z.number().int().nullable().optional(),
  })
  .openapi('PublicWorkshop');

const Line = z.object({
  key: z.string(),
  title: z.string(),
  lowPaise: z.number().int(),
  highPaise: z.number().int(),
});

export const RequestSummary = z
  .object({
    code: z.string(),
    status: z.enum(SERVICE_REQUEST_STATES),
    version: z.number().int(),
    workshop: z.object({ slug: z.string(), name: z.string() }).nullable(),
    vehicle: z.object({ type: z.enum(VEHICLE_TYPES), text: z.string() }),
    services: z.array(Line),
    preferredDate: z.string(),
    preferredSlot: z.enum(SERVICE_SLOTS),
    pincode: z.string(),
    waitingForCustomer: z.boolean(),
    serviceMode: z.enum(SERVICE_MODES),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ServiceRequestSummary');

export const RequestPage = z.object({ items: z.array(RequestSummary), nextCursor: z.string().nullable() });

export const toSummaryJson = (s: ServiceRequestSummary) => ({
  ...s,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const RequestDetail = z
  .object({
    code: z.string(),
    status: z.enum(SERVICE_REQUEST_STATES),
    version: z.number().int(),
    serviceMode: z.enum(SERVICE_MODES),
    home: z
      .object({
        visitFeePaise: z.number().int(),
        gstRegistered: z.boolean(),
        feeWaivedReason: z.string().nullable(),
        mechanicName: z.string().nullable(),
        address: z
          .object({ line1: z.string(), line2: z.string().nullable(), landmark: z.string().nullable() })
          .nullable(),
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
      })
      .nullable(),
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
    vehicle: z.object({ type: z.enum(VEHICLE_TYPES), text: z.string(), vehicleId: z.string().nullable() }),
    services: z.array(Line),
    concern: z.string().nullable(),
    pincode: z.string(),
    preferredDate: z.string(),
    preferredSlot: z.enum(SERVICE_SLOTS),
    pickup: z.boolean(),
    odometerKm: z.number().int().nullable(),
    reasonCode: z.string().nullable(),
    customerMessage: z.string().nullable(),
    proposal: z
      .object({
        id: z.string(),
        date: z.string(),
        slot: z.enum(SERVICE_SLOTS),
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
        items: z.array(
          z.object({
            id: z.string(),
            lineNo: z.number().int(),
            description: z.string(),
            serviceKey: z.string().nullable(),
            qty: z.number().int(),
            unitPaise: z.number().int(),
            gstRateBp: z.number().int(),
            decision: z.enum(['pending', 'approved', 'declined']),
          }),
        ),
      })
      .nullable(),
    bill: z
      .object({
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
        labourPromiseDays: z.number().int().nullable(),
        paidAt: z.string().nullable(),
        method: z.string().nullable(),
      })
      .nullable(),
    customer: z.object({ name: z.string().nullable(), phone: z.string().nullable() }).nullable(),
    timeline: z.array(
      z.object({ from: z.string().nullable(), to: z.string(), actor: z.string(), at: z.string() }),
    ),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ServiceRequestDetail');

export const toDetailJson = (v: ServiceRequestView) => ({
  ...v,
  bill: v.bill
    ? {
        ...v.bill,
        billedAt: v.bill.billedAt.toISOString(),
        paidAt: v.bill.paidAt ? v.bill.paidAt.toISOString() : null,
      }
    : null,
  timeline: v.timeline.map((e) => ({ ...e, at: e.at.toISOString() })),
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});
