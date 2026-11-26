/**
 * Ustaad follow, connect, block and mute routes (spec 23 § 8 "Graph"; workstream D2). Behind `ustaadGate`
 * (index.ts) and `requireUstaadMember`, so a non-member gets the generic 404 before validation. The member guard and
 * rate limits are bound only to this file's own path prefixes (L171/L190: a `use` on a shared `/ustaad/*` prefix would
 * also guard other workstreams' routes). Limits per member (SR-43): follows 20 a day (plus the admin daily cap in the
 * repository), connection requests 20 a day, block/mute with the membership write rule, reads with the member read
 * rule. The repositories enforce the rest and never return a phone number (SR-34).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import {
  blockUstaadMember,
  followUstaadMember,
  listUstaadBlocks,
  listUstaadMemberPosts,
  listUstaadConnections,
  listUstaadFollows,
  moveUstaadConnection,
  muteUstaadMember,
  removeUstaadFollower,
  requestUstaadConnection,
  unblockUstaadMember,
  unfollowUstaadMember,
  ustaadProfileByHandle,
  ustaadRelationship,
} from '@mechdost/db/repo';
import {
  BlockListDto,
  ConnectionActionParamDto,
  ConnectionListQueryDto,
  ConnectionPageDto,
  ConnectRequestDto,
  FollowListQueryDto,
  FollowResultDto,
  HandleParamDto,
  MemberIdParamDto,
  MemberPageDto,
  ProfileViewDto,
  RelationshipDto,
} from '@mechdost/shared/ustaad/dto/social';
import { FeedPageDto, PageQueryDto } from '@mechdost/shared/ustaad/dto/feed';
import { USTAAD_CONNECTION_STATUSES } from '@mechdost/shared/state';
import { ApiError } from '../../errors';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const sec = [{ bearerAuth: [] }];
const tags = ['ustaad'];
const ConnectionMoved = z.object({ id: z.uuid(), status: z.enum(USTAAD_CONNECTION_STATUSES) });

/** Runs `mw` only for paths under one of `prefixes` (exact or followed by `/` or `?`). */
export function onUstaadPaths(
  prefixes: readonly string[],
  mw: MiddlewareHandler<AppEnv>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.req.path.replace(/^\/v1/, '');
    if (prefixes.some((x) => p === x || p.startsWith(`${x}/`))) return mw(c, next);
    await next();
  };
}

/** The acting member (the guard put it on the context). */
export function ustaadActor(c: Context<AppEnv>): { userId: string; memberId: string } {
  const member = c.get('ustaadMember');
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  return { userId: c.get('auth').user.id, memberId: member.id };
}

