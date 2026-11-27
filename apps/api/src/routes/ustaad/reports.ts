/**
 * Member reports (spec 23 § 8 "Reports"; plan task F2). Behind `ustaadGate` and `requireUstaadMember` (a non-member
 * gets the generic 404 before validation); 20 reports a day per member (SR-43). Reasons come from the admin table
 * (an inactive reason answers 422 `USTAAD_REASON_OFF`); a repeat on the same item returns the open report.
 *
 * The member's own standing and appeal (QA 2026-11-27, SIM-P19 / SIM-P24 / SIM-P27): `GET /ustaad/me/standing` and
 * `POST /ustaad/me/appeals` are reachable by a banned member too (`requireUstaadMemberAnyStanding`), so the banned
 * screen can give the reason and the appeal. Each is bound to its own exact path (L-UD3).
 */
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createUstaadReport, fileUstaadAppeal, ustaadMyStanding } from '@mechdost/db/repo';
import {
  AppealFiledDto,
  CreateReportDto,
  FileAppealDto,
  ReportCreatedDto,
  StandingDto,
} from '@mechdost/shared/ustaad/dto/moderation';
import { ApiError } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireUstaadMember, requireUstaadMemberAnyStanding } from '../../middleware/ustaad-member';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const report = createRoute({
  method: 'post',
  path: '/ustaad/reports',
  tags: ['ustaad'],
  summary: 'Report a post, story, comment, question, answer, member, job or message (20 a day)',
  security: [{ bearerAuth: [] }],
  request: { body: body(CreateReportDto.openapi('UstaadCreateReport')) },
  responses: { 201: json(ReportCreatedDto.openapi('UstaadReportCreated'), 'Reported'), ...errorResponses },
});
const standing = createRoute({
  method: 'get',
  path: '/ustaad/me/standing',
  tags: ['ustaad'],
  summary: 'My standing: status, limits with end dates, the decisions on me and my content, appeal state',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(StandingDto, 'Standing'), ...errorResponses },
});
const appeal = createRoute({
  method: 'post',
  path: '/ustaad/me/appeals',
  tags: ['ustaad'],
  summary: 'Appeal a decision on me or my content (a support ticket of kind ustaad_appeal; 409 once filed)',
  security: [{ bearerAuth: [] }],
  request: { body: body(FileAppealDto) },
  responses: { 201: json(AppealFiledDto, 'Appeal filed'), ...conflict, ...errorResponses },
});

export function ustaadReportRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.use('/ustaad/reports', requireUstaadMember(deps));
  app.on('POST', '/ustaad/reports', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.reports, userKey));
  for (const p of ['/ustaad/me/standing', '/ustaad/me/appeals'])
    app.use(p, requireUstaadMemberAnyStanding(deps));
  app.on('GET', '/ustaad/me/standing', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey));
  app.on(
    'POST',
    '/ustaad/me/appeals',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey),
  );
  return app
    .openapi(report, async (c) => {
      const member = c.get('ustaadMember');
      if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const out = await createUstaadReport(
        deps.db,
        { userId: c.get('auth').user.id, memberId: member.id },
        c.req.valid('json'),
      );
      return c.json(out, 201);
    })
    .openapi(standing, async (c) => {
      return c.json(await ustaadMyStanding(deps.db, { userId: c.get('auth').user.id }), 200);
    })
    .openapi(appeal, async (c) => {
      const out = await fileUstaadAppeal(deps.db, { userId: c.get('auth').user.id }, c.req.valid('json'));
      return c.json(out, 201);
    });
}
