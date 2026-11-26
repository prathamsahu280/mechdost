/**
 * Admin → Ustaad moderation (spec 23 § 3, § 7.6, § 8 "Admin", § 13; SR-38, SR-39; plan task F2). G2 builds the
 * console on these routes. Verified staff, two-step session, 300 requests a minute (one guard for this router's own
 * paths, so the staff limit counts once). Never behind the `ustaad.access` switch.
 *
 * Permissions: reading the queue and a report needs `ustaad:moderate` or `ustaad:read`; every decision needs
 * `ustaad:moderate`; the legal fast path needs `ustaad:takedown`. Scope is the city scope of the permission used
 * (a city-A community manager gets 404 on city-B reports). Support, finance and marketing hold none of these → 403.
 * No route returns a phone number or an export; message content only through `…/thread` with a reason (audited).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import {
  actOnUstaadReport,
  cityScopeFrom,
  confirmUstaadBan,
  decideUstaadAppeal,
  executeUstaadTakedown,
  listUstaadModerationQueue,
  openUstaadAppeal,
  readUstaadReportedThread,
  ustaadReportDetail,
  type ModerationResult,
  type UstaadStaff,
} from '@mechdost/db/repo';
import { can, type Permission } from '@mechdost/shared/rbac';
import {
  ConfirmBanDto,
  DecideAppealDto,
  DmReadQueryDto,
  ModerationActDto,
  ModerationQueueQueryDto,
  OpenAppealDto,
  ReportDetailDto,
  ReportQueueItemDto,
  TakedownDto,
  USTAAD_REPORT_CODE_RE,
} from '@mechdost/shared/ustaad/dto/moderation';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { moveUstaadMediaObjects } from '../ustaad/safety/evidence';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

const OWN = /\/admin\/ustaad\/moderation(\/|$)/;
const meta = { tags: ['ustaad-admin'], security: [{ bearerAuth: [] }] };
const Code = z.object({
  code: z
    .string()
    .regex(USTAAD_REPORT_CODE_RE)
    .openapi({ param: { name: 'code', in: 'path' } }),
});
const Result = z
  .object({
    code: z.string(),
    status: z.string(),
    pendingBan: z.object({ proposalId: z.string() }).optional(),
    mediaMoved: z.number().int(),
    mediaMoveFailed: z.number().int(),
  })
  .openapi('UstaadModerationResult');
const ok = (schema: z.ZodType, what: string) => ({ 200: json(schema, what), ...conflict, ...errorResponses });

const R = {
  queue: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/moderation/reports',
    summary: 'Reports queue (open | appealed | decided): child safety first, then by due time; 20 a page',
    request: { query: ModerationQueueQueryDto },
    responses: ok(
      z
        .object({ items: z.array(ReportQueueItemDto), nextCursor: z.string().nullable() })
        .openapi('UstaadQueue'),
      'Queue',
    ),
  }),
  detail: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/moderation/reports/{code}',
    summary: 'One report: masked text, author without contact details, history, a pending ban',
    request: { params: Code },
    responses: ok(ReportDetailDto.openapi('UstaadReportDetail'), 'Report'),
  }),
  act: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/moderation/reports/{code}/act',
    summary: 'Keep, remove, warn, restrict or ban (a long ban is proposed for a second staff member)',
    request: { params: Code, body: body(ModerationActDto.openapi('UstaadModerationAct')) },
    responses: ok(Result, 'Decided'),
  }),
  confirmBan: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/moderation/reports/{code}/ban/confirm',
    summary: 'Second staff member confirms a proposed ban (four-eyes)',
    request: { params: Code, body: body(ConfirmBanDto.openapi('UstaadConfirmBan')) },
    responses: ok(Result, 'Banned'),
  }),
  appeal: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/moderation/reports/{code}/appeal',
    summary: "Link the author's appeal ticket (REQ-…) to an actioned report",
    request: { params: Code, body: body(OpenAppealDto.openapi('UstaadOpenAppeal')) },
    responses: ok(z.object({ code: z.string(), status: z.string() }), 'Appealed'),
  }),
  decide: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/moderation/reports/{code}/appeal/decide',
    summary: 'Decide an appeal (someone who took no part in the decision): upheld or overturned',
    request: { params: Code, body: body(DecideAppealDto.openapi('UstaadDecideAppeal')) },
    responses: ok(Result, 'Decided'),
  }),
  thread: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/moderation/reports/{code}/thread',
    summary: 'The reported message thread (only through an open report on a message; audited)',
    request: { params: Code, query: DmReadQueryDto },
    responses: ok(z.any(), 'Thread'),
  }),
  takedown: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/moderation/takedowns',
    summary:
      'Legal takedown fast path: court order / government intimation (3 h), NCII (2 h), removal grievance (36 h)',
    request: { body: body(TakedownDto.openapi('UstaadTakedown')) },
    responses: ok(Result.extend({ seconds: z.number().int() }), 'Taken down'),
  }),
};

function requireAny(c: Context<AppEnv>, perms: readonly Permission[]): void {
  const grants = c.get('auth').grants;
  if (!perms.some((p) => can(grants, p))) throw Forbidden('FORBIDDEN', 'Not allowed');
}

const permissionGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.endsWith('/moderation/takedowns')) requireAny(c, ['ustaad:takedown']);
  else if (c.req.method === 'GET' && !c.req.path.endsWith('/thread'))
    requireAny(c, ['ustaad:moderate', 'ustaad:read']);
  else requireAny(c, ['ustaad:moderate']);
  await next();
};

function chain(mws: readonly MiddlewareHandler<AppEnv>[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const step = async (i: number): Promise<void> => {
      const mw = mws[i];
      if (!mw) {
        await next();
        return;
      }
      await mw(c, () => step(i + 1));
    };
    await step(0);
  };
}

/** The caller as a moderation actor: the city scope of the permission this route uses. */
function staffOf(c: Context<AppEnv>, permission: Permission): UstaadStaff {
  const grants = c.get('auth').grants;
  const read =
    permission === 'ustaad:moderate' && !can(grants, 'ustaad:moderate') ? 'ustaad:read' : permission;
  return {
    userId: c.get('auth').user.id,
    scope: cityScopeFrom(grants, read),
    canTakedown: can(grants, 'ustaad:takedown'),
  };
}

