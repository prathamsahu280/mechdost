/**
 * Garage owner not on MechDost confirms a member (spec 23 § 4 flow 2, § 8 "Verification", SR-6; plan task B4).
 *
 * - `POST /ustaad/attestations/owner` (member, behind `ustaadGate` + `requireUstaadMember`): the owner's mobile; never
 *   returns a link (the member cannot confirm themselves; staff issue the link, see `admin-ustaad-verification.ts`).
 * - `GET|POST /ustaad-attest/{token}` (public, no sign-in): the owner's page. Outside `/ustaad/*` on purpose, like
 *   `/ustaad-access`: the member gate would 404 a signed-out owner. It answers 404 while `ustaad.access` is `off`,
 *   10 requests per IP per hour (SR-43), Turnstile on the submit (SR-3), one 404 for unknown, used and expired tokens,
 *   `Cache-Control: no-store` and `X-Robots-Tag: noindex`. The GET never consumes the token (link-preview crawlers).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  decideUstaadAttestByToken,
  requestUstaadOwnerAttestation,
  ustaadAttestPage,
} from '@mechdost/db/repo';
import {
  AttestOutcomeDto,
  AttestPageDto,
  AttestSubmitDto,
  OwnerAttestationRequestDto,
  OwnerAttestationViewDto,
} from '@mechdost/shared/ustaad/dto/verification';
import { ApiError, handleNotFound } from '../../errors';
import { log, safeError } from '../../logger';
import { requireUstaadMember, type UstaadAccessCache } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const Token = z
  .string()
  .max(128)
  .openapi({ param: { name: 'token', in: 'path' } });

const r = {
  ownerAsk: createRoute({
    method: 'post',
    path: '/ustaad/attestations/owner',
    tags: ['ustaad'],
    security: [{ bearerAuth: [] }],
    summary: 'Ask a garage owner who is not on MechDost to confirm me (MechDost sends the link, never to me)',
    request: { body: body(OwnerAttestationRequestDto) },
    responses: { 201: json(OwnerAttestationViewDto, 'Asked'), ...conflict, ...errorResponses },
  }),
  page: createRoute({
    method: 'get',
    path: '/ustaad-attest/{token}',
    tags: ['ustaad'],
    summary: 'Public: what the garage owner is asked to confirm (name, area, year; never a phone)',
    request: { params: z.object({ token: Token }) },
    responses: { 200: json(AttestPageDto, 'Request'), ...errorResponses },
  }),
  submit: createRoute({
    method: 'post',
    path: '/ustaad-attest/{token}',
    tags: ['ustaad'],
    summary:
      'Public: the owner confirms (GSTIN/Udyam + position at the shop) or declines; the link works once',
    request: { params: z.object({ token: Token }), body: body(AttestSubmitDto) },
    responses: {
      200: json(AttestOutcomeDto, 'Recorded'),
      ...errorResponses,
    },
  }),
};

export function ustaadAttestRoutes(deps: AppDeps, access: UstaadAccessCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.use('/ustaad/attestations/owner', requireUstaadMember(deps));
  app.use(
    '/ustaad/attestations/owner',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey),
  );
  app.use(
    '/ustaad-attest/*',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.attestPerIp, (c) => c.get('clientIp')),
  );
  app.use('/ustaad-attest/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Referrer-Policy', 'no-referrer');
    if ((await access.get()) === 'off') return handleNotFound(c);
    await next();
  });

  async function human(c: Context<AppEnv>, token: string) {
    if (!deps.turnstile) throw new ApiError(503, 'UNAVAILABLE', 'Please try again later');
    let ok: boolean;
    try {
      ok = await deps.turnstile.verify(token, c.get('clientIp'));
    } catch (err) {
      log('error', 'turnstile_unavailable', safeError(err));
      throw new ApiError(503, 'UNAVAILABLE', 'Please try again in a minute');
    }
    if (!ok) throw new ApiError(400, 'TURNSTILE_FAILED', 'Complete the check and try again');
  }

  return app
    .openapi(r.ownerAsk, async (c) => {
      if (!deps.keyring) throw new ApiError(503, 'UNAVAILABLE', 'Please try again later');
      const out = await requestUstaadOwnerAttestation(
        deps.db,
        deps.keyring,
        { userId: c.get('auth').user.id },
        c.req.valid('json'),
      );
      return c.json({ ...out, status: out.status as 'requested' }, 201);
    })
    .openapi(r.page, async (c) => c.json(await ustaadAttestPage(deps.db, c.req.valid('param').token), 200))
    .openapi(r.submit, async (c) => {
      const b = c.req.valid('json');
      await human(c, b.turnstileToken);
      const out = await decideUstaadAttestByToken(
        deps.db,
        c.req.valid('param').token,
        b.decision === 'declined'
          ? { decision: 'declined' }
          : { decision: 'confirmed', businessId: b.businessId, shop: b.shop },
      );
      return c.json(out, 200);
    });
}
