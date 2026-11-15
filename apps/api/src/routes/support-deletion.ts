import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  DeletionBlockedError,
  confirmAccountDeletion,
  requestAccountDeletion,
  ticketScopeFrom,
} from '@mechdost/db/repo';
import { ApiError } from '../errors';
import { requirePermission } from '../middleware/auth';
import { enforceRate } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Account deletion request (design 2026-11-15 item 7; spec 01 "deletion request creates a support ticket; staff
 * confirms"). Mounted inside `supportRoutes`, so sign-in, the per-user limit and the `tickets:*` guards of `/support/*`
 * and `/admin/support/*` already apply. Nothing is deleted by these routes: confirming records the step (Q122).
 */
const ASK_RATE: RateRule = { name: 'support_deletion_request_user', limit: 5, windowSeconds: 3600 };

const Code = z
  .string()
  .regex(/^REQ-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'REQ-RPR-2026-7K3Q9X' });
const Ask = z
  .object({ note: z.string().trim().max(2000).optional() })
  .strict()
  .openapi('AccountDeletionRequest');
const Confirm = z
  .object({ version: z.number().int().min(1) })
  .strict()
  .openapi('AccountDeletionConfirm');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const ask = createRoute({
  method: 'post',
  path: '/support/deletion-request',
  tags: ['support'],
  summary:
    'Ask MechDost to delete your account (opens one request; support confirms; blocked while orders are open)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: false, content: { 'application/json': { schema: Ask } } } },
  responses: {
    201: json(z.object({ code: z.string(), created: z.boolean() }), 'Opened'),
    200: json(z.object({ code: z.string(), created: z.boolean() }), 'You already have an open request'),
    409: json(ErrorSchema, 'DELETION_BLOCKED, with `details.blockers`'),
    ...errorResponses,
  },
});

const confirm = createRoute({
  method: 'post',
  path: '/admin/support/tickets/{code}/deletion/confirm',
  tags: ['admin'],
  summary:
    'Confirm a deletion request after checking who asked (needs customers:block; records the step only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: { required: true, content: { 'application/json': { schema: Confirm } } },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Confirmed'),
    404: json(ErrorSchema, 'Not found'),
    409: json(
      ErrorSchema,
      'STALE_TICKET, DELETION_ALREADY_CONFIRMED, DELETION_BLOCKED, NOT_A_DELETION_REQUEST',
    ),
    ...errorResponses,
  },
});

/** The reasons travel as codes in `details`, so the screen can name each one (hard rule 10). */
function blocked(err: unknown): never {
  if (err instanceof DeletionBlockedError)
    throw new ApiError(409, 'DELETION_BLOCKED', err.message, { blockers: err.blockers });
  throw err;
}

export function supportDeletionRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.on('POST', '/admin/support/tickets/:code/deletion/confirm', requirePermission('customers:block'));
  return app
    .openapi(ask, async (c) => {
      const user = c.get('auth').user.id;
      await enforceRate(c, deps.rateLimiter, ASK_RATE, user);
      const body = c.req.valid('json') as z.infer<typeof Ask> | undefined;
      const result = await requestAccountDeletion(deps.db, {
        userId: user,
        defaultCityCode: deps.config.defaultCityCode,
        note: body?.note ?? null,
      }).catch(blocked);
      return c.json(result, result.created ? 201 : 200);
    })
    .openapi(confirm, async (c) => {
      const { grants, user } = c.get('auth');
      const result = await confirmAccountDeletion(deps.db, ticketScopeFrom(grants, 'tickets:reply'), {
        staffUserId: user.id,
        code: c.req.valid('param').code,
        expectedVersion: c.req.valid('json').version,
      }).catch(blocked);
      return c.json(result, 200);
    });
}