export function adminUstaadModerationRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const guard = chain([
    authenticate(deps, cache),
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.staff, (c) => c.get('auth').user.id),
    requireVerified,
    permissionGuard,
  ]);
  const ownPathsOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (OWN.test(c.req.path)) await guard(c, next);
    else await next();
  };
  app.use('/admin/ustaad/*', ownPathsOnly);
  const move = async (r: ModerationResult, to: 'evidence' | 'media') => {
    const m = await moveUstaadMediaObjects({ db: deps.db, host: deps.mediaHost }, r.media, to);
    return {
      code: r.code,
      status: r.status,
      ...(r.pendingBan ? { pendingBan: r.pendingBan } : {}),
      mediaMoved: m.moved,
      mediaMoveFailed: m.failed,
    };
  };

  return app
    .openapi(R.queue, async (c) => {
      const q = c.req.valid('query');
      const staff = staffOf(c, 'ustaad:moderate');
      const cityId = q.city
        ? await scopedCity(
            deps,
            c,
            q.city,
            can(c.get('auth').grants, 'ustaad:moderate') ? 'ustaad:moderate' : 'ustaad:read',
          )
        : null;
      return c.json(
        await listUstaadModerationQueue(deps.db, staff, { queue: q.queue, cityId, cursor: q.cursor }),
        200,
      );
    })
    .openapi(R.detail, async (c) =>
      c.json(
        await ustaadReportDetail(deps.db, staffOf(c, 'ustaad:moderate'), c.req.valid('param').code),
        200,
      ),
    )
    .openapi(R.act, async (c) => {
      const b = c.req.valid('json');
      const r = await actOnUstaadReport(deps.db, staffOf(c, 'ustaad:moderate'), c.req.valid('param').code, b);
      return c.json(await move(r, 'evidence'), 200);
    })
    .openapi(R.confirmBan, async (c) => {
      const r = await confirmUstaadBan(
        deps.db,
        staffOf(c, 'ustaad:moderate'),
        c.req.valid('param').code,
        c.req.valid('json'),
      );
      return c.json(await move(r, 'evidence'), 200);
    })
    .openapi(R.appeal, async (c) =>
      c.json(
        await openUstaadAppeal(
          deps.db,
          staffOf(c, 'ustaad:moderate'),
          c.req.valid('param').code,
          c.req.valid('json'),
        ),
        200,
      ),
    )
    .openapi(R.decide, async (c) => {
      const r = await decideUstaadAppeal(
        deps.db,
        staffOf(c, 'ustaad:moderate'),
        c.req.valid('param').code,
        c.req.valid('json'),
      );
      return c.json(await move(r, 'media'), 200);
    })
    .openapi(R.thread, async (c) =>
      c.json(
        await readUstaadReportedThread(
          deps.db,
          staffOf(c, 'ustaad:moderate'),
          c.req.valid('param').code,
          c.req.valid('query').reason,
        ),
        200,
      ),
    )
    .openapi(R.takedown, async (c) => {
      const r = await executeUstaadTakedown(deps.db, staffOf(c, 'ustaad:takedown'), c.req.valid('json'));
      return c.json({ ...(await move(r, 'evidence')), seconds: r.seconds }, 200);
    });
}
