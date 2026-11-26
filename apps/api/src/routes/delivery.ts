import { createHash, randomUUID } from 'node:crypto';
import { createRoute, OpenAPIHono, z, type RouteConfig } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import {
  acceptAgentInvite,
  agentDeliveredCount,
  listAgentPayouts,
  agentEarnings,
  payoutSummary,
  recordAgentPayout,
  reverseAgentPayout,
  acceptDeliveryOffer,
  answerDeliverySwitch,
  cityScopeFrom,
  confirmDeliveryReturn,
  createAgentInvite,
  decideAgentDocument,
  decideDeliveryFailure,
  decideShopModeRequest,
  declineDeliveryOffer,
  deliverDeliveryJob,
  deliveryKpis,
  deliveryMediaForServing,
  editAgentVehicle,
  failDeliveryJob,
  getAdminJob,
  getAgentAdmin,
  getAgentJob,
  getAgentProfile,
  getShopDeliveryMode,
  giveUpDeliveryJob,
  listAdminJobs,
  listAgentApplications,
  listAgentInvites,
  listAgentJobs,
  listAgents,
  listShopModeRequests,
  offerDeliveryJob,
  overrideDeliveryJob,
  pickupDeliveryJob,
  prepareAgentUpload,
  previewAgentInvite,
  rateDeliveryAgent,
  rejectAgentApplication,
  requestDeliverySwitch,
  requestShopDeliveryMode,
  revokeAgentInvite,
  saveAgentMedia,
  setAgentOnline,
  setAgentStatus,
  setShopDeliveryMode,
  shopIdsFrom,
  submitAgentApplication,
  submitAgentDocument,
  viewAgentDocument,
  withdrawDeliveryJob,
  withdrawShopDeliveryModeRequest,
} from '@mechdost/db/repo';
import {
  ADMIN_JOB_VIEWS,
  AGENT_JOB_VIEWS,
  AGENT_PHOTO_PURPOSES,
  AgentDocumentInput,
  AgentEditInput,
  AgentInviteAccept,
  AgentInviteInput,
  AgentOnlineInput,
  AgentPayoutInput,
  AgentPayoutReverseInput,
  AgentStatusInput,
  DeliverInput,
  DeliveryAgentApplySubmit,
  DeliveryRatingInput,
  DeliverySwitchInput,
  DocumentDecisionInput,
  FailInput,
  FailureDecisionInput,
  GiveUpInput,
  JobOfferInput,
  JobOverrideInput,
  JobWithdrawInput,
  OfferDeclineInput,
  PickupInput,
  ReturnReceivedInput,
  ShopModeDecisionInput,
  ShopModeRequestInput,
  ShopModeSetInput,
  SwitchConfirmInput,
  SwitchDeclineInput,
} from '@mechdost/shared/delivery/api';
import { AGENT_DOCUMENT_KINDS, AGENT_STATUSES } from '@mechdost/shared/delivery/codes';
import { CSV_BOM, csvLine, paiseToRupees } from '@mechdost/shared/exports';
import { APPLICATION_REJECT_REASONS } from '@mechdost/shared/partners';
import type { Permission } from '@mechdost/shared/rbac';
import { PHOTO_MAX_BYTES } from '@mechdost/shared/service-photos';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, errorBody } from '../errors';
import { log } from '../logger';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { enforceRate, rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { processPhoto } from '../photos/image';
import { signPhotoUrl, verifyPhotoUrl } from '../photos/url-token';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { human } from './partner-onboarding';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

/**
 * Delivery agents over HTTP (spec 24; route table in the design doc). Agent routes are scoped to the signed-in agent
 * (`deliveries:*`, 404 for anyone else's job); staff routes by the city scope of the permission each action needs;
 * shop routes by the shop grants; the public apply form has Turnstile and per-IP / per-phone limits.
 */
export const AGENT_APPLY_PER_IP: RateRule = { name: 'agent_apply_ip', limit: 5, windowSeconds: 3600 };
export const AGENT_APPLY_PER_PHONE: RateRule = {
  name: 'agent_apply_phone',
  limit: 3,
  windowSeconds: 86_400,
  failClosed: true,
};
const AGENT_INVITE_PER_IP: RateRule = { name: 'agent_invite_ip', limit: 30, windowSeconds: 3600 };
/** Pickup, delivery and return codes: same budget as the shop's delivery code (20 per 10 minutes per user). */
export const AGENT_CODE_RATE: RateRule = { name: 'delivery_code_user', limit: 20, windowSeconds: 600 };
export const AGENT_PHOTO_RATE: RateRule = { name: 'agent_photo_user', limit: 30, windowSeconds: 600 };
export const RATING_RATE: RateRule = { name: 'delivery_rating_user', limit: 10, windowSeconds: 3600 };
const MEDIA_READ_RATE: RateRule = { name: 'delivery_media_ip', limit: 600, windowSeconds: 60 };
const UPLOAD_BODY_MAX = PHOTO_MAX_BYTES + 64 * 1024;

const Anything = z.any();
const responses = { 200: json(Anything, 'OK'), ...conflict, ...errorResponses };
const sec = [{ bearerAuth: [] }];
const Uuid = (name: string) => z.uuid().openapi({ param: { name, in: 'path' } });
const OrderCode = z
  .string()
  .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-Z]{6}-\d{1,2}$/)
  .openapi({ param: { name: 'code', in: 'path' } });
const Before = z.iso.datetime().optional();
const Limit = z.coerce.number().int().min(1).max(100).optional();
const phoneKey = (phone: string) => createHash('sha256').update(`agent_apply:${phone}`).digest('hex');

