import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  cityIdByCode,
  cityScopeFrom,
  countExportRows,
  exportHeader,
  exportPages,
  listCitiesInScope,
  NotFoundError,
  recordExportDownload,
  recordExportRequest,
  ValidationError,
  type CityScope,
  type ExportQuery,
} from '@mechdost/db/repo';
import {
  CSV_BOM,
  csvLine,
  EXPORT_DATASET_PERMISSION,
  EXPORT_LINK_TTL_SECONDS,
  EXPORT_DATASETS,
  ExportOptionsDto,
  ExportRequestDto,
  ExportTicketDto,
  exportRangeError,
  MAX_EXPORT_ROWS,
  type ExportRequest,
} from '@mechdost/shared/exports';
import { can, type Permission } from '@mechdost/shared/rbac';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, Forbidden } from '../errors';
import { signExportToken, verifyExportToken, type ExportTokenInput } from '../exports/token';
import { log, safeError } from '../logger';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/**
 * CSV exports for staff (design 2026-11-15 item 4, specs 08/12/13/14). `POST /admin/exports` checks the request,
 * counts the rows (capped), writes the audit row and the analytics event and returns a signed 10-minute download
 * path; `GET /admin/exports/download` authenticates the same staff member again, re-checks the permission and the city
 * scope, and streams the file page by page. Nothing is stored: the file exists only on the wire.
 */
const post = createRoute({
  method: 'post',
  path: '/admin/exports',
  tags: ['admin'],
  summary: 'Prepare a CSV export (orders, sub-orders, refunds, service requests, partners, customers)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: ExportRequestDto } } } },
  responses: {
    200: {
      description: 'A 10-minute download path',
      content: { 'application/json': { schema: ExportTicketDto } },
    },
    ...errorResponses,
  },
});

const options = createRoute({
  method: 'get',
  path: '/admin/exports/options',
  tags: ['admin'],
  summary: 'The datasets and cities this staff member may export (the form on the Exports screen)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Options', content: { 'application/json': { schema: ExportOptionsDto } } },
    ...errorResponses,
  },
});

const downloadQuery = z.object({ t: z.string().min(20).max(1000) }).strict();

const scopeOf = (c: Context<AppEnv>, permission: Permission): CityScope =>
  cityScopeFrom(c.get('auth').grants, permission);

/** Both scopes must allow a city: all with all = every city; otherwise the cities both grants name. */
function narrow(a: CityScope, b: CityScope): CityScope {
  if (a.all) return b;
  if (b.all) return a;
  return { all: false, cityIds: a.cityIds.filter((id) => b.cityIds.includes(id)) };
}

function need(c: Context<AppEnv>, permission: Permission): void {
  const auth = c.get('auth');
  if (can(auth.grants, permission)) return;
  if (can(auth.staffWithheld, permission))
    throw Forbidden('STAFF_2FA_REQUIRED', 'Sign in with your password and the code sent to your phone');
  throw Forbidden();
}

/** The range, the dataset right and the city scope of a request (used for the request and again for the download). */
async function resolveQuery(
  deps: AppDeps,
  c: Context<AppEnv>,
  req: Pick<ExportRequest, 'dataset' | 'from' | 'to'> & { cityCode?: string | null | undefined },
): Promise<ExportQuery> {
  const bad = exportRangeError(req.from, req.to);
  if (bad) throw new ValidationError('Choose at most 180 days, oldest day first', `EXPORT_${bad}`);
  const datasetPermission = EXPORT_DATASET_PERMISSION[req.dataset];
  need(c, datasetPermission);
  const scope = narrow(scopeOf(c, 'exports:run'), scopeOf(c, datasetPermission));
  const maskContacts = !scopeOf(c, 'customers:read_pii').all;
  if (req.dataset === 'customers') {
    // Customers belong to no city yet: only an all-cities grant may export them (like the customer screens).
    if (!scope.all) throw Forbidden('SCOPE_REQUIRED', 'This needs an all-cities role');
    if (req.cityCode) throw new ValidationError('Customers have no city', 'EXPORT_CITY_NOT_FOR_CUSTOMERS');
    return { dataset: req.dataset, from: req.from, to: req.to, cityIds: null, maskContacts };
  }
  if (req.cityCode) {
    const id = await cityIdByCode(deps.db, req.cityCode);
    if (!scope.all && !scope.cityIds.includes(id)) throw new NotFoundError('City not found');
    return { dataset: req.dataset, from: req.from, to: req.to, cityIds: [id], maskContacts };
  }
  return {
    dataset: req.dataset,
    from: req.from,
    to: req.to,
    cityIds: scope.all ? null : scope.cityIds,
    maskContacts,
  };
}

