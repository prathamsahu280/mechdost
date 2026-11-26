/**
 * Ustaad profile and choices routes (spec 23 § 8 "Membership", flow 14; plan task B3). Behind `ustaadGate` and
 * `requireUstaadMember`. Strict bodies (no mass assignment, SR-5): level, status, city, verification and the official
 * badge are never writable here. Names pass the reserved/confusable check (SR-4, 422 `NAME_RESERVED`). Never a phone
 * number in a response (SR-34).
 */
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  getUstaadChoices,
  saveUstaadChoices,
  setUstaadSpecialities,
  updateUstaadProfile,
} from '@mechdost/db/repo';
import {
  ChoicesDto,
  ChoicesViewDto,
  MemberViewDto,
  PatchMeDto,
  SpecialitiesDto,
} from '@mechdost/shared/ustaad/dto/members';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const sec = [{ bearerAuth: [] }];
const tags = ['ustaad'];

const r = {
  patchMe: createRoute({
    method: 'patch',
    path: '/ustaad/me',
    tags,
    security: sec,
    summary: 'Edit my profile (with the version I read; names checked against reserved and look-alike names)',
    request: { body: body(PatchMeDto) },
    responses: { 200: json(MemberViewDto, 'Profile'), ...conflict, ...errorResponses },
  }),
  specialities: createRoute({
    method: 'put',
    path: '/ustaad/me/specialities',
    tags,
    security: sec,
    summary: 'Set what I fix (earned steps are kept for codes that stay)',
    request: { body: body(SpecialitiesDto) },
    responses: { 200: json(MemberViewDto, 'Profile'), ...errorResponses },
  }),
  choices: createRoute({
    method: 'get',
    path: '/ustaad/me/choices',
    tags,
    security: sec,
    summary: 'My choices: message mode, suggest me, smart correction, data saver and the join consents',
    responses: { 200: json(ChoicesViewDto, 'Choices'), ...errorResponses },
  }),
  saveChoices: createRoute({
    method: 'put',
    path: '/ustaad/me/choices',
    tags,
    security: sec,
    summary: 'Save my choices (optional consents can be withdrawn with one tap)',
    request: { body: body(ChoicesDto) },
    responses: { 200: json(ChoicesViewDto, 'Choices'), ...conflict, ...errorResponses },
  }),
};

export function ustaadProfileRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const paths = ['/ustaad/me/specialities', '/ustaad/me/choices'];
  app.on('PATCH', '/ustaad/me', requireUstaadMember(deps));
  for (const p of paths) app.use(p, requireUstaadMember(deps));
  app.on('GET', '/ustaad/me/choices', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey));
  app.on(
    ['PATCH', 'PUT'],
    ['/ustaad/me', ...paths],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey),
  );
  const actor = (c: Context<AppEnv>) => ({ userId: c.get('auth').user.id });

  return app
    .openapi(r.patchMe, async (c) =>
      c.json(await updateUstaadProfile(deps.db, actor(c), c.req.valid('json')), 200),
    )
    .openapi(r.specialities, async (c) =>
      c.json(await setUstaadSpecialities(deps.db, actor(c), c.req.valid('json')), 200),
    )
    .openapi(r.choices, async (c) => c.json(await getUstaadChoices(deps.db, c.get('auth').user.id), 200))
    .openapi(r.saveChoices, async (c) =>
      c.json(await saveUstaadChoices(deps.db, actor(c), c.req.valid('json')), 200),
    );
}
