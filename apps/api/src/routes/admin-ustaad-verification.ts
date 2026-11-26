/**
 * Admin → Ustaad → Verification (spec 23 § 3, § 8 "Admin", SR-8, SR-38; plan task B4; G2 builds the screen). Verified
 * staff in a staff session with `ustaad:verify` (community manager, super admin), city scoped (a city-A manager gets
 * 404 on city-B requests). Staff final approval is locked on: approve / reject / revoke are the only way a request is
 * decided; revoke is four-eyes; nobody decides their own request; every decision is audited. Level reviews for Bada and
 * Master are rows of the same queue (`requestedLevel` bada/master).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  approveUstaadVerification,
  cityScopeFrom,
  listUstaadVerifications,
  rejectUstaadVerification,
  revokeUstaadVerification,
} from '@mechdost/db/repo';
import {
  ApproveVerificationDto,
  RejectVerificationDto,
  VerificationQueueItemDto,
  VerificationViewDto,
} from '@mechdost/shared/ustaad/dto/verification';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const sec = [{ bearerAuth: [] }];
const tags = ['admin'];
const PREFIX = '/admin/ustaad/verifications';

const r = {
  list: createRoute({
    method: 'get',
    path: PREFIX,
    tags,
    security: sec,
    summary: 'Verification and level-review queue (city scoped; phone never shown)',
    request: {
      query: z.object({
        status: z.enum(['requested', 'in_review', 'approved', 'rejected']).default('in_review'),
        before: z.iso.datetime().optional(),
      }),
    },
    responses: {
      200: json(z.object({ items: z.array(VerificationQueueItemDto), next: z.string().nullable() }), 'Queue'),
      ...errorResponses,
    },
  }),
  approve: createRoute({
    method: 'post',
    path: `${PREFIX}/{id}/approve`,
    tags,
    security: sec,
    summary: 'Approve (grant a level ≤ the level asked); staff final approval, compare-and-set on version',
    request: { params: z.object({ id: Id }), body: body(ApproveVerificationDto) },
    responses: { 200: json(VerificationViewDto, 'Approved'), ...conflict, ...errorResponses },
  }),
  reject: createRoute({
    method: 'post',
    path: `${PREFIX}/{id}/reject`,
    tags,
    security: sec,
    summary: 'Reject with a reason code (note required for "other")',
    request: { params: z.object({ id: Id }), body: body(RejectVerificationDto) },
    responses: { 200: json(VerificationViewDto, 'Rejected'), ...conflict, ...errorResponses },
  }),
  revoke: createRoute({
    method: 'post',
    path: `${PREFIX}/{id}/revoke`,
    tags,
    security: sec,
    summary: 'Revoke an approved verification (four-eyes: not the approver)',
    request: { params: z.object({ id: Id }), body: body(RejectVerificationDto) },
    responses: { 200: json(VerificationViewDto, 'Revoked'), ...conflict, ...errorResponses },
  }),
};

export function adminUstaadVerificationRoutes(deps: AppDeps, sessions: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const p of [PREFIX, `${PREFIX}/*`]) {
    app.use(p, authenticate(deps, sessions));
    app.use(
      p,
      rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.staff, (c) => c.get('auth').user.id),
    );
    app.use(p, requireVerified);
    app.use(p, requirePermission('ustaad:verify'));
  }
  const staff = (c: Context<AppEnv>) => {
    const scope = cityScopeFrom(c.get('auth').grants, 'ustaad:verify');
    return { userId: c.get('auth').user.id, cityIds: scope.all ? null : scope.cityIds };
  };

  return app
    .openapi(r.list, async (c) => {
      const q = c.req.valid('query');
      const out = await listUstaadVerifications(deps.db, {
        status: q.status,
        cityIds: staff(c).cityIds,
        ...(q.before ? { before: new Date(q.before) } : {}),
      });
      return c.json(out, 200);
    })
    .openapi(r.approve, async (c) =>
      c.json(
        await approveUstaadVerification(deps.db, staff(c), {
          id: c.req.valid('param').id,
          ...c.req.valid('json'),
        }),
        200,
      ),
    )
    .openapi(r.reject, async (c) =>
      c.json(
        await rejectUstaadVerification(deps.db, staff(c), {
          id: c.req.valid('param').id,
          ...c.req.valid('json'),
        }),
        200,
      ),
    )
    .openapi(r.revoke, async (c) =>
      c.json(
        await revokeUstaadVerification(deps.db, staff(c), {
          id: c.req.valid('param').id,
          ...c.req.valid('json'),
        }),
        200,
      ),
    );
}
