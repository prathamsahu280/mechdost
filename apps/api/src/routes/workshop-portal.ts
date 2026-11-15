import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  advanceJob,
  billJob,
  cancelWorkshopChange,
  declineRequest,
  getWorkshopHomeSettings,
  getWorkshopProfiles,
  getWorkshopRequest,
  listSlots,
  listWorkshopRequests,
  markJobPaid,
  markVehicleReceived,
  proposeMove,
  proposeSlot,
  requestWorkshopChange,
  returnVehicle,
  saveWorkshopHomeSettings,
  saveWorkshopProfile,
  setSlotCapacity,
  sendEstimate,
  waiveVisitFee,
  workshopIdsFrom,
} from '@mechdost/db/repo';
import type { Permission } from '@mechdost/shared/rbac';
import {
  HomeSettingsSchema,
  MarkPaidSchema,
  MoveProposalSchema,
  ProposeSchema,
  SendEstimateSchema,
  SlotCapacitySchema,
  VehicleReceivedSchema,
  WaiveVisitFeeSchema,
  VersionSchema,
  WorkshopChangeSchema,
  WorkshopDeclineSchema,
  WorkshopSelfEditSchema,
} from '@mechdost/shared/service-requests';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { SERVICE_REQUEST_STATES } from '@mechdost/shared/state';
import {
  body,
  Changed,
  conflict,
  json,
  Locale,
  RequestCode,
  RequestDetail,
  RequestPage,
  toDetailJson,
  toSummaryJson,
} from './service-schemas';

/**
 * Workshop portal API (spec 06 job card): owners and staff (verified; grants scoped to their workshop) see new
 * requests and their jobs, propose or decline (`service:respond`) and run the job card (`service:work`): vehicle
 * received with the odometer, estimates, start, ready, bill, paid at the workshop, vehicle returned. Every body
 * carries the request `version` (compare-and-set). Another workshop's code is 404.
 */
/** Arrival-code guesses: the database locks the code after 5 wrong tries; this also slows scripted tries. */
/** Filing a pin or GSTIN change for staff review: rare, so a small allowance. */
export const CHANGE_RATE: RateRule = { name: 'workshop_change_user', limit: 10, windowSeconds: 3600 };
export const ARRIVAL_RATE: RateRule = { name: 'workshop_arrival_user', limit: 20, windowSeconds: 600 };

const params = { params: z.object({ code: RequestCode }) };
const sec = [{ bearerAuth: [] }];

const list = createRoute({
  method: 'get',
  path: '/workshop/requests',
  tags: ['workshop'],
  summary: 'New requests (waiting for your proposal), active jobs, or done (last 90 days); newest first',
  security: sec,
  request: {
    query: z.object({
      view: z.enum(['new', 'active', 'done']).default('new'),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      locale: Locale,
    }),
  },
  responses: { 200: json(RequestPage, 'Requests'), ...errorResponses },
});

const detail = createRoute({
  method: 'get',
  path: '/workshop/requests/{code}',
  tags: ['workshop'],
  summary: "One request (the customer's name and phone once the visit is confirmed)",
  security: sec,
  request: { ...params, query: z.object({ locale: Locale }) },
  responses: { 200: json(RequestDetail, 'Request'), ...conflict, ...errorResponses },
});

const action = <T extends z.ZodType>(
  path: string,
  summary: string,
  schema: T,
  name: string,
  extra?: z.ZodRawShape,
) =>
  createRoute({
    method: 'post',
    path: `/workshop/requests/{code}/${path}`,
    tags: ['workshop'],
    summary,
    security: sec,
    request: { ...params, body: body(schema.openapi(name)) },
    responses: {
      200: json(extra ? Changed.extend(extra) : Changed, 'Moved'),
      ...conflict,
      ...errorResponses,
    },
  });

