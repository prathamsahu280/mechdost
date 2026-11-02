import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { blockCustomer, cityScopeFrom, liftCustomerBlock, listCustomerBlocks } from '@mechdost/db/repo';
import type { Permission } from '@mechdost/shared/rbac';
import { createMiddleware } from 'hono/factory';
import { Forbidden } from '../errors';
import { CUSTOMER_BLOCK_LEVELS, CUSTOMER_BLOCK_REASONS } from '@mechdost/shared/customers';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Customer blocks for staff (research/admin-console.md §5): verified staff; history needs `customers:read`,
 * blocking and lifting need `customers:block`. Notes are staff-only text, never shown to the customer.
 */
const Uuid = z.uuid();
const BlockBody = z
  .object({
    level: z.enum(CUSTOMER_BLOCK_LEVELS),
    reasonCode: z.enum(CUSTOMER_BLOCK_REASONS),
    note: z.string().trim().min(1).max(500).nullable().optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .openapi('CustomerBlockCreate');
const LiftBody = z
  .object({ version: z.number().int().min(1), reason: z.string().trim().min(5).max(300) })
  .strict()
  .openapi('CustomerBlockLift');
const Block = z
  .object({
    id: z.string(),
    level: z.string(),
    reasonCode: z.string(),
    note: z.string().nullable(),
    endsAt: z.string().nullable(),
    createdAt: z.string(),
    liftedAt: z.string().nullable(),
    liftedReason: z.string().nullable(),
    inForce: z.boolean(),
    version: z.number().int(),
  })
  .openapi('CustomerBlock');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const userParam = z.object({ userId: Uuid.openapi({ param: { name: 'userId', in: 'path' } }) });

const list = createRoute({
  method: 'get',
  path: '/admin/customers/{userId}/blocks',
  tags: ['admin'],
  summary: 'Block history of a customer (newest first)',
  security: [{ bearerAuth: [] }],
  request: { params: userParam },
  responses: { 200: json(z.object({ blocks: z.array(Block) }), 'Blocks'), ...errorResponses },
});

const create = createRoute({
  method: 'post',
  path: '/admin/customers/{userId}/blocks',
  tags: ['admin'],
  summary: 'Block a customer at one level (cod_only, orders, full) with a reason code',
  security: [{ bearerAuth: [] }],
  request: {
    params: userParam,
    body: { required: true, content: { 'application/json': { schema: BlockBody } } },
  },
  responses: {
    201: json(z.object({ id: z.string(), version: z.number().int() }), 'Blocked'),
    404: json(ErrorSchema, 'No such customer'),
    409: json(ErrorSchema, 'Already blocked at this level'),
    ...errorResponses,
  },
});

const lift = createRoute({
  method: 'post',
  path: '/admin/customers/blocks/{blockId}/lift',
  tags: ['admin'],
  summary: 'Lift a block (compare-and-set on version, reason required)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ blockId: Uuid.openapi({ param: { name: 'blockId', in: 'path' } }) }),
    body: { required: true, content: { 'application/json': { schema: LiftBody } } },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Lifted'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'Changed or already lifted'),
    ...errorResponses,
  },
});

export function adminCustomerRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/admin/customers/*', authenticate(deps, cache));
  app.use(
    '/admin/customers/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/customers/*', requireVerified);
  app.use('/admin/customers/*', requirePermission('customers:read'));
  app.on('POST', '/admin/customers/*', requirePermission('customers:block'));
  // Customers have no home city yet, so a city-scoped grant cannot be narrowed to "its" customers: require an
  // all-cities grant until customers carry a city (security review 2026-11-03; Q65).
  const globalOnly = (permission: Permission) =>
    createMiddleware<AppEnv>(async (c, next) => {
      if (!cityScopeFrom(c.get('auth').grants, permission).all)
        throw Forbidden('SCOPE_REQUIRED', 'This needs an all-cities role');
      await next();
    });
  app.use('/admin/customers/*', globalOnly('customers:read'));
  app.on('POST', '/admin/customers/*', globalOnly('customers:block'));

  return app
    .openapi(list, async (c) => {
      const rows = await listCustomerBlocks(deps.db, c.req.valid('param').userId);
      return c.json(
        {
          blocks: rows.map((b) => ({
            ...b,
            endsAt: iso(b.endsAt),
            createdAt: b.createdAt.toISOString(),
            liftedAt: iso(b.liftedAt),
          })),
        },
        200,
      );
    })
    .openapi(create, async (c) => {
      const body = c.req.valid('json');
      const row = await blockCustomer(deps.db, {
        userId: c.req.valid('param').userId,
        level: body.level,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(row, 201);
    })
    .openapi(lift, async (c) => {
      const body = c.req.valid('json');
      const result = await liftCustomerBlock(deps.db, {
        blockId: c.req.valid('param').blockId,
        expectedVersion: body.version,
        reason: body.reason,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(result, 200);
    });
}
