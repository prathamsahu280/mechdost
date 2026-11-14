import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  blockCustomer,
  cityScopeFrom,
  customerView,
  liftCustomerBlock,
  listCustomerBlocks,
  searchCustomers,
} from '@mechdost/db/repo';
import { CustomerSearchDto, CustomerViewDto } from '@mechdost/shared/admin-people-api';
import { can, type Permission } from '@mechdost/shared/rbac';
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

const search = createRoute({
  method: 'get',
  path: '/admin/customers/search',
  tags: ['admin'],
  summary:
    'Find a customer by phone (10 digits), email, order/request/ticket code or name prefix (max 20, masked)',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ q: z.string().max(120) }).strict() },
  responses: { 200: json(CustomerSearchDto, 'Matches'), ...errorResponses },
});

const view = createRoute({
  method: 'get',
  path: '/admin/customers/{userId}',
  tags: ['admin'],
  summary:
    'One customer: profile, orders, requests, tickets, refunds, coins, consents (contact masked without customers:read_pii)',
  security: [{ bearerAuth: [] }],
  request: { params: userParam },
  responses: {
    200: json(CustomerViewDto, 'Customer'),
    404: json(ErrorSchema, 'No such customer'),
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

  app.use(
    '/admin/customers/search',
    rateLimit(deps.rateLimiter, RATE_RULES.adminSearch, (c) => c.get('auth').user.id),
  );

  return app
    .openapi(search, async (c) => {
      const out = await searchCustomers(deps.db, { q: c.req.valid('query').q });
      c.header('Cache-Control', 'no-store');
      return c.json(
        { kind: out.kind, results: out.results.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) },
        200,
      );
    })
    .openapi(view, async (c) => {
      const { grants, user } = c.get('auth');
      const v = await customerView(deps.db, {
        customerId: c.req.valid('param').userId,
        viewerId: user.id,
        canReadPii: can(grants, 'customers:read_pii'),
        sections: {
          orders: can(grants, 'orders:read'),
          serviceRequests: can(grants, 'service:read'),
          tickets: can(grants, 'tickets:read'),
          refunds: can(grants, 'refunds:read'),
          coins: can(grants, 'coins:read'),
        },
      });
      const at = <T extends { at: Date }>(r: T) => ({ ...r, at: r.at.toISOString() });
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          profile: { ...v.profile, createdAt: v.profile.createdAt.toISOString() },
          orders: v.orders?.map(at) ?? null,
          serviceRequests: v.serviceRequests?.map(at) ?? null,
          tickets: v.tickets?.map(at) ?? null,
          refunds: v.refunds?.map(at) ?? null,
          coins: v.coins,
          consents: v.consents.map(at),
        },
        200,
      );
    })
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
