import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  TICKET_BODY_MAX,
  TICKET_KINDS,
  assignTicket,
  createSupportTicket,
  customerReplyTicket,
  getInboxTicket,
  getMyTicket,
  listAssignableAgents,
  listCannedReplies,
  listInbox,
  listMyTickets,
  saveCannedReply,
  setTicketStatus,
  staffReplyTicket,
  ticketScopeFrom,
  type InboxTicketView,
  type TicketView,
} from '@mechdost/db/repo';
import { SERVICE_CODE_RE } from '@mechdost/shared/service-requests';
import { TICKET_STATES } from '@mechdost/shared/state';
import { SLA_STATES } from '@mechdost/shared/support-sla';
import { CannedReplyBody } from '@mechdost/shared/support-inbox';
import type { SessionCache } from '../auth/session-cache';
import { SupportAttachment, SupportRefundInfo } from '@mechdost/shared/support-thread';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Grant, Permission } from '@mechdost/shared/rbac';
import { Forbidden } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';
import { supportThreadRoutes, withAttachmentUrls } from './support-threads';

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
  /** Photos of the message as short-lived signed URLs (design 2026-11-15). */
  attachments: z.array(SupportAttachment),
});

const Ticket = z
  .object({
    code: z.string(),
    kind: z.string(),
    status: z.enum(TICKET_STATES),
    channel: z.string(),
    orderCode: z.string().nullable(),
    issueCode: z.string().nullable(),
    serviceCode: z.string().nullable(),
    refund: SupportRefundInfo,
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
    issueCode: z.string().nullable(),
    slaAckDue: z.string(),
    slaResolveDue: z.string(),
    createdAt: z.string(),
    version: z.number().int(),
    serviceCode: z.string().nullable(),
    acknowledged: z.boolean(),
    firstRepliedAt: z.string().nullable(),
    sla: z.enum(SLA_STATES),
    customerName: z.string().nullable(),
    customerPhoneMasked: z.string().nullable(),
    isGuest: z.boolean(),
    assignee: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  })
  .openapi('SupportInboxItem');

const InboxTicket = Ticket.extend({
  staff: z.object({
    customerName: z.string().nullable(),
    customerPhoneMasked: z.string().nullable(),
    isGuest: z.boolean(),
    assignee: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
    assignedAt: z.string().nullable(),
    firstRepliedAt: z.string().nullable(),
    sla: z.enum(SLA_STATES),
    deletionConfirmedAt: z.string().nullable(),
  }),
}).openapi('SupportInboxTicket');

const CannedReply = z
  .object({
    id: z.string(),
    key: z.string(),
    titleEn: z.string(),
    titleHi: z.string(),
    bodyEn: z.string(),
    bodyHi: z.string(),
    active: z.boolean(),
    sortOrder: z.number().int(),
    version: z.number().int(),
  })
  .openapi('SupportCannedReply');
const Assign = z
  .object({ assigneeId: z.uuid().nullable(), version: z.number().int().min(1) })
  .strict()
  .openapi('SupportAssign');

const NewTicket = z
  .object({
    kind: z.enum(TICKET_KINDS),
    orderCode: z
      .string()
      .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/)
      .nullable()
      .optional(),
    /** The billed service job (SR-…) a `labour_redo` request is about; required for that kind. */
    serviceCode: z.string().regex(SERVICE_CODE_RE).nullable().optional(),
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
  .object({
    to: z.enum(['in_review', 'awaiting_customer', 'resolved', 'closed']),
    version: z.number().int().min(1),
  })
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

const createTicket = createRoute({
  method: 'post',
  path: '/support/tickets',
  tags: ['support'],
  summary: 'Raise a support request (5 a day); about one of your orders if `orderCode` is given',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: NewTicket } } } },
  responses: {
    201: json(z.object({ code: z.string() }), 'Created'),
    404: json(ErrorSchema, 'Order or service job not found'),
    409: json(ErrorSchema, 'LABOUR_REDO_OPEN: a redo request for this job is already open'),
    422: json(
      ErrorSchema,
      'Daily limit, invalid message, SERVICE_CODE_REQUIRED or LABOUR_PROMISE_UNAVAILABLE',
    ),
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
  request: {
    query: z.object({
      view: z.enum(['active', 'done']).optional(),
      /** `me`, `unassigned` or a staff user id. */
      assignee: z.union([z.enum(['me', 'unassigned']), z.uuid()]).optional(),
      status: z.enum(TICKET_STATES).optional(),
    }),
  },
  responses: { 200: json(z.object({ tickets: z.array(InboxItem) }), 'Inbox'), ...errorResponses },
});