const fileNameOf = (q: ExportQuery) => `mechdost-${q.dataset.replaceAll('_', '-')}-${q.from}_to_${q.to}.csv`;

export function adminExportRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const guard = [
    authenticate(deps, cache),
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    requireVerified,
    requirePermission('exports:run'),
    rateLimit(deps.rateLimiter, RATE_RULES.adminExport, (c) => c.get('auth').user.id),
  ] as const;
  for (const mw of guard) {
    app.use('/admin/exports', mw);
    app.use('/admin/exports/download', mw);
    app.use('/admin/exports/options', mw);
  }
  const unavailable = () => new ApiError(503, 'EXPORTS_UNAVAILABLE', 'Exports are not available right now');

  app.openapi(options, async (c) => {
    const exportScope = scopeOf(c, 'exports:run');
    const datasets = EXPORT_DATASETS.filter((d) => {
      const permission = EXPORT_DATASET_PERMISSION[d];
      if (!can(c.get('auth').grants, permission)) return false;
      const scope = narrow(exportScope, scopeOf(c, permission));
      // Customers belong to no city: an all-cities grant is needed; a city-bound dataset needs at least one city.
      return d === 'customers' ? scope.all : scope.all || scope.cityIds.length > 0;
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        datasets,
        cities: await listCitiesInScope(deps.db, exportScope),
        contactsMasked: !scopeOf(c, 'customers:read_pii').all,
      },
      200,
    );
  });

  app.openapi(post, async (c) => {
    const keyring = deps.keyring;
    if (!keyring) throw unavailable();
    const req = c.req.valid('json');
    const query = await resolveQuery(deps, c, req);
    const rowCount = await countExportRows(deps.db, query);
    if (rowCount > MAX_EXPORT_ROWS)
      throw new ValidationError('Too many rows: choose a shorter range or one city', 'EXPORT_TOO_LARGE', {
        maxRows: MAX_EXPORT_ROWS,
      });
    const actorId = c.get('auth').user.id;
    await recordExportRequest(deps.db, { actorId, query, cityCode: req.cityCode ?? null, rowCount });
    const input: ExportTokenInput = {
      u: actorId,
      dataset: req.dataset,
      from: req.from,
      to: req.to,
      city: req.cityCode ?? null,
    };
    const token = signExportToken(keyring, input);
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        downloadPath: `/admin/exports/download?t=${token}`,
        expiresAt: new Date(Date.now() + EXPORT_LINK_TTL_SECONDS * 1000).toISOString(),
        fileName: fileNameOf(query),
        rowCount,
        masked: req.dataset === 'customers' && query.maskContacts,
      },
      200,
    );
  });

  // Plain route (a file, not JSON): same guards as above, then the link is checked against the signed-in user.
  app.get('/admin/exports/download', async (c) => {
    const keyring = deps.keyring;
    if (!keyring) throw unavailable();
    const parsed = downloadQuery.safeParse({ t: c.req.query('t') });
    if (!parsed.success) throw new ApiError(400, 'EXPORT_LINK_MISSING', 'A download link is required');
    const verified = verifyExportToken(keyring, parsed.data.t);
    const actorId = c.get('auth').user.id;
    if (!verified.ok)
      throw Forbidden(
        verified.reason === 'expired' ? 'EXPORT_LINK_EXPIRED' : 'EXPORT_LINK_INVALID',
        'This download link is not valid any more; prepare the export again',
      );
    if (verified.payload.u !== actorId)
      throw Forbidden(
        'EXPORT_LINK_INVALID',
        'This download link is not valid any more; prepare the export again',
      );
    const query = await resolveQuery(deps, c, { ...verified.payload, cityCode: verified.payload.city });

    const pages = exportPages(deps.db, query);
    const encoder = new TextEncoder();
    let rows = 0;
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      try {
        await recordExportDownload(deps.db, { actorId, query, rowCount: rows });
      } catch (err) {
        log('error', 'export_download_audit_failed', { error: safeError(err) });
      }
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(CSV_BOM + csvLine(exportHeader(query.dataset))));
      },
      async pull(controller) {
        try {
          const next = await pages.next();
          if (next.done) {
            controller.close();
            await finish();
            return;
          }
          rows += next.value.length;
          controller.enqueue(encoder.encode(next.value.map((r) => csvLine(r)).join('')));
        } catch (err) {
          log('error', 'export_stream_failed', { error: safeError(err) });
          controller.error(err);
          await finish();
        }
      },
      async cancel() {
        await pages.return(undefined);
        await finish();
      },
    });
    return c.body(body, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileNameOf(query)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  return app;
}