/** Agents may have no email: a verified phone is enough for agent routes (spec 24, decision 2026-11-01 sign-in). */
const requirePhoneVerified = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('auth').user.phoneVerifiedAt)
    throw new ApiError(403, 'VERIFICATION_REQUIRED', 'Verify your phone number to continue', {
      phoneVerified: false,
    });
  await next();
});

type Req = NonNullable<RouteConfig['request']>;
function r<
  const M extends 'get' | 'post' | 'put' | 'patch',
  const P extends string,
  const R extends Req = Record<string, never>,
>(method: M, path: P, summary: string, tag: string, request?: R) {
  return createRoute({
    method,
    path,
    summary,
    tags: [tag],
    security: sec,
    request: (request ?? {}) as R,
    responses,
  });
}

// ── public ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function deliveryPublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/delivery-agent-applications',
    rateLimit(deps.rateLimiter, AGENT_APPLY_PER_IP, (c) => c.get('clientIp')),
  );
  app.use(
    '/delivery-invites/*',
    rateLimit(deps.rateLimiter, AGENT_INVITE_PER_IP, (c) => c.get('clientIp')),
  );
  return app
    .openapi(
      createRoute({
        method: 'post',
        path: '/delivery-agent-applications',
        tags: ['delivery'],
        summary: 'Apply as a delivery agent (public; Turnstile)',
        request: { body: body(DeliveryAgentApplySubmit) },
        responses: { 201: json(Anything, 'Received'), ...errorResponses },
      }),
      async (c) => {
        const b = c.req.valid('json');
        await human(deps, c, b.turnstileToken);
        await enforceRate(c, deps.rateLimiter, AGENT_APPLY_PER_PHONE, phoneKey(b.application.phone), 1);
        return c.json(await submitAgentApplication(deps.db, b.application), 201);
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/delivery-invites/{token}',
        tags: ['delivery'],
        summary: 'What an agent invite is for (phone masked)',
        request: {
          params: z.object({
            token: z
              .string()
              .regex(/^[A-Za-z0-9_-]{43}$/)
              .openapi({ param: { name: 'token', in: 'path' } }),
          }),
        },
        responses,
      }),
      async (c) => c.json(await previewAgentInvite(deps.db, c.req.valid('param').token), 200),
    );
}

// ── the agent ────────────────────────────────────────────────────────────────────────────────────────────────────

