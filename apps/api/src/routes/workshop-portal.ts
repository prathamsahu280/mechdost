import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  advanceJob,
  billJob,
  declineRequest,
  getWorkshopHomeSettings,
  getWorkshopRequest,
  listWorkshopRequests,
  markJobPaid,
  markVehicleReceived,
  proposeMove,
  proposeSlot,
  returnVehicle,
  saveWorkshopHomeSettings,
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
  VehicleReceivedSchema,
  WaiveVisitFeeSchema,
  VersionSchema,
  WorkshopDeclineSchema,
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
