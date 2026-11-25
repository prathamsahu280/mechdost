/**
 * Workshop portal → "Confirm your mechanics" (spec 23 § 3, § 8 "Workshop", SR-6; plan task B4). A workshop owner or
 * staff member with `service_menu:write` on a workshop sees and decides only that workshop's attestation requests
 * (foreign ids 404). The member's phone is never part of the view.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  confirmUstaadAttestation,
  listUstaadAttestationsForWorkshops,
  workshopIdsFrom,
} from '@mechdost/db/repo';
import { AttestationDecisionDto, AttestationViewDto } from '@mechdost/shared/ustaad/dto/verification';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

const PREFIX = '/workshop/ustaad/attestations';
const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });

const list = createRoute({
  method: 'get',
  path: PREFIX,
  tags: ['workshop'],
  security: [{ bearerAuth: [] }],
  summary: 'Mechanics asking my workshop to confirm they work here',
  responses: { 200: json(z.object({ items: z.array(AttestationViewDto) }), 'Requests'), ...errorResponses },
});
const decide = createRoute({
  method: 'post',
  path: `${PREFIX}/{id}/decide`,
  tags: ['workshop'],
  security: [{ bearerAuth: [] }],
  summary: 'Confirm or decline (≤ 10 confirmations a quarter per workshop)',
  request: { params: z.object({ id: Id }), body: body(AttestationDecisionDto) },
  responses: { 200: json(AttestationViewDto, 'Decided'), ...conflict, ...errorResponses },
});

export function workshopUstaadRoutes(deps: AppDeps, sessions: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const p of [PREFIX, `${PREFIX}/*`]) {
    app.use(p, authenticate(deps, sessions));
    app.use(
      p,
      rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.workshopAttest, (c) => c.get('auth').user.id),
    );
    app.use(p, requireVerified);
  }
  const ids = (c: Context<AppEnv>) => {
    const w = workshopIdsFrom(c.get('auth').grants, 'service_menu:write');
    if (w.length === 0) throw Forbidden();
    return w;
  };
  return app
    .openapi(list, async (c) =>
      c.json({ items: await listUstaadAttestationsForWorkshops(deps.db, ids(c)) }, 200),
    )
    .openapi(decide, async (c) =>
      c.json(
        await confirmUstaadAttestation(
          deps.db,
          { userId: c.get('auth').user.id, workshopIds: ids(c) },
          { id: c.req.valid('param').id, ...c.req.valid('json') },
        ),
        200,
      ),
    );
}
