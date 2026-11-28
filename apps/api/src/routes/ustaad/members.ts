/**
 * Ustaad membership routes (spec 23 § 8 "Membership"; plan task A3). Behind `ustaadGate` (mounted in `index.ts`):
 * `GET /ustaad/me`, `POST /ustaad/join` (verified phone, Turnstile on the first step, 3 a day, SR-3),
 * `POST /ustaad/me/leave`. The phone number is never part of a response (SR-34). Workstream B adds profile, choices,
 * specialities, onboarding and verification status to this file's router family in its own files.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { joinUstaad, leaveUstaad, readUstaadSettingValues, ustaadMemberOfUser } from '@mechdost/db/repo';
import { canAnswerQuestions, JoinDto, MemberViewDto } from '@mechdost/shared/ustaad/dto/members';
import type { SessionCache } from '../../auth/session-cache';
import { ApiError } from '../../errors';
import { log, safeError } from '../../logger';
import { isUstaadStaff, requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const Me = z
  .object({ member: MemberViewDto.nullable(), staffPreview: z.boolean(), canAnswer: z.boolean().optional() })
  .openapi('UstaadMe');

const me = createRoute({
  method: 'get',
  path: '/ustaad/me',
  tags: ['ustaad'],
  summary:
    'My membership (null with staffPreview for staff during the preview; 404 USTAAD_NOT_MEMBER otherwise)',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(Me, 'Membership'), ...errorResponses },
});
const join = createRoute({
  method: 'post',
  path: '/ustaad/join',
  tags: ['ustaad'],
  summary: 'Join the network (or rejoin after leaving): verified phone, Turnstile, one required consent',
  security: [{ bearerAuth: [] }],
  request: { body: body(JoinDto.openapi('UstaadJoin')) },
  responses: { 201: json(MemberViewDto.openapi('UstaadMember'), 'Joined'), ...conflict, ...errorResponses },
});
const leave = createRoute({
  method: 'post',
  path: '/ustaad/me/leave',
  tags: ['ustaad'],
  summary: 'Leave the network (the MechDost account stays; the handle stays reserved)',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(z.object({ ok: z.literal(true) }), 'Left'), ...errorResponses },
});

export function ustaadMemberRoutes(deps: AppDeps, sessions: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.on('GET', '/ustaad/me', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey));
  app.on(
    'POST',
    ['/ustaad/join', '/ustaad/me/leave'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey),
  );
  app.on('POST', '/ustaad/join', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.join, userKey));
  app.on('POST', '/ustaad/me/leave', requireUstaadMember(deps));

  async function human(c: Context<AppEnv>, token: string | undefined) {
    if (!deps.turnstile) throw new ApiError(503, 'UNAVAILABLE', 'Joining is not available right now');
    let ok: boolean;
    try {
      ok = await deps.turnstile.verifyFor({
        token,
        ip: c.get('clientIp'),
        route: 'ustaad.join',
        subject: { kind: 'user', userId: c.get('auth').user.id },
        requestId: c.get('requestId'),
      });
    } catch (err) {
      log('error', 'turnstile_unavailable', safeError(err));
      throw new ApiError(503, 'UNAVAILABLE', 'Please try again in a minute');
    }
    if (!ok) throw new ApiError(400, 'TURNSTILE_FAILED', 'Complete the check and try again');
  }

  return app
    .openapi(me, async (c) => {
      const member = await ustaadMemberOfUser(deps.db, c.get('auth').user.id);
      const active = member && member.status !== 'left' ? member : null;
      if (!active && !isUstaadStaff(c))
        throw new ApiError(404, 'USTAAD_NOT_MEMBER', 'Join the network first');
      const s = await readUstaadSettingValues(deps.db, ['ustaad.qa.apprentice_can_answer']);
      return c.json(
        {
          member: active,
          staffPreview: !active,
          ...(active
            ? { canAnswer: canAnswerQuestions(active.track, s['ustaad.qa.apprentice_can_answer'] === true) }
            : {}),
        },
        200,
      );
    })
    .openapi(join, async (c) => {
      const auth = c.get('auth');
      if (!auth.user.phoneVerifiedAt)
        throw new ApiError(403, 'VERIFICATION_REQUIRED', 'Verify your phone number to continue', {
          phoneVerified: false,
        });
      const b = c.req.valid('json');
      await human(c, b.turnstileToken);
      const member = await joinUstaad(deps.db, { userId: auth.user.id }, b, { via: b.via ?? 'ustaad' });
      // The new grant applies on this instance now; elsewhere the member guard reads the row (never the cache).
      sessions.invalidateUser(auth.user.id);
      return c.json(member, 201);
    })
    .openapi(leave, async (c) => {
      const auth = c.get('auth');
      await leaveUstaad(deps.db, { userId: auth.user.id });
      sessions.invalidateUser(auth.user.id);
      return c.json({ ok: true as const }, 200);
    });
}