const r = {
  follow: createRoute({
    method: 'put',
    path: '/ustaad/follows/{memberId}',
    tags,
    security: sec,
    summary: 'Follow a member (idempotent; no approval; 20 a day)',
    request: { params: MemberIdParamDto },
    responses: { 200: json(FollowResultDto, 'Following'), ...errorResponses },
  }),
  unfollow: createRoute({
    method: 'delete',
    path: '/ustaad/follows/{memberId}',
    tags,
    security: sec,
    summary: 'Unfollow (idempotent)',
    request: { params: MemberIdParamDto },
    responses: { 200: json(FollowResultDto, 'Not following'), ...errorResponses },
  }),
  follows: createRoute({
    method: 'get',
    path: '/ustaad/follows',
    tags,
    security: sec,
    summary: 'Followers or following of a member (default: me), newest first, keyset cursor',
    request: { query: FollowListQueryDto },
    responses: { 200: json(MemberPageDto, 'Members'), ...errorResponses },
  }),
  removeFollower: createRoute({
    method: 'delete',
    path: '/ustaad/followers/{memberId}',
    tags,
    security: sec,
    summary: 'Remove a follower',
    request: { params: MemberIdParamDto },
    responses: { 200: json(z.object({ removed: z.boolean() }), 'Removed'), ...errorResponses },
  }),
  relationship: createRoute({
    method: 'get',
    path: '/ustaad/members/{memberId}/relationship',
    tags,
    security: sec,
    summary: 'Follow, connection, mute and thread state with a member (404 when blocked either way)',
    request: { params: MemberIdParamDto },
    responses: { 200: json(RelationshipDto, 'Relationship'), ...errorResponses },
  }),
  connect: createRoute({
    method: 'post',
    path: '/ustaad/connections',
    tags,
    security: sec,
    summary: 'Ask to connect (crossed requests become a connection)',
    request: { body: body(ConnectRequestDto) },
    responses: { 201: json(ConnectionMoved, 'Requested'), ...conflict, ...errorResponses },
  }),
  connectionMove: createRoute({
    method: 'post',
    path: '/ustaad/connections/{id}/{action}',
    tags,
    security: sec,
    summary: 'accept | decline (ignore) by the receiver, withdraw by the requester, remove once connected',
    request: { params: ConnectionActionParamDto },
    responses: { 200: json(ConnectionMoved, 'Moved'), ...conflict, ...errorResponses },
  }),
  connections: createRoute({
    method: 'get',
    path: '/ustaad/connections',
    tags,
    security: sec,
    summary: 'My connections, requests to me, or my requests',
    request: { query: ConnectionListQueryDto },
    responses: { 200: json(ConnectionPageDto, 'Connections'), ...errorResponses },
  }),
  block: createRoute({
    method: 'put',
    path: '/ustaad/blocks/{memberId}',
    tags,
    security: sec,
    summary: 'Block (removes follows and the connection both ways; mutual 404 everywhere)',
    request: { params: MemberIdParamDto },
    responses: { 200: json(z.object({ blocked: z.literal(true) }), 'Blocked'), ...errorResponses },
  }),
  unblock: createRoute({
    method: 'delete',
    path: '/ustaad/blocks/{memberId}',
    tags,
    security: sec,
    summary: 'Unblock (nothing comes back except the conversation, in its earlier state)',
    request: { params: MemberIdParamDto },
    responses: { 200: json(z.object({ blocked: z.literal(false) }), 'Unblocked'), ...errorResponses },
  }),
  blocks: createRoute({
    method: 'get',
    path: '/ustaad/blocks',
    tags,
    security: sec,
    summary: 'Members I blocked and muted',
    responses: { 200: json(BlockListDto, 'Lists'), ...errorResponses },
  }),
  mute: createRoute({
    method: 'put',
    path: '/ustaad/mutes/{memberId}',
    tags,
    security: sec,
    summary: 'Mute (their posts leave my feed; they are not told)',
    request: { params: MemberIdParamDto },
    responses: { 200: json(z.object({ muted: z.boolean() }), 'Muted'), ...errorResponses },
  }),
  unmute: createRoute({
    method: 'delete',
    path: '/ustaad/mutes/{memberId}',
    tags,
    security: sec,
    summary: 'Unmute',
    request: { params: MemberIdParamDto },
    responses: { 200: json(z.object({ muted: z.boolean() }), 'Unmuted'), ...errorResponses },
  }),
  profile: createRoute({
    method: 'get',
    path: '/ustaad/profiles/{handle}',
    tags,
    security: sec,
    summary: "A member's profile by handle: card, specialities, counts, my relationship (404 when hidden)",
    request: { params: HandleParamDto },
    responses: { 200: json(ProfileViewDto, 'Profile'), ...errorResponses },
  }),
  memberPosts: createRoute({
    method: 'get',
    path: '/ustaad/members/{memberId}/posts',
    tags,
    security: sec,
    summary: "A member's posts, newest first (feed visibility rule; 404 when the member is hidden)",
    request: { params: MemberIdParamDto, query: PageQueryDto },
    responses: { 200: json(FeedPageDto, 'Posts'), ...errorResponses },
  }),
};

const PREFIXES = [
  '/ustaad/profiles',
  '/ustaad/follows',
  '/ustaad/followers',
  '/ustaad/members',
  '/ustaad/connections',
  '/ustaad/blocks',
  '/ustaad/mutes',
] as const;

