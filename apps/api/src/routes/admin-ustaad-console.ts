/**
 * Admin → Ustaad community manager console (spec 23 § 3, § 13; SR-38; plan task G2): what the caller may do (the UI
 * hides the rest; every route still checks), members for staff (search by handle, detail, restrict, ban with
 * four-eyes, unban), takedowns and legal holds, and the caller's own audit trail. Verified staff, two-step session,
 * the staff rate limit; guarded on its own exact paths only (a `/admin/ustaad/*` guard would also guard the other
 * Ustaad admin modules, L-UD3). City scope of the permission used (a city-A manager gets 404 on city B). No phone,
 * email or export anywhere.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import {
  cityScopeFrom,
  listUstaadLegalCases,
  listUstaadStaffOwnActions,
  sanctionUstaadMember,
  searchUstaadMembersForStaff,
  unbanUstaadMember,
  ustaadMemberForStaff,
  ustaadScopeCityCodes,
  type UstaadStaff,
} from '@mechdost/db/repo';
import { can, type Permission } from '@mechdost/shared/rbac';
import {
  ConsoleCapsDto,
  LegalCasesDto,
  MemberSearchQueryDto,
  OwnActionsDto,
  OwnActionsQueryDto,
  SanctionMemberDto,
  StaffMemberDetailDto,
  StaffMemberRowDto,
  UnbanMemberDto,
} from '@mechdost/shared/ustaad/dto/console';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

const meta = { tags: ['ustaad-admin'], security: [{ bearerAuth: [] }] };
const MemberId = z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) });
const ok = (schema: z.ZodType, what: string) => ({ 200: json(schema, what), ...conflict, ...errorResponses });
const READ: readonly Permission[] = ['ustaad:moderate', 'ustaad:read'];
const ANY_CONSOLE: readonly Permission[] = [
  'ustaad:read',
  'ustaad:moderate',
  'ustaad:verify',
  'ustaad:takedown',
  'ustaad:settings',
];

const R = {
  caps: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/console',
    summary: 'What the caller may do in the community console, and which cities',
    responses: ok(ConsoleCapsDto.openapi('UstaadConsoleCaps'), 'Capabilities'),
  }),
  search: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/members',
    summary: 'Members whose handle starts with q (20 at most; no phone or email)',
    request: { query: MemberSearchQueryDto },
    responses: ok(z.object({ items: z.array(StaffMemberRowDto) }).openapi('UstaadStaffMembers'), 'Members'),
  }),
  detail: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/members/{id}',
    summary: 'One member: status, strikes and the sanctions history',
    request: { params: MemberId },
    responses: ok(StaffMemberDetailDto.openapi('UstaadStaffMember'), 'Member'),
  }),
  sanction: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/members/{id}/sanction',
    summary: 'Restrict or ban (a long ban is proposed for a second staff member)',
    request: { params: MemberId, body: body(SanctionMemberDto.openapi('UstaadSanctionMember')) },
    responses: ok(
      z.object({
        code: z.string(),
        status: z.string(),
        pendingBan: z.object({ proposalId: z.string() }).optional(),
      }),
      'Decided or proposed',
    ),
  }),
  unban: createRoute({
    ...meta,
    method: 'post',
    path: '/admin/ustaad/members/{id}/unban',
    summary: 'Lift a ban or restriction with a reason (never a child-safety freeze)',
    request: { params: MemberId, body: body(UnbanMemberDto) },
    responses: ok(z.object({ memberId: z.string(), status: z.string() }), 'Lifted'),
  }),
  legal: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/legal',
    summary: 'Takedowns, grievances and legal holds (evidence vault counts)',
    responses: ok(LegalCasesDto.openapi('UstaadLegalCases'), 'Legal'),
  }),
  mine: createRoute({
    ...meta,
    method: 'get',
    path: '/admin/ustaad/my-actions',
    summary: "The caller's own Ustaad audit rows, newest first",
    request: { query: OwnActionsQueryDto },
    responses: ok(OwnActionsDto.openapi('UstaadOwnActions'), 'Own actions'),
  }),
};

const OWN_PATHS = [
  '/admin/ustaad/console',
  '/admin/ustaad/members',
  '/admin/ustaad/members/*',
  '/admin/ustaad/legal',
  '/admin/ustaad/my-actions',
];

function requireAny(c: Context<AppEnv>, perms: readonly Permission[]): void {
  if (!perms.some((p) => can(c.get('auth').grants, p))) throw Forbidden('FORBIDDEN', 'Not allowed');
}

const permissionGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const p = c.req.path;
  if (p.endsWith('/admin/ustaad/console') || p.endsWith('/admin/ustaad/my-actions'))
    requireAny(c, ANY_CONSOLE);
  else if (p.endsWith('/admin/ustaad/legal')) requireAny(c, ['ustaad:takedown', 'ustaad:moderate']);
  else if (c.req.method === 'GET') requireAny(c, READ);
  else requireAny(c, ['ustaad:moderate']);
  await next();
};

function staffOf(c: Context<AppEnv>, permission: Permission): UstaadStaff {
  const grants = c.get('auth').grants;
  const use =
    permission === 'ustaad:moderate' && !can(grants, 'ustaad:moderate') ? 'ustaad:read' : permission;
  return {
    userId: c.get('auth').user.id,
    scope: cityScopeFrom(grants, use),
    canTakedown: can(grants, 'ustaad:takedown'),
  };
}

export function adminUstaadConsoleRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const p of OWN_PATHS) {
    app.use(p, authenticate(deps, cache));
    app.use(
      p,
      rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.staff, (c) => c.get('auth').user.id),
    );
    app.use(p, requireVerified);
    app.use(p, permissionGuard);
  }

  return app
    .openapi(R.caps, async (c) => {
      const grants = c.get('auth').grants;
      // The widest of the caller's Ustaad permissions decides the cities shown (each route re-checks its own).
      const scopes = ANY_CONSOLE.filter((p) => can(grants, p)).map((p) => cityScopeFrom(grants, p));
      const codes = await ustaadScopeCityCodes(
        deps.db,
        scopes.some((s) => s.all)
          ? { all: true }
          : { all: false, cityIds: [...new Set(scopes.flatMap((s) => (s.all ? [] : s.cityIds)))] },
      );
      return c.json(
        {
          read: can(grants, 'ustaad:read') || can(grants, 'ustaad:moderate'),
          moderate: can(grants, 'ustaad:moderate'),
          verify: can(grants, 'ustaad:verify'),
          takedown: can(grants, 'ustaad:takedown'),
          settings: can(grants, 'ustaad:settings'),
          cities: codes,
        },
        200,
      );
    })
    .openapi(R.search, async (c) =>
      c.json(
        await searchUstaadMembersForStaff(deps.db, staffOf(c, 'ustaad:moderate'), c.req.valid('query')),
        200,
      ),
    )
    .openapi(R.detail, async (c) =>
      c.json(
        await ustaadMemberForStaff(deps.db, staffOf(c, 'ustaad:moderate'), c.req.valid('param').id),
        200,
      ),
    )
    .openapi(R.sanction, async (c) => {
      const r = await sanctionUstaadMember(
        deps.db,
        staffOf(c, 'ustaad:moderate'),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.json(
        { code: r.code, status: r.status, ...(r.pendingBan ? { pendingBan: r.pendingBan } : {}) },
        200,
      );
    })
    .openapi(R.unban, async (c) =>
      c.json(
        await unbanUstaadMember(
          deps.db,
          staffOf(c, 'ustaad:moderate'),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
    )
    .openapi(R.legal, async (c) => {
      const grants = c.get('auth').grants;
      const staff = staffOf(c, can(grants, 'ustaad:takedown') ? 'ustaad:takedown' : 'ustaad:moderate');
      return c.json(await listUstaadLegalCases(deps.db, staff), 200);
    })
    .openapi(R.mine, async (c) =>
      c.json(await listUstaadStaffOwnActions(deps.db, c.get('auth').user.id, c.req.valid('query')), 200),
    );
}
