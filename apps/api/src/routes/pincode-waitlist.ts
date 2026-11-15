import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityScopeFrom,
  joinWaitlist,
  leaveWaitlist,
  listMyWaitlist,
  waitlistDemand,
} from '@mechdost/db/repo';
import {
  WAITLIST_PIN_RE,
  WaitlistDemandDto,
  WaitlistEntryDto,
  WaitlistJoinBodySchema,
  WaitlistListDto,
} from '@mechdost/shared/waitlist';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * "Notify me" for a PIN that is not served (spec 15 waitlist, design 2026-11-15 item 7). Signed-in customers only
 * (account permission; the repository also needs a verified phone or email, so there is no guest form and nobody
 * can have MechDost message an address they typed). Per-person write limit. The admin view (`cities:manage`, city
 * scoped) shows how many customers wait for each PIN: the launch checklist.
 */
export const WAITLIST_WRITE_RATE: RateRule = { name: 'waitlist_write', limit: 20, windowSeconds: 3600 };

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const security = [{ bearerAuth: [] }];
const Pin = z
  .string()
  .regex(WAITLIST_PIN_RE)
  .openapi({ param: { name: 'pincode', in: 'path' }, example: '492099' });

const mine = createRoute({
  method: 'get',
  path: '/me/pincode-waitlist',
  tags: ['waitlist'],
  summary: 'The PIN codes you asked to be told about',
  security,
  responses: { 200: json(WaitlistListDto, 'Your waits'), ...errorResponses },
});
const join = createRoute({
  method: 'post',
  path: '/me/pincode-waitlist',
  tags: ['waitlist'],
  summary: 'Ask to be told when MechDost reaches a PIN code (up to five; joining twice is the same wait)',
  security,
  request: { body: { required: true, content: { 'application/json': { schema: WaitlistJoinBodySchema } } } },
  responses: {
    201: json(WaitlistEntryDto, 'Waiting'),
    409: json(ErrorSchema, 'MechDost already serves this PIN'),
    422: json(ErrorSchema, 'You already wait for five PIN codes'),
    ...errorResponses,
  },
});
const leave = createRoute({
  method: 'delete',
  path: '/me/pincode-waitlist/{pincode}',
  tags: ['waitlist'],
  summary: 'Stop waiting for a PIN code',
  security,
  request: { params: z.object({ pincode: Pin }) },
  responses: {
    200: json(z.object({ removed: z.literal(true) }), 'Removed'),
    404: json(ErrorSchema, 'You are not waiting for it'),
    ...errorResponses,
  },
});
const demand = createRoute({
  method: 'get',
  path: '/admin/pincode-waitlist',
  tags: ['admin'],
  summary: 'Customers waiting per PIN code (launch checklist), most wanted first, within your cities',
  security,
  responses: { 200: json(WaitlistDemandDto, 'Demand'), ...errorResponses },
});

export function pincodeWaitlistRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/me/pincode-waitlist', '/me/pincode-waitlist/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.on(['GET'], path, requirePermission('account:read'));
    app.on(['POST', 'DELETE'], path, requirePermission('account:write'));
    app.on(
      ['POST', 'DELETE'],
      path,
      rateLimit(deps.rateLimiter, WAITLIST_WRITE_RATE, (c) => c.get('auth').user.id),
    );
  }
  app.use('/admin/pincode-waitlist', authenticate(deps, cache));
  app.use(
    '/admin/pincode-waitlist',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/pincode-waitlist', requireVerified);
  app.use('/admin/pincode-waitlist', requirePermission('cities:manage'));

  return app
    .openapi(mine, async (c) =>
      c.json({ entries: await listMyWaitlist(deps.db, c.get('auth').user.id) }, 200),
    )
    .openapi(join, async (c) =>
      c.json(
        await joinWaitlist(deps.db, { userId: c.get('auth').user.id, pincode: c.req.valid('json').pincode }),
        201,
      ),
    )
    .openapi(leave, async (c) => {
      await leaveWaitlist(deps.db, { userId: c.get('auth').user.id, pincode: c.req.valid('param').pincode });
      return c.json({ removed: true as const }, 200);
    })
    .openapi(demand, async (c) =>
      c.json(await waitlistDemand(deps.db, cityScopeFrom(c.get('auth').grants, 'cities:manage')), 200),
    );
}
