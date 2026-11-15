import { createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createGuestTicket, getGuestTicket, guestReplyTicket, type TicketView } from '@mechdost/db/repo';
import {
  GUEST_LOOKUPS_PER_CODE,
  GUEST_LOOKUPS_PER_IP,
  GUEST_TICKETS_PER_IP_PER_HOUR,
  GUEST_TICKETS_PER_PHONE_PER_DAY,
  GuestCreated,
  GuestLookupBody,
  GuestReplied,
  GuestReplyBody,
  GuestTicket,
  GuestTicketBody,
} from '@mechdost/shared/support-guest';
import { ApiError } from '../errors';
import { log, safeError } from '../logger';
import { enforceRate, rateLimit } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Guest tickets (design 2026-11-15 item 6; spec 09 and 13), public: no sign-in. The form needs Turnstile; every route
 * is rate limited per address, new tickets also per phone number, and every lookup or reply per reference (key
 * guessing). The private key is returned once, at creation. A wrong key and an unknown reference give the same 404.
 * Nothing is emailed or messaged to the name, number or anything else a guest typed (project rule: no relay from
 * public forms). Mounted under `/support-guest/*`, never `/support/*`, which sits behind sign-in.
 */
const CREATE_PER_IP: RateRule = {
  name: 'support_guest_create_ip',
  limit: GUEST_TICKETS_PER_IP_PER_HOUR,
  windowSeconds: 3600,
};
const CREATE_PER_PHONE: RateRule = {
  name: 'support_guest_create_phone',
  limit: GUEST_TICKETS_PER_PHONE_PER_DAY,
  windowSeconds: 86_400,
};
const ACCESS_PER_IP: RateRule = {
  name: 'support_guest_access_ip',
  limit: GUEST_LOOKUPS_PER_IP,
  windowSeconds: 600,
};
const ACCESS_PER_CODE: RateRule = {
  name: 'support_guest_access_code',
  limit: GUEST_LOOKUPS_PER_CODE,
  windowSeconds: 3600,
};

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

/** The shared schema reads unknown kinds leniently; the route's contract is plain strings like the signed-in routes. */
const GuestTicketOut = GuestTicket.extend({
  kind: z.string(),
  channel: z.string(),
  issueCode: z.string().nullable(),
});

const createTicket = createRoute({
  method: 'post',
  path: '/support-guest/tickets',
  tags: ['support'],
  summary: 'Write to MechDost support without an account (public; Turnstile). Returns the private key once.',
  request: body(GuestTicketBody),
  responses: {
    201: json(GuestCreated, 'Created'),
    422: json(ErrorSchema, 'GUEST_PHONE_INVALID, GUEST_DAILY_LIMIT or an invalid message'),
    ...errorResponses,
  },
});
const lookup = createRoute({
  method: 'post',
  path: '/support-guest/lookup',
  tags: ['support'],
  summary: 'Read a guest request with its reference and private key',
  request: body(GuestLookupBody),
  responses: { 200: json(GuestTicketOut, 'Request'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});
const reply = createRoute({
  method: 'post',
  path: '/support-guest/reply',
  tags: ['support'],
  summary: 'Reply on a guest request (reopens it if it was waiting on you or resolved)',
  request: body(GuestReplyBody),
  responses: {
    200: json(GuestReplied, 'Sent'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'Closed'),
    ...errorResponses,
  },
});

const phoneKey = (phone: string) => createHash('sha256').update(`support_guest:${phone}`).digest('hex');

export function supportGuestRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/support-guest/tickets',
    rateLimit(deps.rateLimiter, CREATE_PER_IP, (c) => c.get('clientIp')),
  );
  for (const path of ['/support-guest/lookup', '/support-guest/reply'])
    app.use(
      path,
      rateLimit(deps.rateLimiter, ACCESS_PER_IP, (c) => c.get('clientIp')),
    );

  async function human(c: Context<AppEnv>, token: string) {
    if (!deps.turnstile) throw new ApiError(503, 'UNAVAILABLE', 'This form is not available right now');
    let ok: boolean;
    try {
      ok = await deps.turnstile.verify(token, c.get('clientIp'));
    } catch (err) {
      log('error', 'turnstile_unavailable', safeError(err));
      throw new ApiError(503, 'UNAVAILABLE', 'Please try again in a minute');
    }
    if (!ok) throw new ApiError(400, 'TURNSTILE_FAILED', 'Complete the check and try again');
  }

  const toJson = (t: TicketView) => ({
    ...t,
    slaAckDue: t.slaAckDue.toISOString(),
    slaResolveDue: t.slaResolveDue.toISOString(),
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    deletionConfirmedAt: null,
    createdAt: t.createdAt.toISOString(),
    // A guest sees the conversation only; guests have no photos, orders or refund.
    refund: { eligible: false, destination: null },
    messages: t.messages.map(({ attachments: _photos, ...m }) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      attachments: [],
    })),
  });

  return app
    .openapi(createTicket, async (c) => {
      const b = c.req.valid('json');
      await human(c, b.turnstileToken);
      await enforceRate(c, deps.rateLimiter, CREATE_PER_PHONE, phoneKey(b.phone), 1);
      const made = await createGuestTicket(deps.db, {
        name: b.name,
        phone: b.phone,
        kind: b.kind,
        body: b.body,
        defaultCityCode: deps.config.defaultCityCode,
      });
      return c.json(made, 201);
    })
    .openapi(lookup, async (c) => {
      const b = c.req.valid('json');
      await enforceRate(c, deps.rateLimiter, ACCESS_PER_CODE, b.code);
      return c.json(toJson(await getGuestTicket(deps.db, b.code, b.key)), 200);
    })
    .openapi(reply, async (c) => {
      const b = c.req.valid('json');
      await enforceRate(c, deps.rateLimiter, ACCESS_PER_CODE, b.code);
      return c.json(await guestReplyTicket(deps.db, { code: b.code, key: b.key, body: b.body }), 200);
    });
}