export function deliveryAgentRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/agent/*', '/me/delivery-invites/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requirePhoneVerified);
  }
  app.on('GET', '/agent/*', requirePermission('deliveries:read'));
  app.on(
    'POST',
    ['/agent/me/online', '/agent/offers/*', '/agent/jobs/:jobId/give-up'],
    requirePermission('deliveries:respond'),
  );
  app.on(
    ['POST', 'PUT'],
    [
      '/agent/me/documents',
      '/agent/photos',
      '/agent/jobs/:jobId/pickup',
      '/agent/jobs/:jobId/deliver',
      '/agent/jobs/:jobId/fail',
    ],
    requirePermission('deliveries:fulfil'),
  );
  app.on(
    'POST',
    ['/agent/jobs/:jobId/pickup', '/agent/jobs/:jobId/deliver'],
    rateLimit(deps.rateLimiter, AGENT_CODE_RATE, (c) => c.get('auth').user.id),
  );
  const me = (c: Context<AppEnv>) => c.get('auth').user.id;
  const keyring = () => {
    if (!deps.keyring) throw new ApiError(503, 'UNAVAILABLE', 'Not available right now');
    return deps.keyring;
  };
  const codeStep = <T extends { ok: boolean; locked: boolean; attemptsLeft: number }>(out: T) => {
    if (out.ok) return out;
    if (out.locked) throw new ApiError(423, 'CODE_LOCKED', 'Too many wrong tries; call MechDost support');
    throw new ApiError(422, 'WRONG_CODE', 'That code is not right', { attemptsLeft: out.attemptsLeft });
  };

  // Photo upload (multipart `file` + `purpose` [+ `jobId`]): re-encoded to WebP, stored privately; not an OpenAPI route.
  app.post(
    '/agent/photos',
    rateLimit(deps.rateLimiter, AGENT_PHOTO_RATE, (c) => c.get('auth').user.id),
    bodyLimit({
      maxSize: UPLOAD_BODY_MAX,
      onError: (c) => c.json(errorBody(c, 'PHOTO_TOO_LARGE', 'The photo is bigger than 8 MB'), 413),
    }),
    async (c) => {
      if (!deps.photoStorage)
        throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
      const storage = deps.photoStorage;
      if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data'))
        throw new ApiError(422, 'PHOTO_TYPE', 'Send the photo as a form upload');
      const form = await c.req.parseBody();
      const purpose = z.enum(AGENT_PHOTO_PURPOSES).safeParse(form.purpose);
      const jobId = form.jobId === undefined ? undefined : z.uuid().safeParse(form.jobId);
      const file = form.file;
      if (!purpose.success || !(file instanceof File) || (jobId !== undefined && !jobId.success))
        throw new ApiError(422, 'PHOTO_TYPE', 'Send a purpose and a photo');
      if (file.size > PHOTO_MAX_BYTES)
        throw new ApiError(413, 'PHOTO_TOO_LARGE', 'The photo is bigger than 8 MB');
      const owner = await prepareAgentUpload(deps.db, {
        userId: me(c),
        purpose: purpose.data,
        jobId: jobId?.data,
      });
      const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
      const mediaId = randomUUID();
      const path = `delivery/${owner.ownerId}/${mediaId}.webp`;
      const thumbPath = `delivery/${owner.ownerId}/${mediaId}-thumb.webp`;
      const cleanup = async () => {
        await Promise.allSettled([storage.remove(path), storage.remove(thumbPath)]);
      };
      try {
        await storage.put(path, processed.large);
        await storage.put(thumbPath, processed.thumb);
      } catch (err) {
        log('error', 'photo_storage_failed', {
          op: 'put',
          message: err instanceof Error ? err.message : 'unknown',
        });
        await cleanup();
        throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
      }
      try {
        const saved = await saveAgentMedia(deps.db, {
          userId: me(c),
          ...owner,
          image: {
            mediaId,
            bucket: storage.bucket,
            path,
            thumbPath,
            width: processed.width,
            height: processed.height,
            bytes: processed.large.length,
            thumbBytes: processed.thumb.length,
            sha256: createHash('sha256').update(processed.large).digest('hex'),
          },
        });
        return c.json(saved, 201);
      } catch (err) {
        await cleanup();
        throw err;
      }
    },
  );

  const JobId = z.object({ jobId: Uuid('jobId') });
  const OfferId = z.object({ offerId: Uuid('offerId') });
  return app
    .openapi(
      r(
        'post',
        '/me/delivery-invites/accept',
        'Join as a delivery agent with your invite (phone must match)',
        'delivery',
        { body: body(AgentInviteAccept) },
      ),
      async (c) =>
        c.json(await acceptAgentInvite(deps.db, { userId: me(c), token: c.req.valid('json').token }), 200),
    )
    .openapi(r('get', '/agent/me', 'Your agent profile, documents and rating', 'delivery-agent'), async (c) =>
      c.json(await getAgentProfile(deps.db, me(c)), 200),
    )
    .openapi(
      r(
        'get',
        '/agent/me/earnings',
        'Your payouts recorded by MechDost and your delivered jobs',
        'delivery-agent',
      ),
      async (c) => {
        const e = await agentEarnings(deps.db, me(c));
        return c.json(
          { ...e, payouts: e.payouts.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })) },
          200,
        );
      },
    )
    .openapi(
      r('post', '/agent/me/online', 'Go online or offline', 'delivery-agent', {
        body: body(AgentOnlineInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        await setAgentOnline(deps.db, { userId: me(c), online: b.online, expectedVersion: b.version });
        return c.json(await getAgentProfile(deps.db, me(c)), 200);
      },
    )
    .openapi(
      r('put', '/agent/me/documents', 'Upload or replace one document (PAN, licence, RC)', 'delivery-agent', {
        body: body(AgentDocumentInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        await submitAgentDocument(deps.db, {
          userId: me(c),
          keyring: keyring(),
          kind: b.kind,
          number: b.number,
          mediaId: b.mediaId,
        });
        return c.json(await getAgentProfile(deps.db, me(c)), 200);
      },
    )
    .openapi(
      r('get', '/agent/jobs', 'Your offers, active jobs or finished jobs', 'delivery-agent', {
        query: z.object({ view: z.enum(AGENT_JOB_VIEWS), limit: Limit, before: Before, cursor: Before }),
      }),
      async (c) => {
        const q = c.req.valid('query');
        const page = await listAgentJobs(deps.db, {
          userId: me(c),
          view: q.view,
          limit: q.limit ?? 30,
          before: q.before ? new Date(q.before) : null,
        });
        const last = page.items.at(-1);
        return c.json(
          { items: page.items, nextCursor: page.more && last ? last.updatedAt.toISOString() : null },
          200,
        );
      },
    )
    .openapi(
      r(
        'get',
        '/agent/jobs/{jobId}',
        'One job, with contacts by stage (404 if not yours)',
        'delivery-agent',
        { params: JobId },
      ),
      async (c) =>
        c.json(
          await getAgentJob(deps.db, {
            userId: me(c),
            jobId: c.req.valid('param').jobId,
            keyring: deps.keyring ?? null,
          }),
          200,
        ),
    )
    .openapi(
      r('post', '/agent/offers/{offerId}/accept', 'Accept an offer', 'delivery-agent', { params: OfferId }),
      async (c) => {
        const { jobId } = await acceptDeliveryOffer(deps.db, {
          userId: me(c),
          offerId: c.req.valid('param').offerId,
        });
        return c.json(
          await getAgentJob(deps.db, { userId: me(c), jobId, keyring: deps.keyring ?? null }),
          200,
        );
      },
    )
    .openapi(
      r('post', '/agent/offers/{offerId}/decline', 'Decline an offer with a reason', 'delivery-agent', {
        params: OfferId,
        body: body(OfferDeclineInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        await declineDeliveryOffer(deps.db, {
          userId: me(c),
          offerId: c.req.valid('param').offerId,
          reasonCode: b.reasonCode,
          note: b.note,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r('post', '/agent/jobs/{jobId}/give-up', 'Give up an accepted job before pickup', 'delivery-agent', {
        params: JobId,
        body: body(GiveUpInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        await giveUpDeliveryJob(deps.db, {
          userId: me(c),
          jobId: c.req.valid('param').jobId,
          reasonCode: b.reasonCode,
          note: b.note,
          expectedVersion: b.version,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r('post', '/agent/jobs/{jobId}/pickup', "Pick up with the shop's code and a photo", 'delivery-agent', {
        params: JobId,
        body: body(PickupInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        const out = await pickupDeliveryJob(deps.db, {
          userId: me(c),
          jobId: c.req.valid('param').jobId,
          pickupCode: b.pickupCode,
          photoMediaId: b.photoMediaId,
          expectedVersion: b.version,
          keyring: deps.keyring ?? null,
        });
        return c.json(codeStep(out), 200);
      },
    )
    .openapi(
      r(
        'post',
        '/agent/jobs/{jobId}/deliver',
        "Deliver with the customer's code and a photo",
        'delivery-agent',
        { params: JobId, body: body(DeliverInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        const out = await deliverDeliveryJob(deps.db, {
          userId: me(c),
          jobId: c.req.valid('param').jobId,
          deliveryCode: b.deliveryCode,
          photoMediaId: b.photoMediaId,
          expectedVersion: b.version,
          keyring: deps.keyring ?? null,
        });
        return c.json(codeStep(out), 200);
      },
    )
    .openapi(
      r('post', '/agent/jobs/{jobId}/fail', 'Could not deliver: reason and photo', 'delivery-agent', {
        params: JobId,
        body: body(FailInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await failDeliveryJob(deps.db, {
            userId: me(c),
            jobId: c.req.valid('param').jobId,
            reasonCode: b.reasonCode,
            note: b.note,
            photoMediaId: b.photoMediaId,
            expectedVersion: b.version,
          }),
          200,
        );
      },
    );
}

// ── the shop ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function deliveryShopRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of [
    // '/shop/orders/*' already has sign-in, the per-user limit, verification and orders:fulfil on POST
    // (shop-orders.ts); registering them again would run them twice (L54).
    '/shop/delivery-mode/*',
  ]) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
  }
  app.on('POST', '/shop/delivery-mode/*', requirePermission('orders:fulfil'));
  app.on('GET', '/shop/delivery-mode/*', requirePermission('orders:read'));
  app.on(
    'POST',
    '/shop/orders/:code/return-received',
    rateLimit(deps.rateLimiter, AGENT_CODE_RATE, (c) => c.get('auth').user.id),
  );
  const shops = (c: Context<AppEnv>, p: Permission) => shopIdsFrom(c.get('auth').grants, p);
  const me = (c: Context<AppEnv>) => c.get('auth').user.id;
  const Code = z.object({ code: OrderCode });
  const Switch = z.object({ code: OrderCode, switchId: Uuid('switchId') });
  const ShopId = z.object({ shopId: Uuid('shopId') });
  return app
    .openapi(
      r(
        'post',
        '/shop/orders/{code}/return-received',
        "The parcel is back: type the agent's return code",
        'shop',
        { params: Code, body: body(ReturnReceivedInput) },
      ),
      async (c) => {
        const out = await confirmDeliveryReturn(deps.db, {
          shopIds: shops(c, 'orders:fulfil'),
          staffUserId: me(c),
          orderCode: c.req.valid('param').code,
          returnCode: c.req.valid('json').returnCode,
          keyring: deps.keyring ?? null,
        });
        if (out.ok) return c.json(out, 200);
        if (out.locked) throw new ApiError(423, 'CODE_LOCKED', 'Too many wrong tries; call MechDost support');
        throw new ApiError(422, 'WRONG_CODE', 'That code is not right', { attemptsLeft: out.attemptsLeft });
      },
    )
    .openapi(
      r(
        'post',
        '/shop/orders/{code}/delivery-switch/{switchId}/confirm',
        'We will deliver this order ourselves',
        'shop',
        { params: Switch, body: body(SwitchConfirmInput) },
      ),
      async (c) => {
        const p = c.req.valid('param');
        await answerDeliverySwitch(deps.db, {
          shopIds: shops(c, 'orders:fulfil'),
          staffUserId: me(c),
          orderCode: p.code,
          switchId: p.switchId,
          decision: 'confirmed',
          expectedVersion: c.req.valid('json').version,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r(
        'post',
        '/shop/orders/{code}/delivery-switch/{switchId}/decline',
        'We cannot deliver it (back to MechDost)',
        'shop',
        { params: Switch, body: body(SwitchDeclineInput) },
      ),
      async (c) => {
        const p = c.req.valid('param');
        const b = c.req.valid('json');
        await answerDeliverySwitch(deps.db, {
          shopIds: shops(c, 'orders:fulfil'),
          staffUserId: me(c),
          orderCode: p.code,
          switchId: p.switchId,
          decision: 'declined',
          reasonCode: b.reasonCode,
          note: b.note,
          expectedVersion: b.version,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r('get', '/shop/delivery-mode/{shopId}', 'Who delivers this shop’s orders, and its requests', 'shop', {
        params: ShopId,
      }),
      async (c) =>
        c.json(
          await getShopDeliveryMode(deps.db, {
            shopIds: shops(c, 'orders:read'),
            shopId: c.req.valid('param').shopId,
          }),
          200,
        ),
    )
    .openapi(
      r(
        'post',
        '/shop/delivery-mode/{shopId}/requests',
        'Ask to deliver yourselves (or go back to agents)',
        'shop',
        { params: ShopId, body: body(ShopModeRequestInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await requestShopDeliveryMode(deps.db, {
            shopIds: shops(c, 'orders:fulfil'),
            shopId: c.req.valid('param').shopId,
            staffUserId: me(c),
            requestedMode: b.requestedMode,
            reasonCode: b.reasonCode,
            note: b.note,
          }),
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/shop/delivery-mode/{shopId}/requests/{requestId}/withdraw',
        'Withdraw a waiting request',
        'shop',
        { params: z.object({ shopId: Uuid('shopId'), requestId: Uuid('requestId') }) },
      ),
      async (c) => {
        await withdrawShopDeliveryModeRequest(deps.db, {
          shopIds: shops(c, 'orders:fulfil'),
          requestId: c.req.valid('param').requestId,
          staffUserId: me(c),
        });
        return c.json({ ok: true }, 200);
      },
    );
}

// ── the customer ─────────────────────────────────────────────────────────────────────────────────────────────────

export function deliveryCustomerRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/me/orders/:code/delivery-rating', authenticate(deps, cache));
  app.use(
    '/me/orders/:code/delivery-rating',
    rateLimit(deps.rateLimiter, RATING_RATE, (c) => c.get('auth').user.id),
  );
  return app.openapi(
    r(
      'put',
      '/me/orders/{code}/delivery-rating',
      'Rate the delivery agent of your delivered order',
      'orders',
      { params: z.object({ code: OrderCode }), body: body(DeliveryRatingInput) },
    ),
    async (c) => {
      const b = c.req.valid('json');
      const out = await rateDeliveryAgent(deps.db, {
        userId: c.get('auth').user.id,
        orderCode: c.req.valid('param').code,
        stars: b.stars,
        reasons: b.reasons,
        note: b.note,
        expectedVersion: b.version,
      });
      return c.json({ ...out, editableUntil: out.editableUntil.toISOString() }, 200);
    },
  );
}

// ── staff ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function deliveryAdminRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of [
    // '/admin/orders/*' (admin-orders.ts) and '/admin/shops/*' (admin-shops.ts) already sign in, limit and verify.
    '/admin/delivery/*',
  ]) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
  }
  const manage: Permission = 'delivery_agents:manage';
  const assign: Permission = 'delivery_jobs:assign';
  app.use('/admin/delivery/agents/*', requirePermission(manage));
  app.use('/admin/delivery/agents', requirePermission(manage));
  app.use('/admin/delivery/invites/*', requirePermission(manage));
  app.use('/admin/delivery/invites', requirePermission(manage));
  app.use('/admin/delivery/applications/*', requirePermission(manage));
  app.use('/admin/delivery/applications', requirePermission(manage));
  app.use('/admin/delivery/shop-mode-requests/*', requirePermission(manage));
  app.use('/admin/delivery/shop-mode-requests', requirePermission(manage));
  app.use('/admin/shops/:shopId/delivery-mode', requirePermission(manage));
  app.use('/admin/delivery/jobs/*', requirePermission(assign));
  app.use('/admin/delivery/jobs', requirePermission(assign));
  app.use('/admin/delivery/kpis', requirePermission(assign));
  const payouts: Permission = 'delivery_payouts:manage';
  app.use('/admin/delivery/payouts', requirePermission(payouts));
  app.use('/admin/delivery/payouts/*', requirePermission(payouts));
  // The CSV download counts against the export budget (spec 13); not an OpenAPI route (text/csv body).
  app.get(
    '/admin/delivery/payouts.csv',
    // Sign-in, the per-user limit and verification come from '/admin/delivery/*' above.
    rateLimit(deps.rateLimiter, RATE_RULES.adminExport, (c) => c.get('auth').user.id),
    requirePermission(payouts),
    async (c) => {
      const q = z
        .object({ agentId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() })
        .strict()
        .safeParse(c.req.query());
      if (!q.success) throw new ApiError(422, 'VALIDATION', 'Check the filters');
      const page = await listAgentPayouts(deps.db, {
        scope: scope(c, payouts),
        agentId: q.data.agentId,
        from: q.data.from,
        to: q.data.to,
        limit: 5_000,
      });
      const lines = [
        csvLine([
          'id',
          'agent',
          'kind',
          'amount_rupees',
          'period_from',
          'period_to',
          'method',
          'reference',
          'reverses',
          'recorded_by',
          'created_at',
        ]),
      ];
      for (const p of page.items)
        lines.push(
          csvLine([
            p.id,
            p.agentName,
            p.kind,
            paiseToRupees(p.amountPaise),
            p.periodFrom,
            p.periodTo,
            p.method,
            p.reference,
            p.reversesId,
            p.recordedByName,
            p.createdAt.toISOString(),
          ]),
        );
      return c.body(CSV_BOM + lines.join('\r\n'), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="agent-payouts.csv"',
        'Cache-Control': 'no-store',
      });
    },
  );
  app.use('/admin/orders/:code/delivery-switch', requirePermission(assign));
  const scope = (c: Context<AppEnv>, p: Permission) => cityScopeFrom(c.get('auth').grants, p);
  const me = (c: Context<AppEnv>) => c.get('auth').user.id;
  const keyring = () => {
    if (!deps.keyring) throw new ApiError(503, 'UNAVAILABLE', 'Not available right now');
    return deps.keyring;
  };
  const photoUrl = (mediaId: string) => {
    const { exp, sig } = signPhotoUrl(keyring(), mediaId);
    return `/delivery-photos/${mediaId}/large?e=${String(exp)}&s=${sig}`;
  };
  const AgentId = z.object({ agentId: Uuid('agentId') });
  const JobId = z.object({ jobId: Uuid('jobId') });
  const Kind = z.enum(AGENT_DOCUMENT_KINDS).openapi({ param: { name: 'kind', in: 'path' } });

  // The image route for staff-only photo URLs (signed, 10 minutes, one photo).
  app.get(
    '/delivery-photos/:mediaId/:variant',
    rateLimit(deps.rateLimiter, MEDIA_READ_RATE, (c) => c.get('clientIp')),
    async (c) => {
      if (!deps.photoStorage || !deps.keyring) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const mediaId = z.uuid().safeParse(c.req.param('mediaId'));
      const variant = z.enum(['thumb', 'large']).safeParse(c.req.param('variant'));
      const exp = Number(c.req.query('e'));
      const sig = c.req.query('s');
      if (
        !mediaId.success ||
        !variant.success ||
        sig === undefined ||
        !verifyPhotoUrl(deps.keyring, mediaId.data, exp, sig)
      )
        throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const media = await deliveryMediaForServing(deps.db, mediaId.data);
      if (!media) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const bytes = await deps.photoStorage.get(variant.data === 'thumb' ? media.thumbPath : media.path);
      if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline; filename="photo.webp"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });
    },
  );

  return app
    .openapi(
      r(
        'get',
        '/admin/delivery/applications',
        'Delivery-agent applications in your cities',
        'admin-delivery',
        {
          query: z.object({
            status: z.enum(['new', 'in_review', 'approved', 'rejected']).default('new'),
            limit: Limit,
            before: Before,
          }),
        },
      ),
      async (c) => {
        const q = c.req.valid('query');
        const page = await listAgentApplications(deps.db, {
          scope: scope(c, manage),
          status: q.status,
          limit: q.limit ?? 30,
          before: q.before ? new Date(q.before) : null,
        });
        const last = page.items.at(-1);
        return c.json(
          { items: page.items, nextCursor: page.more && last ? last.createdAt.toISOString() : null },
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/applications/{code}/reject',
        'Reject an application with a reason',
        'admin-delivery',
        {
          params: z.object({
            code: z
              .string()
              .regex(/^PA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/)
              .openapi({ param: { name: 'code', in: 'path' } }),
          }),
          body: body(
            z
              .object({
                reasonCode: z.enum(APPLICATION_REJECT_REASONS),
                note: z.string().trim().min(1).max(300).optional(),
                version: z.number().int().min(0),
              })
              .strict()
              .openapi('AgentApplicationReject'),
          ),
        },
      ),
      async (c) => {
        const b = c.req.valid('json');
        await rejectAgentApplication(deps.db, {
          scope: scope(c, manage),
          staffUserId: me(c),
          code: c.req.valid('param').code,
          reasonCode: b.reasonCode,
          note: b.note,
          expectedVersion: b.version,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r('get', '/admin/delivery/invites', 'Agent invites in your cities', 'admin-delivery', {
        query: z.object({ limit: Limit }),
      }),
      async (c) => {
        const page = await listAgentInvites(deps.db, {
          scope: scope(c, manage),
          cursor: null,
          limit: c.req.valid('query').limit ?? 50,
        });
        return c.json({ items: page.items, nextCursor: null }, 200);
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/invites',
        'Invite an agent (email + WhatsApp; the link is shown once)',
        'admin-delivery',
        { body: body(AgentInviteInput) },
      ),
      async (c) => {
        const out = await createAgentInvite(deps.db, {
          scope: scope(c, manage),
          staffUserId: me(c),
          keyring: keyring(),
          from: c.req.valid('json'),
        });
        return c.json({ id: out.id, token: out.token, expiresAt: out.expiresAt.toISOString() }, 200);
      },
    )
    .openapi(
      r('post', '/admin/delivery/invites/{inviteId}/revoke', 'Withdraw an open invite', 'admin-delivery', {
        params: z.object({ inviteId: Uuid('inviteId') }),
      }),
      async (c) => {
        await revokeAgentInvite(deps.db, {
          scope: scope(c, manage),
          staffUserId: me(c),
          inviteId: c.req.valid('param').inviteId,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r('get', '/admin/delivery/agents', 'Agents in your cities', 'admin-delivery', {
        query: z.object({ status: z.enum(AGENT_STATUSES).optional(), limit: Limit }),
      }),
      async (c) => {
        const q = c.req.valid('query');
        const page = await listAgents(deps.db, {
          scope: scope(c, manage),
          status: q.status,
          cursor: null,
          limit: q.limit ?? 50,
        });
        return c.json({ items: page.items, nextCursor: null }, 200);
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/agents/{agentId}',
        'One agent: documents, history, ratings, KPIs',
        'admin-delivery',
        { params: AgentId },
      ),
      async (c) =>
        c.json(
          await getAgentAdmin(deps.db, { scope: scope(c, manage), agentId: c.req.valid('param').agentId }),
          200,
        ),
    )
    .openapi(
      r('patch', '/admin/delivery/agents/{agentId}', "Correct the agent's vehicle", 'admin-delivery', {
        params: AgentId,
        body: body(AgentEditInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await editAgentVehicle(deps.db, {
            scope: scope(c, manage),
            staffUserId: me(c),
            agentId: c.req.valid('param').agentId,
            vehicleType: b.vehicleType,
            expectedVersion: b.version,
          }),
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/agents/{agentId}/status',
        'Activate, pause, suspend or offboard (reason)',
        'admin-delivery',
        { params: AgentId, body: body(AgentStatusInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await setAgentStatus(deps.db, {
            scope: scope(c, manage),
            staffUserId: me(c),
            agentId: c.req.valid('param').agentId,
            to: b.status,
            reasonCode: b.reasonCode,
            note: b.note,
            pausedUntil: b.pausedUntil ? new Date(b.pausedUntil) : undefined,
            expectedVersion: b.version,
          }),
          200,
        );
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/agents/{agentId}/documents/{kind}',
        'Open one document (audited)',
        'admin-delivery',
        { params: z.object({ agentId: Uuid('agentId'), kind: Kind }) },
      ),
      async (c) => {
        const p = c.req.valid('param');
        const d = await viewAgentDocument(deps.db, {
          scope: scope(c, manage),
          staffUserId: me(c),
          agentId: p.agentId,
          kind: p.kind,
          keyring: keyring(),
        });
        return c.json(
          { kind: p.kind, number: d.number, status: d.status, photoUrl: photoUrl(d.mediaId) },
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/agents/{agentId}/documents/{kind}/{decision}',
        'Verify or reject one document',
        'admin-delivery',
        {
          params: z.object({
            agentId: Uuid('agentId'),
            kind: Kind,
            decision: z.enum(['verify', 'reject']).openapi({ param: { name: 'decision', in: 'path' } }),
          }),
          body: body(DocumentDecisionInput),
        },
      ),
      async (c) => {
        const p = c.req.valid('param');
        await decideAgentDocument(deps.db, {
          scope: scope(c, manage),
          staffUserId: me(c),
          agentId: p.agentId,
          kind: p.kind,
          decision: p.decision === 'verify' ? 'verified' : 'rejected',
          reasonCode: c.req.valid('json').reasonCode,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r('get', '/admin/delivery/jobs', 'Delivery queue by view', 'admin-delivery', {
        query: z.object({
          view: z.enum(ADMIN_JOB_VIEWS).default('needs_agent'),
          orderCode: z
            .string()
            .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-Z]{6}-\d{1,2}$/)
            .optional(),
          limit: Limit,
          before: Before,
          /** The previous page's `nextCursor` (same as `before`). */
          cursor: Before,
        }),
      }),
      async (c) => {
        const q = c.req.valid('query');
        const page = await listAdminJobs(deps.db, {
          scope: scope(c, assign),
          view: q.view,
          orderCode: q.orderCode,
          limit: q.limit ?? 50,
          before: (q.before ?? q.cursor) ? new Date(q.before ?? q.cursor ?? '') : null,
        });
        const last = page.items.at(-1);
        return c.json(
          { items: page.items, nextCursor: page.more && last ? last.updatedAt.toISOString() : null },
          200,
        );
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/jobs/{jobId}',
        'One job: suggestions, offers, timeline, photos',
        'admin-delivery',
        { params: JobId },
      ),
      async (c) => {
        const d = await getAdminJob(deps.db, { scope: scope(c, assign), jobId: c.req.valid('param').jobId });
        return c.json(
          {
            ...d,
            photos: d.photos.map((p) => ({
              purpose: p.purpose,
              at: p.at.toISOString(),
              url: photoUrl(p.id),
            })),
          },
          200,
        );
      },
    )
    .openapi(
      r('post', '/admin/delivery/jobs/{jobId}/offer', 'Offer the job to an agent', 'admin-delivery', {
        params: JobId,
        body: body(JobOfferInput),
      }),
      async (c) => {
        const b = c.req.valid('json');
        const out = await offerDeliveryJob(deps.db, {
          scope: scope(c, assign),
          staffUserId: me(c),
          jobId: c.req.valid('param').jobId,
          agentId: b.agentId,
          expectedVersion: b.version,
        });
        return c.json({ offerId: out.offerId, expiresAt: out.expiresAt.toISOString() }, 200);
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/jobs/{jobId}/withdraw',
        'Take the job back (before pickup)',
        'admin-delivery',
        { params: JobId, body: body(JobWithdrawInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        await withdrawDeliveryJob(deps.db, {
          scope: scope(c, assign),
          staffUserId: me(c),
          jobId: c.req.valid('param').jobId,
          reasonCode: b.reasonCode,
          expectedVersion: b.version,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/jobs/{jobId}/failure-decision',
        'Retry (same or another agent) or return to the shop',
        'admin-delivery',
        { params: JobId, body: body(FailureDecisionInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await decideDeliveryFailure(deps.db, {
            scope: scope(c, assign),
            staffUserId: me(c),
            jobId: c.req.valid('param').jobId,
            decision: b.decision,
            agent: b.agent,
            expectedVersion: b.version,
            keyring: deps.keyring ?? null,
          }),
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/jobs/{jobId}/override/{kind}',
        'Audited override when a code is locked or lost',
        'admin-delivery',
        {
          params: z.object({
            jobId: Uuid('jobId'),
            kind: z.enum(['pickup', 'delivery', 'return']).openapi({ param: { name: 'kind', in: 'path' } }),
          }),
          body: body(JobOverrideInput),
        },
      ),
      async (c) => {
        const p = c.req.valid('param');
        const b = c.req.valid('json');
        await overrideDeliveryJob(deps.db, {
          scope: scope(c, assign),
          staffUserId: me(c),
          jobId: p.jobId,
          kind: p.kind,
          reason: b.reason,
          expectedVersion: b.version,
          keyring: deps.keyring ?? null,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r(
        'post',
        '/admin/orders/{code}/delivery-switch',
        'Ask the shop to deliver this order itself',
        'admin-delivery',
        { params: z.object({ code: OrderCode }), body: body(DeliverySwitchInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await requestDeliverySwitch(deps.db, {
            scope: scope(c, assign),
            staffUserId: me(c),
            orderCode: c.req.valid('param').code,
            reasonCode: b.reasonCode,
            note: b.note,
          }),
          200,
        );
      },
    )
    .openapi(
      r('get', '/admin/delivery/shop-mode-requests', 'Shop delivery-mode requests', 'admin-delivery', {
        query: z.object({
          status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).default('pending'),
          limit: Limit,
        }),
      }),
      async (c) => {
        const q = c.req.valid('query');
        return c.json(
          {
            items: await listShopModeRequests(deps.db, {
              scope: scope(c, manage),
              status: q.status,
              limit: q.limit ?? 50,
            }),
            nextCursor: null,
          },
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/shop-mode-requests/{requestId}/{decision}',
        'Approve or reject a shop request',
        'admin-delivery',
        {
          params: z.object({
            requestId: Uuid('requestId'),
            decision: z.enum(['approve', 'reject']).openapi({ param: { name: 'decision', in: 'path' } }),
          }),
          body: body(ShopModeDecisionInput),
        },
      ),
      async (c) => {
        const p = c.req.valid('param');
        const b = c.req.valid('json');
        await decideShopModeRequest(deps.db, {
          scope: scope(c, manage),
          staffUserId: me(c),
          requestId: p.requestId,
          decision: p.decision === 'approve' ? 'approved' : 'rejected',
          reasonCode: b.reasonCode,
          note: b.note,
          expectedVersion: b.version,
        });
        return c.json({ ok: true }, 200);
      },
    )
    .openapi(
      r(
        'put',
        '/admin/shops/{shopId}/delivery-mode',
        "Set or revoke a shop's delivery mode",
        'admin-delivery',
        { params: z.object({ shopId: Uuid('shopId') }), body: body(ShopModeSetInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        return c.json(
          await setShopDeliveryMode(deps.db, {
            scope: scope(c, manage),
            staffUserId: me(c),
            shopId: c.req.valid('param').shopId,
            mode: b.mode,
            note: b.note,
            expectedVersion: b.version,
          }),
          200,
        );
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/payouts',
        'Record a payout already made to an agent (manual)',
        'admin-delivery',
        { body: body(AgentPayoutInput) },
      ),
      async (c) => {
        const b = c.req.valid('json');
        const row = await recordAgentPayout(deps.db, {
          scope: scope(c, payouts),
          staffUserId: me(c),
          agentId: b.agentId,
          amountPaise: b.amountPaise,
          periodFrom: b.periodFrom,
          periodTo: b.periodTo,
          method: b.method,
          reference: b.reference,
          note: b.note,
          idempotencyKey: b.idempotencyKey,
        });
        return c.json({ ...row, createdAt: row.createdAt.toISOString() }, 200);
      },
    )
    .openapi(
      r(
        'post',
        '/admin/delivery/payouts/{payoutId}/correct',
        'Correct a payout with a reversing row (one per payment)',
        'admin-delivery',
        {
          params: z.object({ payoutId: Uuid('payoutId') }),
          body: body(AgentPayoutReverseInput),
        },
      ),
      async (c) => {
        const b = c.req.valid('json');
        const row = await reverseAgentPayout(deps.db, {
          scope: scope(c, payouts),
          staffUserId: me(c),
          payoutId: c.req.valid('param').payoutId,
          note: b.note,
          idempotencyKey: b.idempotencyKey,
        });
        return c.json({ ...row, createdAt: row.createdAt.toISOString() }, 200);
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/payouts',
        'Recorded payouts (CSV: /admin/delivery/payouts.csv)',
        'admin-delivery',
        {
          query: z.object({
            agentId: z.uuid().optional(),
            from: z.iso.date().optional(),
            to: z.iso.date().optional(),
            limit: Limit,
            before: Before,
          }),
        },
      ),
      async (c) => {
        const q = c.req.valid('query');
        const page = await listAgentPayouts(deps.db, {
          scope: scope(c, payouts),
          agentId: q.agentId,
          from: q.from,
          to: q.to,
          limit: q.limit ?? 50,
          before: q.before ? new Date(q.before) : null,
        });
        const last = page.items.at(-1);
        return c.json(
          {
            items: page.items.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
            totalPaise: page.totalPaise,
            nextCursor: page.more && last ? last.createdAt.toISOString() : null,
          },
          200,
        );
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/payouts/summary',
        'Delivered jobs and net paid per agent over IST days',
        'admin-delivery',
        {
          query: z.object({ from: z.iso.date(), to: z.iso.date() }),
        },
      ),
      async (c) => {
        const q = c.req.valid('query');
        return c.json(
          await payoutSummary(deps.db, { scope: scope(c, payouts), from: q.from, to: q.to }),
          200,
        );
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/payouts/delivered-count',
        'Delivered jobs and paid total for an agent over IST days',
        'admin-delivery',
        { query: z.object({ agentId: z.uuid(), from: z.iso.date(), to: z.iso.date() }) },
      ),
      async (c) => {
        const q = c.req.valid('query');
        return c.json(
          await agentDeliveredCount(deps.db, {
            scope: scope(c, payouts),
            agentId: q.agentId,
            from: q.from,
            to: q.to,
          }),
          200,
        );
      },
    )
    .openapi(
      r(
        'get',
        '/admin/delivery/kpis',
        'Delivery KPIs for a window (seconds, basis points)',
        'admin-delivery',
        { query: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }) },
      ),
      async (c) => {
        const q = c.req.valid('query');
        return c.json(
          await deliveryKpis(deps.db, {
            scope: scope(c, assign),
            from: new Date(q.from),
            to: new Date(q.to),
          }),
          200,
        );
      },
    );
}
