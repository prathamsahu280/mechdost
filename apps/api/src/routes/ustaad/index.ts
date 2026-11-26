/**
 * The Ustaad Network API (spec 23 § 8), one router per area. `ustaadGate` runs first on every `/ustaad/*` path, so
 * a caller the access setting does not let in gets the generic 404 before any validation, rate limit or member check
 * (no oracle). The public `GET /ustaad-access` (outside the gate) tells the website which mode is on.
 *
 * Slots (each workstream mounts its own file here and touches nothing else): A members + media; B profile, choices,
 * onboarding, verification (`verification.ts`); C questions and Learn (`qa.ts`, `learn.ts`); D posts, stories, feed,
 * graph, threads, Discover, tags, share teaser (`posts.ts` …); E location, zones, jobs; F correction and reports.
 * Admin routes live beside the other admin routers (`../admin-ustaad-*.ts`).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { USTAAD_ACCESS_MODES } from '@mechdost/shared/ustaad/codes';
import type { SessionCache } from '../../auth/session-cache';
import { ustaadGate, type UstaadAccessCache } from '../../middleware/ustaad-member';
import { rateLimit, RATE_RULES } from '../../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { json } from '../service-schemas';
import { ustaadMediaRoutes } from './media';
import { ustaadCorrectRoutes } from './correct';
import { ustaadLocalRoutes } from './local';
import { ustaadMemberRoutes } from './members';

const accessRoute = createRoute({
  method: 'get',
  path: '/ustaad-access',
  tags: ['ustaad'],
  summary: 'Which access mode is on (off | staff_preview | open); no sign-in, no network data',
  responses: {
    200: json(z.object({ access: z.enum(USTAAD_ACCESS_MODES) }), 'Access mode'),
    ...errorResponses,
  },
});

export function ustaadRoutes(deps: AppDeps, sessions: SessionCache, access: UstaadAccessCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/ustaad-access',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerIp, (c) => c.get('clientIp')),
  );
  app.use('/ustaad/*', ustaadGate(deps, sessions, access));
  app.openapi(accessRoute, async (c) => {
    c.header('Cache-Control', 'public, max-age=30');
    return c.json({ access: await access.get() }, 200);
  });
  app.route('/', ustaadMemberRoutes(deps, sessions));
  app.route('/', ustaadMediaRoutes(deps));
  // B: app.route('/', ustaadProfileRoutes(deps, sessions)); app.route('/', ustaadVerificationRoutes(deps));
  // C: app.route('/', ustaadQaRoutes(deps)); app.route('/', ustaadLearnRoutes(deps));
  // D: app.route('/', ustaadPostRoutes(deps)); app.route('/', ustaadFeedRoutes(deps)); …
  app.route('/', ustaadLocalRoutes(deps));
  app.route('/', ustaadCorrectRoutes(deps));
  // F: app.route('/', ustaadReportRoutes(deps));
  return app;
}
