/**
 * Ustaad Local routes (spec 23 § 8 "Location" and "Jobs", § 9.6; plan workstream E). Mounted inside `ustaadRoutes`,
 * so `ustaadGate` runs first (no oracle), then `requireUstaadMember` (non-members 404). The repositories own every
 * rule (pin limits, region, employer check, attestation, scam hold, actor scoping); handlers only validate, rate
 * limit and map results. No phone number and no exact distance is ever in a response.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  applyToUstaadJob,
  assertUstaadJobsEnabled,
  getUstaadJob,
  listUstaadJobApplicants,
  listUstaadJobs,
  moveUstaadApplication,
  moveUstaadJob,
  myUstaadLocation,
  postUstaadJob,
  saveUstaadLocation,
  setUstaadSignboard,
  ustaadCityIdByCode,
  ustaadZonesBanded,
} from '@mechdost/db/repo';
import {
  ApplicantsQueryDto,
  ApplicantsResponseDto,
  ApplicationParam,
  ApplyDto,
  JobActionParam,
  JobCodeParam,
  JobDto,
  JobsQueryDto,
  LocationDto,
  MyLocationDto,
  PostJobDto,
  SignboardDto,
  ZoneDto,
  ZonesQueryDto,
} from '@mechdost/shared/ustaad/dto/local';
import { ApiError } from '../../errors';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const Ok = z.object({ ok: z.literal(true) });
const sec = [{ bearerAuth: [] }];

const getLocation = createRoute({
  method: 'get',
  path: '/ustaad/me/location',
  tags: ['ustaad'],
  summary: 'My garage pin and location choices (null before the first pin)',
  security: sec,
  responses: { 200: json(z.object({ location: MyLocationDto.nullable() }), 'My pin'), ...errorResponses },
});
const putLocation = createRoute({
  method: 'put',
  path: '/ustaad/me/location',
  tags: ['ustaad'],
  summary: 'Put or move my garage pin with the three choices (3 moves/24 h, 6/30 days; 429 USTAAD_PIN_LIMIT)',
  security: sec,
  request: { body: body(LocationDto.openapi('UstaadLocation')) },
  responses: {
    200: json(z.object({ location: MyLocationDto }), 'Saved'),
    ...conflict,
    ...errorResponses,
  },
});
const signboard = createRoute({
  method: 'post',
  path: '/ustaad/me/location/signboard',
  tags: ['ustaad'],
  summary: 'Attach a signboard photo for "Verified location" (staff check it)',
  security: sec,
  request: { body: body(SignboardDto) },
  responses: { 200: json(Ok, 'Attached'), ...conflict, ...errorResponses },
});
const zones = createRoute({
  method: 'get',
  path: '/ustaad/zones',
  tags: ['ustaad'],
  summary: 'Zone counts as privacy bands (verified members only; exact numbers are staff-only)',
  security: sec,
  request: { query: ZonesQueryDto },
  responses: { 200: json(z.object({ zones: z.array(ZoneDto) }), 'Zones'), ...errorResponses },
});
const listJobs = createRoute({
  method: 'get',
  path: '/ustaad/jobs',
  tags: ['ustaad'],
  summary: 'Open jobs in my city, newest first (cursor)',
  security: sec,
  request: { query: JobsQueryDto },
  responses: {
    200: json(z.object({ items: z.array(JobDto), next: z.string().nullable() }), 'Jobs'),
    ...errorResponses,
  },
});
const getJob = createRoute({
  method: 'get',
  path: '/ustaad/jobs/{code}',
  tags: ['ustaad'],
  summary: 'One job',
  security: sec,
  request: { params: JobCodeParam },
  responses: { 200: json(JobDto, 'Job'), ...conflict, ...errorResponses },
});
const postJob = createRoute({
  method: 'post',
  path: '/ustaad/jobs',
  tags: ['ustaad'],
  summary: 'Post a job (verified workshop or trade account; 18+ attestation; pay range; scam check)',
  security: sec,
  request: { body: body(PostJobDto.openapi('UstaadPostJob')) },
  responses: { 201: json(JobDto, 'Posted (open, or under review)'), ...conflict, ...errorResponses },
});
const moveJob = createRoute({
  method: 'post',
  path: '/ustaad/jobs/{code}/{action}',
  tags: ['ustaad'],
  summary: 'Employer: pause, resume, close or fill a job',
  security: sec,
  request: { params: JobActionParam },
  responses: { 200: json(z.object({ status: z.string() }), 'Moved'), ...conflict, ...errorResponses },
});
const apply = createRoute({
  method: 'post',
  path: '/ustaad/jobs/{code}/apply',
  tags: ['ustaad'],
  summary: 'Apply with my card (phone shared only when ticked)',
  security: sec,
  request: { params: JobCodeParam, body: body(ApplyDto) },
  responses: {
    201: json(z.object({ applicationId: z.string(), status: z.string() }), 'Applied'),
    ...conflict,
    ...errorResponses,
  },
});
const applicants = createRoute({
  method: 'get',
  path: '/ustaad/jobs/{code}/applications',
  tags: ['ustaad'],
  summary: 'Employer: the applicants of my job, newest first (cursor); 404 for anyone else (SIM-P18)',
  security: sec,
  request: { params: JobCodeParam, query: ApplicantsQueryDto },
  responses: { 200: json(ApplicantsResponseDto, 'Applicants'), ...errorResponses },
});
const moveApplication = createRoute({
  method: 'post',
  path: '/ustaad/applications/{id}/{action}',
  tags: ['ustaad'],
  summary: 'Employer: seen / shortlist / reject / hire; applicant: withdraw',
  security: sec,
  request: { params: ApplicationParam },
  responses: { 200: json(z.object({ status: z.string() }), 'Moved'), ...conflict, ...errorResponses },
});

const JOB_MOVE = { pause: 'paused', resume: 'open', close: 'closed', fill: 'filled' } as const;
const APP_MOVE = {
  seen: 'seen',
  shortlist: 'shortlisted',
  reject: 'rejected',
  hire: 'hired',
  withdraw: 'withdrawn',
} as const;

function encodeCursor(c: { createdAt: string; id: string } | null): string | null {
  return c ? Buffer.from(`${c.createdAt}|${c.id}`).toString('base64url') : null;
}

function decodeCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const d = new Date(at ?? '');
  if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/.test(id))
    throw new ApiError(400, 'BAD_CURSOR', 'Start the list again');
  return { createdAt: d, id };
}

/** The applicants cursor stays an ISO string (the repository compares it as timestamptz, never a Date param). */
function cursorOf(raw: string | undefined): { createdAt: string; id: string } | null {
  const c = decodeCursor(raw);
  return c ? { createdAt: c.createdAt.toISOString(), id: c.id } : null;
}