const inboxTicket = createRoute({
  method: 'get',
  path: '/admin/support/tickets/{code}',
  tags: ['admin'],
  summary: 'A request with its full conversation, including internal notes',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: Code }) },
  responses: { 200: json(InboxTicket, 'Request'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
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

const assign = createRoute({
  method: 'post',
  path: '/admin/support/tickets/{code}/assign',
  tags: ['admin'],
  summary:
    'Assign a request to a support agent, or clear it (managers; an agent may take or release their own)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: { required: true, content: { 'application/json': { schema: Assign } } },
  },
  responses: {
    200: json(
      z.object({
        version: z.number().int(),
        assignee: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
      }),
      'Assigned',
    ),
    ...conflict,
    422: json(ErrorSchema, 'ASSIGNEE_INVALID'),
    ...errorResponses,
  },
});

const agents = createRoute({
  method: 'get',
  path: '/admin/support/agents',
  tags: ['admin'],
  summary: 'Support agents a request in your scope can be assigned to',
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(
      z.object({ agents: z.array(z.object({ id: z.string(), name: z.string().nullable() })) }),
      'Agents',
    ),
    ...errorResponses,
  },
});

const cannedList = createRoute({
  method: 'get',
  path: '/admin/support/canned-replies',
  tags: ['admin'],
  summary: 'Canned replies in English and Hindi (editors also see the switched-off ones)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(z.object({ replies: z.array(CannedReply), canEdit: z.boolean() }), 'Replies'),
    ...errorResponses,
  },
});

const cannedCreate = createRoute({
  method: 'post',
  path: '/admin/support/canned-replies',
  tags: ['admin'],
  summary: 'Add a canned reply (needs content:write)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: CannedReplyBody } } } },
  responses: {
    201: json(CannedReply, 'Created'),
    409: json(ErrorSchema, 'CANNED_REPLY_KEY_TAKEN'),
    422: json(ErrorSchema, 'CANNED_REPLY_INVALID'),
    ...errorResponses,
  },
});

const cannedUpdate = createRoute({
  method: 'put',
  path: '/admin/support/canned-replies/{id}',
  tags: ['admin'],
  summary: 'Edit or switch off a canned reply (needs content:write; compare-and-set on version)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) }),
    body: {
      required: true,
      content: {
        'application/json': { schema: CannedReplyBody.extend({ version: z.number().int().min(1) }) },
      },
    },
  },
  responses: {
    200: json(CannedReply, 'Saved'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'STALE_CANNED_REPLY or CANNED_REPLY_KEY_TAKEN'),
    422: json(ErrorSchema, 'CANNED_REPLY_INVALID'),
    ...errorResponses,
  },
});

/**
 * Canned replies are one global list, so editing needs the permission on a platform-wide grant: a city-scoped
 * `content:write` (city manager) must not change what every city's agents send (security review 2026-11-15).
 */
