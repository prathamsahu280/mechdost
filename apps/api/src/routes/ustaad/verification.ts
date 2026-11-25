/**
 * Ustaad identity routes for members (spec 23 § 8 "Membership" onboarding + "Verification"; plan tasks B2, B4). Behind
 * `ustaadGate` (mounted in `index.ts`) and `requireUstaadMember` (non-members 404, the network is invisible). Strict
 * bodies; never a phone number in a response (SR-34). Verification is never a wall: these routes only add proof.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  decideUstaadVouch,
  getUstaadOnboarding,
  giveUstaadVouch,
  requestUstaadAttestation,
  requestUstaadVerification,
  requestUstaadVouch,
  resetUstaadOnboarding,
  saveUstaadOnboarding,
  ustaadTutorial,
  ustaadVerificationStatus,
  withdrawUstaadVerification,
} from '@mechdost/db/repo';
import {
  AttestationRequestDto,
  AttestationViewDto,
  OnboardingEventDto,
  OnboardingViewDto,
  RequestVerificationDto,
  TutorialDto,
  VerificationViewDto,
  VersionDto,
  VouchRequestDto,
  VouchRevokeDto,
  VouchViewDto,
} from '@mechdost/shared/ustaad/dto/verification';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { requirePermission } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const sec = [{ bearerAuth: [] }];
const tags = ['ustaad'];

const r = {
  onboarding: createRoute({
    method: 'get',
    path: '/ustaad/onboarding',
    tags,
    security: sec,
    summary: 'My tutorial progress (last card, skipped, completed, coach-marks seen)',
    responses: { 200: json(OnboardingViewDto, 'Progress'), ...errorResponses },
  }),
  saveOnboarding: createRoute({
    method: 'put',
    path: '/ustaad/onboarding',
    tags,
    security: sec,
    summary: 'Record a card reached, skip, completion or a coach-mark seen',
    request: { body: body(OnboardingEventDto) },
    responses: { 200: json(OnboardingViewDto, 'Progress'), ...errorResponses },
  }),
  resetOnboarding: createRoute({
    method: 'post',
    path: '/ustaad/onboarding/reset',
    tags,
    security: sec,
    summary: '"Help / Kaise use karein": show the cards and coach-marks again',
    responses: { 200: json(OnboardingViewDto, 'Progress'), ...errorResponses },
  }),
  tutorial: createRoute({
    method: 'get',
    path: '/ustaad/tutorial',
    tags,
    security: sec,
    summary: 'Tutorial cards and coach-marks in my language (narration or speechSynthesis fallback)',
    request: { query: z.object({ lang: z.enum(['hi', 'en']).optional() }) },
    responses: { 200: json(TutorialDto, 'Tutorial'), ...errorResponses },
  }),
  status: createRoute({
    method: 'get',
    path: '/ustaad/verification-status',
    tags,
    security: sec,
    summary: 'My latest verification request and its progress (for /partners/status and Get verified)',
    responses: {
      200: json(z.object({ verification: VerificationViewDto.nullable() }), 'Status'),
      ...errorResponses,
    },
  }),
  request: createRoute({
    method: 'post',
    path: '/ustaad/verifications',
    tags,
    security: sec,
    summary: 'Ask for verification (owner confirms and/or Ustaad vouches; staff give the final approval)',
    request: { body: body(RequestVerificationDto) },
    responses: { 201: json(VerificationViewDto, 'Requested'), ...conflict, ...errorResponses },
  }),
  withdraw: createRoute({
    method: 'post',
    path: '/ustaad/verifications/{id}/withdraw',
    tags,
    security: sec,
    summary: 'Withdraw my open request',
    request: { params: z.object({ id: Id }), body: body(VersionDto) },
    responses: { 200: json(VerificationViewDto, 'Withdrawn'), ...conflict, ...errorResponses },
  }),
  attest: createRoute({
    method: 'post',
    path: '/ustaad/attestations',
    tags,
    security: sec,
    summary: 'Ask a MechDost workshop owner to confirm I work there',
    request: { body: body(AttestationRequestDto) },
    responses: { 201: json(AttestationViewDto, 'Asked'), ...conflict, ...errorResponses },
  }),
  vouchAsk: createRoute({
    method: 'post',
    path: '/ustaad/vouches',
    tags,
    security: sec,
    summary: 'Ask an Ustaad to vouch for me',
    request: { body: body(VouchRequestDto) },
    responses: { 201: json(VouchViewDto, 'Asked'), ...conflict, ...errorResponses },
  }),
  vouchGive: createRoute({
    method: 'post',
    path: '/ustaad/vouches/{id}/give',
    tags,
    security: sec,
    summary: 'Give a vouch (Pakka+, account ≥ 60 days, not reciprocal, ≤ 3 a month; SR-7)',
    request: { params: z.object({ id: Id }), body: body(VersionDto) },
    responses: { 200: json(VouchViewDto, 'Given'), ...conflict, ...errorResponses },
  }),
  vouchDecline: createRoute({
    method: 'post',
    path: '/ustaad/vouches/{id}/decline',
    tags,
    security: sec,
    summary: 'Decline a vouch request',
    request: { params: z.object({ id: Id }), body: body(VersionDto) },
    responses: { 200: json(VouchViewDto, 'Declined'), ...conflict, ...errorResponses },
  }),
  vouchRevoke: createRoute({
    method: 'post',
    path: '/ustaad/vouches/{id}/revoke',
    tags,
    security: sec,
    summary: 'Take back a vouch I gave (reason code)',
    request: { params: z.object({ id: Id }), body: body(VouchRevokeDto) },
    responses: { 200: json(VouchViewDto, 'Revoked'), ...conflict, ...errorResponses },
  }),
};

export function ustaadVerificationRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const paths = [
    '/ustaad/onboarding',
    '/ustaad/onboarding/*',
    '/ustaad/tutorial',
    '/ustaad/verification-status',
    '/ustaad/verifications',
    '/ustaad/verifications/*',
    '/ustaad/attestations',
    '/ustaad/vouches',
    '/ustaad/vouches/*',
  ];
  for (const p of paths) app.use(p, requireUstaadMember(deps));
  for (const p of ['/ustaad/onboarding', '/ustaad/tutorial', '/ustaad/verification-status'])
    app.on('GET', p, rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey));
  app.on(['POST', 'PUT'], paths, rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey));
  app.on(
    'POST',
    ['/ustaad/vouches', '/ustaad/vouches/*'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.vouches, userKey),
  );
  app.on('POST', '/ustaad/vouches/*/give', requirePermission('ustaad:vouch'));
  const actor = (c: Context<AppEnv>) => ({ userId: c.get('auth').user.id });

  return app
    .openapi(r.onboarding, async (c) => c.json(await getUstaadOnboarding(deps.db, actor(c)), 200))
    .openapi(r.saveOnboarding, async (c) =>
      c.json(await saveUstaadOnboarding(deps.db, actor(c), c.req.valid('json')), 200),
    )
    .openapi(r.resetOnboarding, async (c) => c.json(await resetUstaadOnboarding(deps.db, actor(c)), 200))
    .openapi(r.tutorial, async (c) => {
      const member = c.get('ustaadMember');
      const lang = c.req.valid('query').lang ?? member?.lang ?? 'hi';
      return c.json(await ustaadTutorial(deps.db, lang), 200);
    })
    .openapi(r.status, async (c) =>
      c.json({ verification: await ustaadVerificationStatus(deps.db, actor(c)) }, 200),
    )
    .openapi(r.request, async (c) =>
      c.json(await requestUstaadVerification(deps.db, actor(c), c.req.valid('json')), 201),
    )
    .openapi(r.withdraw, async (c) =>
      c.json(
        await withdrawUstaadVerification(deps.db, actor(c), {
          id: c.req.valid('param').id,
          expectedVersion: c.req.valid('json').expectedVersion,
        }),
        200,
      ),
    )
    .openapi(r.attest, async (c) =>
      c.json(await requestUstaadAttestation(deps.db, actor(c), c.req.valid('json')), 201),
    )
    .openapi(r.vouchAsk, async (c) =>
      c.json(await requestUstaadVouch(deps.db, actor(c), c.req.valid('json')), 201),
    )
    .openapi(r.vouchGive, async (c) =>
      c.json(
        await giveUstaadVouch(deps.db, actor(c), {
          id: c.req.valid('param').id,
          expectedVersion: c.req.valid('json').expectedVersion,
        }),
        200,
      ),
    )
    .openapi(r.vouchDecline, async (c) =>
      c.json(
        await decideUstaadVouch(deps.db, actor(c), {
          id: c.req.valid('param').id,
          expectedVersion: c.req.valid('json').expectedVersion,
          to: 'declined',
        }),
        200,
      ),
    )
    .openapi(r.vouchRevoke, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await decideUstaadVouch(deps.db, actor(c), {
          id: c.req.valid('param').id,
          expectedVersion: b.expectedVersion,
          to: 'revoked',
          reasonCode: b.reasonCode,
        }),
        200,
      );
    });
}
