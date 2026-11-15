import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  acceptShopStaffInvite,
  cancelShopStaffInvite,
  declineShopStaffInvite,
  listMyShopInvites,
  inviteShopStaff,
  listShopTeam,
  NotFoundError,
  removeShopMember,
  setShopBusy,
  shopIdsFrom,
} from '@mechdost/db/repo';
import {
  MyShopInvites,
  ShopBusyBodySchema,
  ShopBusySaved,
  ShopInviteAccepted,
  ShopInviteSaved,
  ShopTeam,
  ShopTeamOk,
  StaffInviteBodySchema,
} from '@mechdost/shared/shop-team';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * The shop owner's own controls (design 2026-11-15, spec 07/13): the busy / closed-today toggle and the team (invite
 * helpers by phone, cancel an invite, remove a member). Owner only, for the owner's own shops: a shop the caller has
 * no grant for is a 404, a staff member of the shop gets 403 `OWNER_ONLY`. Staff never see these screens' data.
 */
export const TEAM_INVITE_RATE: RateRule = { name: 'shop_team_invite_user', limit: 20, windowSeconds: 3600 };

const ShopId = z.uuid().openapi({ param: { name: 'shopId', in: 'path' } });
const InviteId = z.uuid().openapi({ param: { name: 'inviteId', in: 'path' } });
const MemberId = z.uuid().openapi({ param: { name: 'userId', in: 'path' } });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const notFound = { 404: json(ErrorSchema, 'Not found') };
const conflict = { 409: json(ErrorSchema, 'Refused') };

const busy = createRoute({
  method: 'put',
  path: '/shop/busy/{shopId}',
  tags: ['shop'],
  summary: 'The owner marks the shop closed today (until midnight IST) or busy for N hours, or clears it',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(ShopBusyBodySchema),
  },
  responses: { 200: json(ShopBusySaved, 'Saved'), ...notFound, ...errorResponses },
});

const team = createRoute({
  method: 'get',
  path: '/shop/team/{shopId}',
  tags: ['shop'],
  summary: 'Your team: members (phone masked) and invites still waiting (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId }) },
  responses: { 200: json(ShopTeam, 'Team'), ...notFound, ...errorResponses },
});

const invite = createRoute({
  method: 'post',
  path: '/shop/team/{shopId}/invites',
  tags: ['shop'],
  summary: 'Invite a helper by phone and name; they join as shop staff when they sign in with that phone',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(StaffInviteBodySchema),
  },
  responses: { 200: json(ShopInviteSaved, 'Invited'), ...notFound, ...conflict, ...errorResponses },
});

const cancel = createRoute({
  method: 'delete',
  path: '/shop/team/{shopId}/invites/{inviteId}',
  tags: ['shop'],
  summary: 'Cancel an invite that has not been used',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId, inviteId: InviteId }) },
  responses: { 200: json(ShopTeamOk, 'Cancelled'), ...notFound, ...errorResponses },
});

const myInvites = createRoute({
  method: 'get',
  path: '/me/shop-invites',
  tags: ['shop'],
  summary: 'Shop staff invites waiting for your verified phone (nothing is granted until you accept)',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(MyShopInvites, 'Invites'), ...errorResponses },
});

const acceptInvite = createRoute({
  method: 'post',
  path: '/me/shop-invites/{inviteId}/accept',
  tags: ['shop'],
  summary: 'Accept a shop staff invite addressed to your verified phone (once, before it expires)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ inviteId: InviteId }) },
  responses: { 200: json(ShopInviteAccepted, 'Joined'), ...notFound, ...conflict, ...errorResponses },
});

const declineInvite = createRoute({
  method: 'post',
  path: '/me/shop-invites/{inviteId}/decline',
  tags: ['shop'],
  summary: 'Decline a shop staff invite addressed to your verified phone',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ inviteId: InviteId }) },
  responses: { 200: json(ShopTeamOk, 'Declined'), ...notFound, ...conflict, ...errorResponses },
});