function hasGlobalGrant(grants: readonly Grant[], permission: Permission): boolean {
  return grants.some(
    (g) =>
      g.permissions.includes(permission) && g.cityId === null && g.shopId === null && g.workshopId === null,
  );
}

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
  // The manual refund from a ticket also needs the right to ask for refunds (finance approves it later).
  app.on('POST', '/admin/support/tickets/:code/refund', requirePermission('refunds:initiate'));
  const toJson = (t: TicketView) => withAttachmentUrls(t, deps.keyring);
  const toStaffJson = (t: InboxTicketView) => ({
    ...withAttachmentUrls(t, deps.keyring),
    staff: {
      ...t.staff,
      assignedAt: t.staff.assignedAt ? t.staff.assignedAt.toISOString() : null,
      firstRepliedAt: t.staff.firstRepliedAt ? t.staff.firstRepliedAt.toISOString() : null,
      deletionConfirmedAt: t.staff.deletionConfirmedAt ? t.staff.deletionConfirmedAt.toISOString() : null,
    },
  });
  // Canned replies: anyone who can reply may read the active ones; editing is `content:write` (checked per call).
  const editsCannedReplies = (c: Context<AppEnv>) => hasGlobalGrant(c.get('auth').grants, 'content:write');
  const requireGlobalContentWrite = createMiddleware<AppEnv>(async (c, next) => {
    if (!hasGlobalGrant(c.get('auth').grants, 'content:write')) throw Forbidden();
    await next();
  });
  app.on(['POST', 'PUT'], '/admin/support/canned-replies/*', requireGlobalContentWrite);
  app.on('POST', '/admin/support/canned-replies', requireGlobalContentWrite);
  app.on('GET', '/admin/support/canned-replies', requirePermission('tickets:reply'));
  app.route('/', supportThreadRoutes(deps));

  return app
    .openapi(createTicket, async (c) => {
      const body = c.req.valid('json');
      const created = await createSupportTicket(deps.db, {
        userId: c.get('auth').user.id,
        kind: body.kind,
        orderCode: body.orderCode ?? null,
        serviceCode: body.serviceCode ?? null,
        body: body.body,
        defaultCityCode: deps.config.defaultCityCode,
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
      const q = c.req.valid('query');
      const rows = await listInbox(deps.db, ticketScopeFrom(c.get('auth').grants), {
        view: q.view ?? 'active',
        assignee: q.assignee,
        status: q.status,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(
        {
          tickets: rows.map((r) => ({
            ...r,
            slaAckDue: r.slaAckDue.toISOString(),
            slaResolveDue: r.slaResolveDue.toISOString(),
            createdAt: r.createdAt.toISOString(),
            firstRepliedAt: r.firstRepliedAt ? r.firstRepliedAt.toISOString() : null,
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
      return c.json(toStaffJson(ticket), 200);
    })
    .openapi(staffReply, async (c) => {
      const body = c.req.valid('json');
      const result = await staffReplyTicket(deps.db, ticketScopeFrom(c.get('auth').grants, 'tickets:reply'), {
        staffUserId: c.get('auth').user.id,
        code: c.req.valid('param').code,
        body: body.body,
        internal: body.internal,
      });
      return c.json(result, 200);
    })
    .openapi(changeStatus, async (c) => {
      const body = c.req.valid('json');
      const result = await setTicketStatus(deps.db, ticketScopeFrom(c.get('auth').grants, 'tickets:reply'), {
        staffUserId: c.get('auth').user.id,
        code: c.req.valid('param').code,
        to: body.to,
        expectedVersion: body.version,
      });
      return c.json(result, 200);
    })
    .openapi(assign, async (c) => {
      const body = c.req.valid('json');
      const { grants, user } = c.get('auth');
      // The repository checks `tickets:assign` for this request's own city and, without it, lets the caller only
      // take a free request or release their own (security review 2026-11-15).
      const result = await assignTicket(
        deps.db,
        {
          reply: ticketScopeFrom(grants, 'tickets:reply'),
          assign: ticketScopeFrom(grants, 'tickets:assign'),
        },
        {
          staffUserId: user.id,
          code: c.req.valid('param').code,
          assigneeId: body.assigneeId,
          expectedVersion: body.version,
        },
      );
      return c.json(result, 200);
    })
    .openapi(agents, async (c) => {
      const list = await listAssignableAgents(
        deps.db,
        ticketScopeFrom(c.get('auth').grants, 'tickets:reply'),
      );
      return c.json({ agents: list }, 200);
    })
    .openapi(cannedList, async (c) => {
      const canEdit = editsCannedReplies(c);
      const replies = await listCannedReplies(deps.db, { includeInactive: canEdit });
      return c.json({ replies, canEdit }, 200);
    })
    .openapi(cannedCreate, async (c) => {
      const reply = await saveCannedReply(deps.db, {
        staffUserId: c.get('auth').user.id,
        ...c.req.valid('json'),
      });
      return c.json(reply, 201);
    })
    .openapi(cannedUpdate, async (c) => {
      const { version, ...body } = c.req.valid('json');
      const reply = await saveCannedReply(deps.db, {
        staffUserId: c.get('auth').user.id,
        id: c.req.valid('param').id,
        expectedVersion: version,
        ...body,
      });
      return c.json(reply, 200);
    });
}
