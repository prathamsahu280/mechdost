import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  TICKET_BODY_MAX,
  TICKET_KINDS,
  createSupportTicket,
  customerReplyTicket,
  getInboxTicket,
  getMyTicket,
  listInbox,
  listMyTickets,
  setTicketStatus,
  staffReplyTicket,
  ticketScopeFrom,
  type TicketView,
} from '@mechdost/db/repo';
import { TICKET_STATES } from '@mechdost/shared/state';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Support API (spec 09). Customers: raise, list, read and answer their own requests (foreign codes 404).
 * Staff (`tickets:read` / `tickets:reply`, verified): an inbox scoped by city, replies and internal notes, status
 * changes through the ticket state machine. Message text is user content: never logged.
 */
const Code = z
  .string()
  .regex(/^REQ-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'REQ-RPR-2026-7K3Q9X' });

const Message = z.object({
  id: z.string(),
  role: z.string(),
  body: z.string(),
  internal: z.boolean(),
  channel: z.string(),
  createdAt: z.string(),
});

const Ticket = z
  .object({
    code: z.string(),
    kind: z.string(),
    status: z.enum(TICKET_STATES),
    channel: z.string(),
    orderCode: z.string().nullable(),
    slaAckDue: z.string(),
    slaResolveDue: z.string(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
    version: z.number().int(),
    messages: z.array(Message),
  })
  .openapi('SupportTicket');

const InboxItem = z
  .object({
    code: z.string(),
    kind: z.string(),
    status: z.enum(TICKET_STATES),
    channel: z.string(),
    orderCode: z.string().nullable(),
    slaAckDue: z.string(),
    slaResolveDue: z.string(),
    createdAt: z.string(),
    version: z.number().int(),
    acknowledged: z.boolean(),
  })
  .openapi('SupportInboxItem');

const NewTicket = z
  .object({
    kind: z.enum(TICKET_KINDS),
    orderCode: z
      .string()
      .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/)
      .nullable()
      .optional(),
    body: z.string().min(1).max(TICKET_BODY_MAX),
  })
  .strict()
  .openapi('SupportTicketCreate');

const Reply = z
  .object({ body: z.string().min(1).max(TICKET_BODY_MAX) })
  .strict()
  .openapi('SupportReply');
const StaffReply = z
  .object({ body: z.string().min(1).max(TICKET_BODY_MAX), internal: z.boolean() })
  .strict()
  .openapi('SupportStaffReply');
const StatusChange = z
  .object({ to: z.enum(['in_review', 'resolved', 'closed']), version: z.number().int().min(1) })
  .strict()
  .openapi('SupportStatusChange');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = {
  409: json(ErrorSchema, 'Closed or changed meanwhile'),
  404: json(ErrorSchema, 'Not found'),
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
function toJson(t: TicketView) {
  return {
    ...t,
    slaAckDue: t.slaAckDue.toISOString(),
    slaResolveDue: t.slaResolveDue.toISOString(),
    resolvedAt: iso(t.resolvedAt),
    createdAt: t.createdAt.toISOString(),
    messages: t.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  };
}

const createTicket = createRoute({
  method: 'post',
  path: '/support/tickets',
  tags: ['support'],
  summary: 'Raise a support request (5 a day); about one of your orders if `orderCode` is given',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: NewTicket } } } },
  responses: {
    201: json(z.object({ code: z.string() }), 'Created'),
    404: json(ErrorSchema, 'Order not found'),
    422: json(ErrorSchema, 'Daily limit or invalid message'),
    ...errorResponses,
  },
});

const myTickets = createRoute({
  method: 'get',
  path: '/support/tickets',
  tags: ['support'],
  summary: 'Your requests, newest first',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(z.object({ tickets: z.array(Ticket) }), 'Requests'), ...errorResponses },
});

const myTicket = createRoute({
  method: 'get',
  path: '/support/tickets/{code}',
  tags: ['support'],
  summary: 'One of your requests with its conversation',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: Code }) },
  responses: { 200: json(Ticket, 'Request'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const reply = createRoute({
  method: 'post',
  path: '/support/tickets/{code}/messages',
  tags: ['support'],
  summary: 'Reply on your request (reopens it if it was waiting on you or resolved)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: { required: true, content: { 'application/json': { schema: Reply } } },
  },
  responses: {
    200: json(z.object({ status: z.enum(TICKET_STATES) }), 'Sent'),
    ...conflict,
    ...errorResponses,
  },
});

const inbox = createRoute({
  method: 'get',
  path: '/admin/support/tickets',
  tags: ['admin'],
  summary: 'Support inbox in your cities, earliest reply deadline first',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ view: z.enum(['active', 'done']).optional() }) },
  responses: { 200: json(z.object({ tickets: z.array(InboxItem) }), 'Inbox'), ...errorResponses },
});