export function ustaadSocialRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const limit = (rule: (typeof USTAAD_RATE_RULES)[keyof typeof USTAAD_RATE_RULES]) =>
    rateLimit(deps.rateLimiter, rule, userKey);
  app.use('/ustaad/*', onUstaadPaths(PREFIXES, requireUstaadMember(deps)));
  app.on(
    'GET',
    ['/ustaad/follows', '/ustaad/members/*', '/ustaad/profiles/*', '/ustaad/connections', '/ustaad/blocks'],
    limit(USTAAD_RATE_RULES.memberReads),
  );
  app.on('PUT', '/ustaad/follows/*', limit(USTAAD_RATE_RULES.follows));
  app.on('DELETE', ['/ustaad/follows/*', '/ustaad/followers/*'], limit(USTAAD_RATE_RULES.membershipWrites));
  app.on('POST', '/ustaad/connections', limit(USTAAD_RATE_RULES.connects));
  app.on('POST', '/ustaad/connections/*', limit(USTAAD_RATE_RULES.membershipWrites));
  app.on(
    ['PUT', 'DELETE'],
    ['/ustaad/blocks/*', '/ustaad/mutes/*'],
    limit(USTAAD_RATE_RULES.membershipWrites),
  );

  return app
    .openapi(r.follow, async (c) =>
      c.json(await followUstaadMember(deps.db, ustaadActor(c), c.req.valid('param').memberId), 200),
    )
    .openapi(r.unfollow, async (c) =>
      c.json(await unfollowUstaadMember(deps.db, ustaadActor(c), c.req.valid('param').memberId), 200),
    )
    .openapi(r.follows, async (c) =>
      c.json(await listUstaadFollows(deps.db, ustaadActor(c), c.req.valid('query')), 200),
    )
    .openapi(r.removeFollower, async (c) =>
      c.json(await removeUstaadFollower(deps.db, ustaadActor(c), c.req.valid('param').memberId), 200),
    )
    .openapi(r.relationship, async (c) =>
      c.json(await ustaadRelationship(deps.db, ustaadActor(c), c.req.valid('param').memberId), 200),
    )
    .openapi(r.connect, async (c) =>
      c.json(await requestUstaadConnection(deps.db, ustaadActor(c), c.req.valid('json').memberId), 201),
    )
    .openapi(r.connectionMove, async (c) => {
      const p = c.req.valid('param');
      return c.json(await moveUstaadConnection(deps.db, ustaadActor(c), p.id, p.action), 200);
    })
    .openapi(r.connections, async (c) =>
      c.json(await listUstaadConnections(deps.db, ustaadActor(c), c.req.valid('query')), 200),
    )
    .openapi(r.block, async (c) =>
      c.json(await blockUstaadMember(deps.db, ustaadActor(c), c.req.valid('param').memberId), 200),
    )
    .openapi(r.unblock, async (c) =>
      c.json(await unblockUstaadMember(deps.db, ustaadActor(c), c.req.valid('param').memberId), 200),
    )
    .openapi(r.blocks, async (c) => c.json(await listUstaadBlocks(deps.db, ustaadActor(c)), 200))
    .openapi(r.mute, async (c) =>
      c.json(await muteUstaadMember(deps.db, ustaadActor(c), c.req.valid('param').memberId, true), 200),
    )
    .openapi(r.unmute, async (c) =>
      c.json(await muteUstaadMember(deps.db, ustaadActor(c), c.req.valid('param').memberId, false), 200),
    )
    .openapi(r.profile, async (c) =>
      c.json(await ustaadProfileByHandle(deps.db, ustaadActor(c), c.req.valid('param').handle), 200),
    )
    .openapi(r.memberPosts, async (c) =>
      c.json(
        await listUstaadMemberPosts(
          deps.db,
          ustaadActor(c),
          c.req.valid('param').memberId,
          c.req.valid('query'),
        ),
        200,
      ),
    );
}
