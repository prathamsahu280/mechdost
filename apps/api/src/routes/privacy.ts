import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { downloadDataExport, getPrivacyView, requestDataExport, setConsent } from '@mechdost/db/repo';
import {
  ConsentChangeBodySchema,
  PRIVACY_PURPOSES,
  ConsentListDto,
  ExportStatusDto,
  PrivacyViewDto,
} from '@mechdost/shared/privacy-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Account -> Privacy (DPDP; design 2026-11-15 item 6). The caller's own data only: the user id is the session's, so
 * another person's export id is a 404. Reading needs `account:read`, changing needs `account:write` (customers).
 * Consent changes and export requests are rate-limited per person; the download is private (sign-in required, no
 * public link), expires after 24 hours and is never cached.
 */
export const PRIVACY_WRITE_RATE: RateRule = { name: 'privacy_write', limit: 30, windowSeconds: 3600 };
export const EXPORT_REQUEST_RATE: RateRule = { name: 'data_export_request', limit: 5, windowSeconds: 3600 };

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const security = [{ bearerAuth: [] }];
const tags = ['privacy'];

const view = createRoute({
  method: 'get',
  path: '/me/privacy',
  tags,
  summary: 'Your consents with their dates, and your latest data download',
  security,
  responses: { 200: json(PrivacyViewDto, 'Privacy'), ...errorResponses },
});
const consent = createRoute({
  method: 'put',
  path: '/me/privacy/consents/{purpose}',
  tags,
  summary: 'Grant or withdraw one purpose (a new record is kept; a withdrawal takes effect at once)',
  security,
  request: {
    params: z.object({
      purpose: z.enum(PRIVACY_PURPOSES).openapi({ param: { name: 'purpose', in: 'path' } }),
    }),
    body: { required: true, content: { 'application/json': { schema: ConsentChangeBodySchema } } },
  },
  responses: { 200: json(ConsentListDto, 'Saved'), ...errorResponses },
});
const requestExport = createRoute({
  method: 'post',
  path: '/me/data-exports',
  tags,
  summary: 'Ask for a download of your data (built in the background; one at a time, once a day)',
  security,
  responses: {
    202: json(ExportStatusDto, 'Requested'),
    409: json(ErrorSchema, 'One is already in progress, or you asked less than a day ago'),
    ...errorResponses,
  },
});
const download = createRoute({
  method: 'get',
  path: '/me/data-exports/{id}/download',
  tags,
  summary: 'Download your data as JSON (yours only, until it expires after 24 hours)',
  security,
  request: { params: z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: json(z.record(z.string(), z.unknown()), 'Your data'),
    404: json(ErrorSchema, 'Not found (or not yours)'),
    409: json(ErrorSchema, 'Not ready, failed, or expired'),
    ...errorResponses,
  },
});

export function privacyRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/me/privacy', '/me/privacy/*', '/me/data-exports', '/me/data-exports/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.on(['GET'], path, requirePermission('account:read'));
    app.on(['POST', 'PUT', 'PATCH', 'DELETE'], path, requirePermission('account:write'));
  }
  app.on(
    ['PUT'],
    '/me/privacy/consents/*',
    rateLimit(deps.rateLimiter, PRIVACY_WRITE_RATE, (c) => c.get('auth').user.id),
  );
  app.on(
    ['POST'],
    '/me/data-exports',
    rateLimit(deps.rateLimiter, EXPORT_REQUEST_RATE, (c) => c.get('auth').user.id),
  );

  const user = (c: { get: (k: 'auth') => { user: { id: string } } }) => c.get('auth').user.id;

  return app
    .openapi(view, async (c) => c.json(await getPrivacyView(deps.db, user(c)), 200))
    .openapi(consent, async (c) =>
      c.json(
        {
          consents: await setConsent(deps.db, {
            userId: user(c),
            purpose: c.req.valid('param').purpose,
            granted: c.req.valid('json').granted,
          }),
        },
        200,
      ),
    )
    .openapi(requestExport, async (c) => c.json(await requestDataExport(deps.db, { userId: user(c) }), 202))
    .openapi(download, async (c) => {
      const out = await downloadDataExport(deps.db, {
        userId: user(c),
        exportId: c.req.valid('param').id,
      });
      return c.json(out.payload as Record<string, unknown>, 200, {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="mechdost-my-data.json"',
      });
    });
}