export function ustaadLocalRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const member = (c: Context<AppEnv>) => {
    const m = c.get('ustaadMember');
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return { memberId: m.id, userId: c.get('auth').user.id, view: m };
  };
  const paths = [
    '/ustaad/me/location',
    '/ustaad/me/location/*',
    '/ustaad/zones',
    '/ustaad/jobs',
    '/ustaad/jobs/*',
    '/ustaad/applications/*',
  ];
  for (const p of paths) app.use(p, requireUstaadMember(deps));
  // Jobs kill switch (`ustaad.jobs.enabled`): every job surface answers 404 when off, except withdrawing an
  // application (a member can always take theirs back).
  const jobsSwitch = createMiddleware<AppEnv>(async (c, next) => {
    if (!/\/ustaad\/applications\/[^/]+\/withdraw$/.test(c.req.path)) await assertUstaadJobsEnabled(deps.db);
    await next();
  });
  for (const p of ['/ustaad/jobs', '/ustaad/jobs/*', '/ustaad/applications/*']) app.use(p, jobsSwitch);
  app.use('/ustaad/me/location', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey));
  app.on(
    ['PUT', 'POST'],
    ['/ustaad/me/location', '/ustaad/me/location/signboard'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.location, userKey),
  );
  app.on(
    'GET',
    ['/ustaad/zones', '/ustaad/jobs', '/ustaad/jobs/*'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey),
  );
  app.on('POST', '/ustaad/jobs', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.jobs, userKey));
  app.on(
    'POST',
    '/ustaad/jobs/:code/apply',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.applications, userKey),
  );
  app.on(
    'POST',
    ['/ustaad/jobs/:code/:action', '/ustaad/applications/*'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey),
  );

  return app
    .openapi(getLocation, async (c) => {
      const m = member(c);
      return c.json({ location: await myUstaadLocation(deps.db, m.memberId) }, 200);
    })
    .openapi(putLocation, async (c) => {
      const m = member(c);
      const r = await saveUstaadLocation(deps.db, m, c.req.valid('json'));
      if (!r.ok) {
        if (r.code === 'USTAAD_PIN_LIMIT')
          throw new ApiError(429, r.code, 'You have moved your pin too often. Try again later');
        if (r.code === 'USTAAD_PIN_FIX_REQUIRED')
          throw new ApiError(422, r.code, 'For a big move, use your location with a strong GPS signal');
        throw new ApiError(422, r.code, 'GPS is weak here. Place the pin by hand and add a landmark');
      }
      return c.json({ location: r.location }, 200);
    })
    .openapi(signboard, async (c) => {
      await setUstaadSignboard(deps.db, member(c), c.req.valid('json').mediaId);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(zones, async (c) => {
      const m = member(c);
      if (m.view.verificationState !== 'verified')
        throw new ApiError(403, 'USTAAD_VERIFIED_ONLY', 'The area map opens once you are verified');
      const code = c.req.valid('query').city ?? m.view.cityCode;
      const cityId = await ustaadCityIdByCode(deps.db, code);
      return c.json({ zones: cityId ? await ustaadZonesBanded(deps.db, cityId) : [] }, 200);
    })
    .openapi(listJobs, async (c) => {
      const q = c.req.valid('query');
      const r = await listUstaadJobs(deps.db, member(c).memberId, {
        role: q.role,
        cursor: decodeCursor(q.cursor),
        limit: q.limit,
      });
      return c.json({ items: r.items, next: encodeCursor(r.next) }, 200);
    })
    .openapi(getJob, async (c) => {
      return c.json(await getUstaadJob(deps.db, member(c).memberId, c.req.valid('param').code), 200);
    })
    .openapi(applicants, async (c) => {
      const q = c.req.valid('query');
      const r = await listUstaadJobApplicants(deps.db, member(c), c.req.valid('param').code, {
        cursor: cursorOf(q.cursor),
        limit: q.limit,
      });
      return c.json({ items: r.items, next: encodeCursor(r.next) }, 200);
    })
    .openapi(postJob, async (c) => {
      return c.json(await postUstaadJob(deps.db, member(c), c.req.valid('json')), 201);
    })
    .openapi(apply, async (c) => {
      const r = await applyToUstaadJob(deps.db, member(c), c.req.valid('param').code, c.req.valid('json'));
      return c.json(r, 201);
    })
    .openapi(moveJob, async (c) => {
      const p = c.req.valid('param');
      return c.json(await moveUstaadJob(deps.db, member(c), p.code, JOB_MOVE[p.action]), 200);
    })
    .openapi(moveApplication, async (c) => {
      const p = c.req.valid('param');
      return c.json(await moveUstaadApplication(deps.db, member(c), p.id, APP_MOVE[p.action]), 200);
    });
}
