/**
 * Member reports (spec 23 § 8 "Reports"; plan task F2). Behind `ustaadGate` and `requireUstaadMember` (a non-member
 * gets the generic 404 before validation); 20 reports a day per member (SR-43). Reasons come from the admin table
 * (an inactive reason answers 422 `USTAAD_REASON_OFF`); a repeat on the same item returns the open report.
 */
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createUstaadReport } from '@mechdost/db/repo';
import { CreateReportDto, ReportCreatedDto } from '@mechdost/shared/ustaad/dto/moderation';
import { ApiError } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, json } from '../service-schemas';

const report = createRoute({
  method: 'post',
  path: '/ustaad/reports',
  tags: ['ustaad'],
  summary: 'Report a post, story, comment, question, answer, member, job or message (20 a day)',
  security: [{ bearerAuth: [] }],
  request: { body: body(CreateReportDto.openapi('UstaadCreateReport')) },
  responses: { 201: json(ReportCreatedDto.openapi('UstaadReportCreated'), 'Reported'), ...errorResponses },
});

export function ustaadReportRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/ustaad/reports', requireUstaadMember(deps));
  app.on(
    'POST',
    '/ustaad/reports',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.reports, (c: Context<AppEnv>) => c.get('auth').user.id),
  );
  return app.openapi(report, async (c) => {
    const member = c.get('ustaadMember');
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    const out = await createUstaadReport(
      deps.db,
      { userId: c.get('auth').user.id, memberId: member.id },
      c.req.valid('json'),
    );
    return c.json(out, 201);
  });
}
