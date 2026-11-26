/**
 * Ustaad message routes (spec 23 § 8 "Messages", SR-33–35; workstream D2): request-only conversations. Behind the gate
 * and the member guard (bound to `/ustaad/threads` only). Limits per member (SR-43): 20 new threads a day (plus the
 * admin cap `limits.new_threads_per_day` in the repository), 120 messages an hour, reads with the member read rule.
 * Accept and decline are separate paths so they never shadow `POST …/{id}/messages`.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  listUstaadThreads,
  markUstaadThreadRead,
  moveUstaadThread,
  muteUstaadThread,
  sendUstaadMessage,
  startUstaadThread,
  ustaadThreadMessages,
} from '@mechdost/db/repo';
import {
  MessageListQueryDto,
  MessagePageDto,
  SendMessageDto,
  StartThreadDto,
  ThreadIdParamDto,
  ThreadListQueryDto,
  ThreadMuteDto,
  ThreadPageDto,
} from '@mechdost/shared/ustaad/dto/messages';
import { USTAAD_THREAD_STATUSES } from '@mechdost/shared/state';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';
import { onUstaadPaths, ustaadActor } from './social';

const sec = [{ bearerAuth: [] }];
const tags = ['ustaad'];
const Sent = z.object({ messageId: z.uuid(), pending: z.boolean() });
const Status = z.object({ status: z.enum(USTAAD_THREAD_STATUSES) });

const r = {
  list: createRoute({
    method: 'get',
    path: '/ustaad/threads',
    tags,
    security: sec,
    summary: 'Inbox (open), requests to me, or my requests waiting; newest activity first',
    request: { query: ThreadListQueryDto },
    responses: { 200: json(ThreadPageDto, 'Threads'), ...errorResponses },
  }),
  start: createRoute({
    method: 'post',
    path: '/ustaad/threads',
    tags,
    security: sec,
    summary:
      'Start a conversation: a text-only request (no link; phone and UPI masked) unless they take messages',
    request: { body: body(StartThreadDto) },
    responses: {
      201: json(
        z.object({
          threadId: z.uuid(),
          status: z.enum(USTAAD_THREAD_STATUSES),
          messageId: z.uuid(),
          pending: z.boolean(),
        }),
        'Started',
      ),
      ...conflict,
      ...errorResponses,
    },
  }),
  accept: createRoute({
    method: 'post',
    path: '/ustaad/threads/{id}/accept',
    tags,
    security: sec,
    summary: 'Accept a message request (the receiver)',
    request: { params: ThreadIdParamDto },
    responses: { 200: json(Status, 'Open'), ...conflict, ...errorResponses },
  }),
  decline: createRoute({
    method: 'post',
    path: '/ustaad/threads/{id}/decline',
    tags,
    security: sec,
    summary: 'Decline a message request (the receiver; the sender is not told why)',
    request: { params: ThreadIdParamDto },
    responses: { 200: json(Status, 'Declined'), ...conflict, ...errorResponses },
  }),
  messages: createRoute({
    method: 'get',
    path: '/ustaad/threads/{id}/messages',
    tags,
    security: sec,
    summary: 'A conversation, newest first, with read receipts on my messages',
    request: { params: ThreadIdParamDto, query: MessageListQueryDto },
    responses: { 200: json(MessagePageDto, 'Messages'), ...errorResponses },
  }),
  send: createRoute({
    method: 'post',
    path: '/ustaad/threads/{id}/messages',
    tags,
    security: sec,
    summary: 'Send text, a voice note, a photo or a post (open conversations only)',
    request: { params: ThreadIdParamDto, body: body(SendMessageDto) },
    responses: { 201: json(Sent, 'Sent'), ...conflict, ...errorResponses },
  }),
  read: createRoute({
    method: 'post',
    path: '/ustaad/threads/{id}/read',
    tags,
    security: sec,
    summary: 'Mark the conversation read (read receipt)',
    request: { params: ThreadIdParamDto },
    responses: { 200: json(z.object({ ok: z.literal(true) }), 'Read'), ...errorResponses },
  }),
  mute: createRoute({
    method: 'put',
    path: '/ustaad/threads/{id}/mute',
    tags,
    security: sec,
    summary: 'Mute or unmute notices from this conversation',
    request: { params: ThreadIdParamDto, body: body(ThreadMuteDto) },
    responses: { 200: json(z.object({ muted: z.boolean() }), 'Saved'), ...errorResponses },
  }),
};

export function ustaadMessageRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const limit = (rule: (typeof USTAAD_RATE_RULES)[keyof typeof USTAAD_RATE_RULES]) =>
    rateLimit(deps.rateLimiter, rule, userKey);
  app.use('/ustaad/*', onUstaadPaths(['/ustaad/threads'], requireUstaadMember(deps)));
  app.on('GET', ['/ustaad/threads', '/ustaad/threads/*'], limit(USTAAD_RATE_RULES.memberReads));
  app.on('POST', '/ustaad/threads', limit(USTAAD_RATE_RULES.newThreads));
  app.on(['POST', 'PUT'], '/ustaad/threads/*', limit(USTAAD_RATE_RULES.messages));

  return app
    .openapi(r.list, async (c) =>
      c.json(await listUstaadThreads(deps.db, ustaadActor(c), c.req.valid('query')), 200),
    )
    .openapi(r.start, async (c) =>
      c.json(await startUstaadThread(deps.db, ustaadActor(c), c.req.valid('json')), 201),
    )
    .openapi(r.accept, async (c) =>
      c.json(await moveUstaadThread(deps.db, ustaadActor(c), c.req.valid('param').id, 'accept'), 200),
    )
    .openapi(r.decline, async (c) =>
      c.json(await moveUstaadThread(deps.db, ustaadActor(c), c.req.valid('param').id, 'decline'), 200),
    )
    .openapi(r.messages, async (c) =>
      c.json(
        await ustaadThreadMessages(deps.db, ustaadActor(c), c.req.valid('param').id, c.req.valid('query')),
        200,
      ),
    )
    .openapi(r.send, async (c) =>
      c.json(
        await sendUstaadMessage(deps.db, ustaadActor(c), c.req.valid('param').id, c.req.valid('json')),
        201,
      ),
    )
    .openapi(r.read, async (c) =>
      c.json(await markUstaadThreadRead(deps.db, ustaadActor(c), c.req.valid('param').id), 200),
    )
    .openapi(r.mute, async (c) =>
      c.json(
        await muteUstaadThread(deps.db, ustaadActor(c), c.req.valid('param').id, c.req.valid('json').muted),
        200,
      ),
    );
}