const inboxTicket = createRoute({
  method: 'get',
  path: '/admin/support/tickets/{code}',
  tags: ['admin'],
  summary: 'A request with its full conversation, including internal notes',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: Code }) },
  responses: { 200: json(Ticket, 'Request'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const staffReply = createRoute({
  method: 'post',
  path: '/admin/support/tickets/{code}/messages',
  tags: ['admin'],
  summary: 'Reply to the customer, or add an internal note',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: { required: true, content: { 'application/json': { schema: StaffReply } } },
  },
  responses: {
    200: json(z.object({ status: z.enum(TICKET_STATES) }), 'Sent'),
    ...conflict,
    ...errorResponses,
  },
});

const changeStatus = createRoute({
  method: 'post',
  path: '/admin/support/tickets/{code}/status',
  tags: ['admin'],
  summary: 'Resolve, reopen or close a request (ticket state machine, compare-and-set)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: { required: true, content: { 'application/json': { schema: StatusChange } } },
  },
  responses: {
    200: json(z.object({ status: z.enum(TICKET_STATES), version: z.number().int() }), 'Changed'),
    ...conflict,
    ...errorResponses,
  },
});

export function supportRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/support/*', '/admin/support/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  app.use('/support/*', requirePermission('tickets:create'));
  // Staff: phone + email verified (spec 01), then the permission; scope comes from their grants.
  app.use('/admin/support/*', requireVerified);
  app.use('/admin/support/*', requirePermission('tickets:read'));
  app.on('POST', '/admin/support/tickets/:code/*', requirePermission('tickets:reply'));

  return app
    .openapi(createTicket, async (c) => {
      const body = c.req.valid('json');
      const created = await createSupportTicket(deps.db, {
        userId: c.get('auth').user.id,
        kind: body.kind,
        orderCode: body.orderCode ?? null,
        body: body.body,
        defaultCityCode: deps.config.supportDefaultCityCode,
      });
      return c.json(created, 201);
    })
    .openapi(myTickets, async (c) => {
      const tickets = await listMyTickets(deps.db, c.get('auth').user.id);
      return c.json({ tickets: tickets.map(toJson) }, 200);
    })
    .openapi(myTicket, async (c) => {
      const ticket = await getMyTicket(deps.db, c.get('auth').user.id, c.req.valid('param').code);
      return c.json(toJson(ticket), 200);
    })
    .openapi(reply, async (c) => {
      const result = await customerReplyTicket(deps.db, {
        userId: c.get('auth').user.id,
        code: c.req.valid('param').code,
        body: c.req.valid('json').body,
      });
      return c.json(result, 200);
    })
    .openapi(inbox, async (c) => {
      const rows = await listInbox(deps.db, ticketScopeFrom(c.get('auth').grants), {
        view: c.req.valid('query').view ?? 'active',
      });
      return c.json(
        {
          tickets: rows.map((r) => ({
            ...r,
            slaAckDue: r.slaAckDue.toISOString(),
            slaResolveDue: r.slaResolveDue.toISOString(),
            createdAt: r.createdAt.toISOString(),
          })),
        },
        200,
      );
    })
    .openapi(inboxTicket, async (c) => {
      const ticket = await getInboxTicket(
        deps.db,
        ticketScopeFrom(c.get('auth').grants),
        c.req.valid('param').code,
      );
      return c.json(toJson(ticket), 200);
    })
    .openapi(staffReply, async (c) => {
      const body = c.req.valid('json');
      const result = await staffReplyTicket(deps.db, ticketScopeFrom(c.get('auth').grants), {
        staffUserId: c.get('auth').user.id,
        code: c.req.valid('param').code,
        body: body.body,
        internal: body.internal,
      });
      return c.json(result, 200);
    })
    .openapi(changeStatus, async (c) => {
      const body = c.req.valid('json');
      const result = await setTicketStatus(deps.db, ticketScopeFrom(c.get('auth').grants), {
        staffUserId: c.get('auth').user.id,
        code: c.req.valid('param').code,
        to: body.to,
        expectedVersion: body.version,
      });
      return c.json(result, 200);
    });
}