const propose = action(
  'propose',
  'Propose a date, part of the day and expected cost range',
  ProposeSchema,
  'ProposeSlot',
);
const decline = action(
  'decline',
  'Decline with a reason code (the request goes back to MechDost)',
  WorkshopDeclineSchema,
  'DeclineServiceRequest',
);
const received = createRoute({
  method: 'post',
  path: '/workshop/requests/{code}/vehicle-received',
  tags: ['workshop'],
  summary:
    "The vehicle is here (or, for a home visit, the mechanic arrived: enter the customer's arrival code; 5 wrong tries lock it). Record the odometer, never below the last reading",
  security: sec,
  request: { ...params, body: body(VehicleReceivedSchema.openapi('VehicleReceived')) },
  responses: {
    200: json(
      z.object({
        ok: z.boolean(),
        status: z.enum(SERVICE_REQUEST_STATES).optional(),
        version: z.number().int().optional(),
        reason: z.enum(['wrong', 'locked']).optional(),
        attemptsLeft: z.number().int().optional(),
      }),
      'Checked',
    ),
    ...conflict,
    ...errorResponses,
  },
});
const moveOffer = action(
  'move',
  'Offer to move a home job to the workshop (the customer accepts or declines)',
  MoveProposalSchema,
  'ProposeMove',
  { id: z.string() },
);
const waive = action(
  'waive-visit-fee',
  'Waive the home visit fee with a reason code (the bill keeps the line at 0)',
  WaiveVisitFeeSchema,
  'WaiveVisitFee',
);
const homeList = createRoute({
  method: 'get',
  path: '/workshop/home-settings',
  tags: ['workshop'],
  summary: 'Home servicing settings of your workshops (on/off, radius, visit fee, lines done at home)',
  security: sec,
  responses: {
    200: json(
      z.object({
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
      }),
      'Settings',
    ),
    ...errorResponses,
  },
});
const homeSave = createRoute({
  method: 'put',
  path: '/workshop/home-settings/{workshopId}',
  tags: ['workshop'],
  summary:
    "Save one workshop's home servicing settings (compare-and-set on its version; fee within the city limit)",
  security: sec,
  request: {
    params: z.object({ workshopId: z.uuid().openapi({ param: { name: 'workshopId', in: 'path' } }) }),
    body: body(HomeSettingsSchema.openapi('SaveHomeSettings')),
  },
  responses: { 200: json(z.object({ version: z.number().int() }), 'Saved'), ...conflict, ...errorResponses },
});
const WorkshopIdParam = z.object({
  workshopId: z.uuid().openapi({ param: { name: 'workshopId', in: 'path' } }),
});
const Profile = z.object({
  workshopId: z.string(),
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
  hours: z.object({ open: z.string(), close: z.string(), days: z.array(z.number().int()) }),
  gstin: z.string().nullable(),
  locationVerified: z.boolean(),
  published: z.boolean(),
  status: z.enum(['approved', 'paused', 'suspended']),
  busy: z.boolean(),
  slotCapacity: z.number().int(),
  version: z.number().int(),
  missingHindi: z.array(z.string()),
  menu: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      titleHi: z.string().nullable(),
      included: z.string().nullable(),
      includedHi: z.string().nullable(),
      lowPaise: z.number().int(),
      highPaise: z.number().int(),
      minMinutes: z.number().int(),
      maxMinutes: z.number().int(),
      vehicleType: z.enum(['2W', '3W', '4W']).nullable(),
      active: z.boolean(),
      homeAvailable: z.boolean(),
    }),
  ),
  pending: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['location', 'gstin']),
      payload: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
    }),
  ),
});
const profileList = createRoute({
  method: 'get',
  path: '/workshop/profile',
  tags: ['workshop'],
  summary:
    'My workshop: the profile, hours, menu ranges, busy mode and waiting pin or GSTIN requests of your workshops',
  security: sec,
  responses: { 200: json(z.object({ workshops: z.array(Profile) }), 'Profiles'), ...errorResponses },
});
const profileSave = createRoute({
  method: 'put',
  path: '/workshop/profile/{workshopId}',
  tags: ['workshop'],
  summary:
    'Save profile text (English and Hindi), hours, menu ranges, busy mode and default hourly capacity: audited, live at once. The pin and GSTIN are not accepted here',
  security: sec,
  request: { params: WorkshopIdParam, body: body(WorkshopSelfEditSchema.openapi('SaveWorkshopProfile')) },
  responses: { 200: json(z.object({ version: z.number().int() }), 'Saved'), ...conflict, ...errorResponses },
});
const changeFile = createRoute({
  method: 'post',
  path: '/workshop/profile/{workshopId}/changes',
  tags: ['workshop'],
  summary:
    'Ask staff to move the pin or change the GSTIN; the live values stay until staff approve (one waiting request per kind)',
  security: sec,
  request: { params: WorkshopIdParam, body: body(WorkshopChangeSchema.openapi('RequestWorkshopChange')) },
  responses: { 201: json(z.object({ id: z.string() }), 'Filed'), ...conflict, ...errorResponses },
});
const changeWithdraw = createRoute({
  method: 'delete',
  path: '/workshop/profile/changes/{changeId}',
  tags: ['workshop'],
  summary: 'Withdraw a waiting pin or GSTIN request',
  security: sec,
  request: { params: z.object({ changeId: z.uuid().openapi({ param: { name: 'changeId', in: 'path' } }) }) },
  responses: { 200: json(z.object({ ok: z.boolean() }), 'Withdrawn'), ...errorResponses },
});
const slotsList = createRoute({
  method: 'get',
  path: '/workshop/slots',
  tags: ['workshop'],
  summary: 'The open hours of a day with their capacity and bookings',
  security: sec,
  request: {
    query: z.object({
      workshopId: z.uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  },
  responses: {
    200: json(
      z.object({
        slots: z.array(
          z.object({
            hour: z.number().int(),
            part: z.enum(['morning', 'afternoon', 'evening']),
            capacity: z.number().int(),
            booked: z.number().int(),
            free: z.number().int(),
          }),
        ),
      }),
      'Slots',
    ),
    ...errorResponses,
  },
});
const slotCapacity = createRoute({
  method: 'put',
  path: '/workshop/slots/{workshopId}',
  tags: ['workshop'],
  summary: 'Change the capacity of one hour (never below what is booked; 0 closes the hour to new bookings)',
  security: sec,
  request: { params: WorkshopIdParam, body: body(SlotCapacitySchema.openapi('SetSlotCapacity')) },
  responses: {
    200: json(
      z.object({ hour: z.number().int(), capacity: z.number().int(), booked: z.number().int() }),
      'Saved',
    ),
    ...conflict,
    ...errorResponses,
  },
});
const estimates = action(
  'estimates',
  'Send an itemised estimate (new revision; every approval starts again). Not while the customer is deciding',
  SendEstimateSchema,
  'SendEstimate',
  { revision: z.number().int() },
);
const start = action('start', 'Start the approved work', VersionSchema, 'StartJob');
const ready = action('ready', 'The work is done; the vehicle is ready', VersionSchema, 'JobReady');
const bill = action(
  'bill',
  'Bill the approved lines (GST by registration, rupee round-off)',
  VersionSchema,
  'BillJob',
  {
    totalPaise: z.number().int(),
  },
);
const paid = action(
  'mark-paid',
  'Paid at the workshop (cash, UPI or card); the job completes',
  MarkPaidSchema,
  'MarkJobPaid',
);
const returned = action(
  'return-vehicle',
  'No work was approved: the vehicle went back and the job closes',
  VersionSchema,
  'ReturnVehicle',
);

export function workshopPortalRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern: '/workshop/requests/*' also matches '/workshop/requests'.
  app.use('/workshop/requests/*', authenticate(deps, cache));
  app.use(
    '/workshop/requests/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/workshop/requests/*', requireVerified);
  app.use('/workshop/requests/*', requirePermission('service:read'));
  for (const p of ['propose', 'decline'])
    app.on('POST', `/workshop/requests/:code/${p}`, requirePermission('service:respond'));
  for (const p of [
    'vehicle-received',
    'estimates',
    'start',
    'ready',
    'bill',
    'mark-paid',
    'return-vehicle',
    'move',
    'waive-visit-fee',
  ])
    app.on('POST', `/workshop/requests/:code/${p}`, requirePermission('service:work'));
  app.on(
    'POST',
    '/workshop/requests/:code/vehicle-received',
    rateLimit(deps.rateLimiter, ARRIVAL_RATE, (c) => c.get('auth').user.id),
  );
  // Home settings: the owner's menu permission, scoped to their workshop's grants.
  // One pattern: '/workshop/home-settings/*' also matches '/workshop/home-settings'.
  app.use('/workshop/home-settings/*', authenticate(deps, cache));
  app.use(
    '/workshop/home-settings/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/workshop/home-settings/*', requireVerified);
  app.use('/workshop/home-settings/*', requirePermission('service_menu:write'));

  // My workshop and slot capacity: the owner's menu permission, scoped to their workshop's grants. Reading a day's hours
  // needs only service:read (the proposal form shows them).
  for (const base of ['/workshop/profile', '/workshop/profile/*', '/workshop/slots', '/workshop/slots/*']) {
    app.use(base, authenticate(deps, cache));
    app.use(
      base,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(base, requireVerified);
  }
  app.use('/workshop/profile', requirePermission('service_menu:write'));
  app.use('/workshop/profile/*', requirePermission('service_menu:write'));
  app.on('PUT', '/workshop/slots/*', requirePermission('service_menu:write'));
  app.on('GET', '/workshop/slots', requirePermission('service:read'));
  // Filing a pin or GSTIN request is rare: a tighter per-user limit on top of the general one.
  app.on(
    'POST',
    '/workshop/profile/:workshopId/changes',
    rateLimit(deps.rateLimiter, CHANGE_RATE, (c) => c.get('auth').user.id),
  );

  const ids = (c: Context<AppEnv>, p: Permission) => workshopIdsFrom(c.get('auth').grants, p);
  const stepOf = (c: Context<AppEnv>, p: Permission, code: string, version: number) => ({
    workshopIds: ids(c, p),
    code,
    expectedVersion: version,
    staffUserId: c.get('auth').user.id,
  });

  return app
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      const page = await listWorkshopRequests(
        deps.db,
        ids(c, 'service:read'),
        q.view,
        { cursor: q.cursor ?? null, limit: q.limit },
        q.locale,
      );
      return c.json({ items: page.items.map(toSummaryJson), nextCursor: page.nextCursor }, 200);
    })
    .openapi(detail, async (c) => {
      const v = await getWorkshopRequest(
        deps.db,
        ids(c, 'service:read'),
        c.req.valid('param').code,
        c.req.valid('query').locale,
      );
      return c.json(toDetailJson(v), 200);
    })
    .openapi(propose, async (c) => {
      const b = c.req.valid('json');
      const r = await proposeSlot(deps.db, {
        ...stepOf(c, 'service:respond', c.req.valid('param').code, b.version),
        date: b.date,
        hour: b.hour ?? null,
        slot: b.slot,
        lowPaise: b.lowPaise,
        highPaise: b.highPaise,
        note: b.note ?? null,
        mechanicName: b.mechanicName ?? null,
      });
      return c.json(r, 200);
    })
    .openapi(decline, async (c) => {
      const b = c.req.valid('json');
      const r = await declineRequest(deps.db, {
        ...stepOf(c, 'service:respond', c.req.valid('param').code, b.version),
        reasonCode: b.reasonCode,
      });
      return c.json(r, 200);
    })
    .openapi(received, async (c) => {
      const b = c.req.valid('json');
      const r = await markVehicleReceived(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        odometerKm: b.odometerKm,
        arrivalCode: b.arrivalCode,
        keyring: deps.keyring ?? null,
      });
      return c.json(r, 200);
    })
    .openapi(moveOffer, async (c) => {
      const b = c.req.valid('json');
      const r = await proposeMove(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        reasonCode: b.reasonCode,
        transport: b.transport,
      });
      return c.json(r, 200);
    })
    .openapi(waive, async (c) => {
      const b = c.req.valid('json');
      const r = await waiveVisitFee(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        reasonCode: b.reasonCode,
      });
      return c.json(r, 200);
    })
    .openapi(homeList, async (c) => {
      return c.json({ workshops: await getWorkshopHomeSettings(deps.db, ids(c, 'service_menu:write')) }, 200);
    })
    .openapi(homeSave, async (c) => {
      const b = c.req.valid('json');
      const r = await saveWorkshopHomeSettings(deps.db, {
        workshopIds: ids(c, 'service_menu:write'),
        workshopId: c.req.valid('param').workshopId,
        staffUserId: c.get('auth').user.id,
        settings: b,
      });
      return c.json(r, 200);
    })
    .openapi(profileList, async (c) => {
      const rows = await getWorkshopProfiles(deps.db, ids(c, 'service_menu:write'));
      return c.json(
        {
          workshops: rows.map((p) => ({
            workshopId: p.workshop.id,
            slug: p.workshop.slug,
            name: p.workshop.name,
            nameHi: p.workshop.nameHi,
            addressLine: p.workshop.addressLine,
            addressLineHi: p.workshop.addressLineHi,
            area: p.workshop.area,
            areaHi: p.workshop.areaHi,
            pincode: p.workshop.pincode,
            lat: p.workshop.lat,
            lng: p.workshop.lng,
            phone: p.workshop.phone,
            hours: p.workshop.hours,
            gstin: p.workshop.gstin,
            locationVerified: p.workshop.locationVerified,
            published: p.workshop.published,
            status: p.workshop.status,
            busy: p.workshop.busy,
            slotCapacity: p.slotCapacity,
            version: p.workshop.version,
            missingHindi: p.workshop.missingHindi,
            menu: p.workshop.menu,
            pending: p.pending.map((x) => ({
              id: x.id,
              kind: x.kind,
              payload: x.payload as Record<string, unknown>,
              createdAt: x.createdAt.toISOString(),
            })),
          })),
        },
        200,
      );
    })
    .openapi(profileSave, async (c) => {
      const r = await saveWorkshopProfile(deps.db, {
        workshopIds: ids(c, 'service_menu:write'),
        workshopId: c.req.valid('param').workshopId,
        userId: c.get('auth').user.id,
        edit: c.req.valid('json'),
      });
      return c.json(r, 200);
    })
    .openapi(changeFile, async (c) => {
      const r = await requestWorkshopChange(deps.db, {
        workshopIds: ids(c, 'service_menu:write'),
        workshopId: c.req.valid('param').workshopId,
        userId: c.get('auth').user.id,
        change: c.req.valid('json'),
      });
      return c.json(r, 201);
    })
    .openapi(changeWithdraw, async (c) => {
      await cancelWorkshopChange(deps.db, {
        workshopIds: ids(c, 'service_menu:write'),
        changeId: c.req.valid('param').changeId,
        userId: c.get('auth').user.id,
      });
      return c.json({ ok: true }, 200);
    })
    .openapi(slotsList, async (c) => {
      const q = c.req.valid('query');
      return c.json(
        {
          slots: await listSlots(deps.db, {
            workshopIds: ids(c, 'service:read'),
            workshopId: q.workshopId,
            date: q.date,
          }),
        },
        200,
      );
    })
    .openapi(slotCapacity, async (c) => {
      const b = c.req.valid('json');
      const r = await setSlotCapacity(deps.db, {
        workshopIds: ids(c, 'service_menu:write'),
        workshopId: c.req.valid('param').workshopId,
        date: b.date,
        hour: b.hour,
        capacity: b.capacity,
        userId: c.get('auth').user.id,
      });
      return c.json({ hour: r.hour, capacity: r.capacity, booked: r.booked }, 200);
    })
    .openapi(estimates, async (c) => {
      const b = c.req.valid('json');
      const r = await sendEstimate(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        lines: b.lines,
      });
      return c.json(r, 200);
    })
    .openapi(start, async (c) => {
      const b = c.req.valid('json');
      const r = await advanceJob(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        to: 'in_progress',
      });
      return c.json(r, 200);
    })
    .openapi(ready, async (c) => {
      const b = c.req.valid('json');
      const r = await advanceJob(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        to: 'ready',
      });
      return c.json(r, 200);
    })
    .openapi(bill, async (c) => {
      const b = c.req.valid('json');
      const r = await billJob(deps.db, stepOf(c, 'service:work', c.req.valid('param').code, b.version));
      return c.json(r, 200);
    })
    .openapi(paid, async (c) => {
      const b = c.req.valid('json');
      const r = await markJobPaid(deps.db, {
        ...stepOf(c, 'service:work', c.req.valid('param').code, b.version),
        method: b.method,
      });
      return c.json(r, 200);
    })
    .openapi(returned, async (c) => {
      const b = c.req.valid('json');
      const r = await returnVehicle(deps.db, stepOf(c, 'service:work', c.req.valid('param').code, b.version));
      return c.json(r, 200);
    });
}