const remove = createRoute({
  method: 'delete',
  path: '/shop/team/{shopId}/members/{userId}',
  tags: ['shop'],
  summary: 'Remove a helper: their access to the shop ends (the owner and yourself cannot be removed)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId, userId: MemberId }) },
  responses: { 200: json(ShopTeamOk, 'Removed'), ...notFound, ...conflict, ...errorResponses },
});

export function shopTeamRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const prefix of ['/shop/busy/*', '/shop/team/*']) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
    app.use(prefix, requirePermission('inventory:write'));
  }
  for (const prefix of ['/me/shop-invites', '/me/shop-invites/*']) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  app.on(
    'POST',
    '/shop/team/:shopId/invites',
    rateLimit(deps.rateLimiter, TEAM_INVITE_RATE, (c) => c.get('auth').user.id),
  );

  /** The shops the caller owns; a shop outside the caller's grants is 404, a staff member of it is 403. */
  function owned(c: Context<AppEnv>, shopId: string): string[] {
    const grants = c.get('auth').grants;
    if (!shopIdsFrom(grants, 'inventory:write').includes(shopId)) throw new NotFoundError('Shop not found');
    const ids = grants.filter((g) => g.role === 'seller_owner' && g.shopId !== null).map((g) => g.shopId);
    if (!ids.includes(shopId)) throw Forbidden('OWNER_ONLY', 'Only the shop owner can do this');
    return ids.filter((id): id is string => id !== null);
  }

  return app
    .openapi(myInvites, async (c) =>
      c.json({ invites: await listMyShopInvites(deps.db, { userId: c.get('auth').user.id }) }, 200),
    )
    .openapi(acceptInvite, async (c) => {
      const me = c.get('auth').user.id;
      const r = await acceptShopStaffInvite(deps.db, { userId: me, inviteId: c.req.valid('param').inviteId });
      // Their grants are loaded again on the next request on this instance (others within the cache period).
      cache.invalidateUser(me);
      return c.json(r, 200);
    })
    .openapi(declineInvite, async (c) => {
      await declineShopStaffInvite(deps.db, {
        userId: c.get('auth').user.id,
        inviteId: c.req.valid('param').inviteId,
      });
      return c.json({ ok: true as const }, 200);
    })
    .openapi(busy, async (c) => {
      const { shopId } = c.req.valid('param');
      const ownedShopIds = owned(c, shopId);
      return c.json(
        await setShopBusy(deps.db, {
          shopId,
          ownedShopIds,
          userId: c.get('auth').user.id,
          body: c.req.valid('json'),
        }),
        200,
      );
    })
    .openapi(team, async (c) => {
      const { shopId } = c.req.valid('param');
      const ownedShopIds = owned(c, shopId);
      return c.json(
        await listShopTeam(deps.db, { shopId, ownedShopIds, userId: c.get('auth').user.id }),
        200,
      );
    })
    .openapi(invite, async (c) => {
      const { shopId } = c.req.valid('param');
      const ownedShopIds = owned(c, shopId);
      const b = c.req.valid('json');
      const r = await inviteShopStaff(deps.db, {
        shopId,
        ownedShopIds,
        userId: c.get('auth').user.id,
        name: b.name,
        phone: b.phone,
      });
      return c.json({ id: r.id, expiresAt: r.expiresAt.toISOString() }, 200);
    })
    .openapi(cancel, async (c) => {
      const { shopId, inviteId } = c.req.valid('param');
      const ownedShopIds = owned(c, shopId);
      await cancelShopStaffInvite(deps.db, { shopId, ownedShopIds, userId: c.get('auth').user.id, inviteId });
      return c.json({ ok: true as const }, 200);
    })
    .openapi(remove, async (c) => {
      const { shopId, userId } = c.req.valid('param');
      const ownedShopIds = owned(c, shopId);
      await removeShopMember(deps.db, {
        shopId,
        ownedShopIds,
        userId: c.get('auth').user.id,
        memberUserId: userId,
      });
      // The removed person's grants are loaded again on their next request on this instance; other instances
      // follow within the session-cache period (60 s, `SessionCache`).
      cache.invalidateUser(userId);
      return c.json({ ok: true as const }, 200);
    });
}
