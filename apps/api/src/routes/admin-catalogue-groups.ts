import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  bulkSetMrp,
  bulkSetProductStatus,
  lastImportRun,
  listBrandGroups,
  setBrandHidden,
  setRangeHidden,
} from '@mechdost/db/repo';
import { BULK_MAX, HIDE_REASONS } from '@mechdost/shared/catalogue-groups';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Brands and ranges, bulk product actions and MRPs (design 2026-11-22; spec 02 and 08). Mounted by
 * `adminCatalogueRoutes` AFTER its sign-in, rate-limit, verification and `products:write` middleware, so only the
 * publish-level route (`bulk-status`, declared there) adds a permission. Strict bodies, at most 500 items, reason
 * codes from one list, every change version-checked and audited by the repository.
 */
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const Reason = z.enum(HIDE_REASONS);

const Group = z.object({
  slug: z.string(),
  name: z.string(),
  hidden: z.boolean(),
  hiddenReason: Reason.nullable(),
  version: z.number().int(),
  products: z.number().int(),
  liveProducts: z.number().int(),
  missingMrpPacks: z.number().int(),
});
const Groups = z
  .object({
    brands: z.array(Group.extend({ ranges: z.array(Group.extend({ nameHi: z.string().nullable() })) })),
  })
  .openapi('AdminCatalogueGroups');

const Switched = z
  .object({
    version: z.number().int(),
    hidden: z.boolean(),
    hiddenReason: Reason.nullable(),
    productsAffected: z.number().int(),
  })
  .openapi('AdminGroupSwitched');

const SwitchBody = z
  .object({
    hidden: z.boolean(),
    reasonCode: Reason.nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .openapi('AdminGroupSwitch');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = { 404: json(ErrorSchema, 'Not found'), 409: json(ErrorSchema, 'Changed meanwhile') };

const groups = createRoute({
  method: 'get',
  path: '/admin/catalogue/groups',
  tags: ['admin'],
  summary: 'Every brand with its ranges, product counts and packs without an MRP',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(Groups, 'Brands and ranges'), ...errorResponses },
});

const switchRoute = (kind: 'brand' | 'range') =>
  createRoute({
    method: 'post',
    path: `/admin/catalogue/${kind}s/{slug}/visibility`,
    tags: ['admin'],
    summary: `Hide or show a ${kind} (and so all its products) on the storefront; a reason code is needed to hide`,
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ slug: Slug }),
      body: { required: true, content: { 'application/json': { schema: SwitchBody } } },
    },
    responses: { 200: json(Switched, 'Switched'), ...conflict, ...errorResponses },
  });

const Counts = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
});
const importStatus = createRoute({
  method: 'get',
  path: '/admin/catalogue/import-status',
  tags: ['admin'],
  summary:
    'Counts of the last real catalogue-v2 import run, per brand and per skip reason (null before the first)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(
      z
        .object({
          run: z
            .object({
              at: z.string(),
              brands: z.record(z.string(), Counts),
              reasons: z.record(z.string(), z.number().int()),
              totals: Counts.extend({ products: z.number().int() }),
            })
            .nullable(),
        })
        .openapi('AdminImportStatus'),
      'Last run',
    ),
    ...errorResponses,
  },
});

const bulkStatus = createRoute({
  method: 'post',
  path: '/admin/catalogue/products/bulk-status',
  tags: ['admin'],
  summary: `Publish or unpublish up to ${String(BULK_MAX)} products (products:publish); others are reported as skipped`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              slugs: z.array(Slug).min(1).max(BULK_MAX),
              action: z.enum(['publish', 'unpublish']),
            })
            .strict()
            .openapi('AdminBulkStatus'),
        },
      },
    },
  },
  responses: {
    200: json(
      z
        .object({
          changed: z.array(z.string()),
          skipped: z.array(
            z.object({
              slug: z.string(),
              reason: z.enum(['NOT_FOUND', 'WRONG_STATE', 'NO_VARIANT', 'HINDI_MISSING']),
            }),
          ),
        })
        .openapi('AdminBulkStatusResult'),
      'Done',
    ),
    ...errorResponses,
  },
});

const mrps = createRoute({
  method: 'put',
  path: '/admin/catalogue/mrps',
  tags: ['admin'],
  summary: `Set the MRP (incl. GST, paise) of up to ${String(BULK_MAX)} packs; never below a price already set`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              items: z
                .array(
                  z
                    .object({
                      sku: z.string().min(1).max(64),
                      mrpPaise: z.number().int().min(1).max(100_000_000),
                    })
                    .strict(),
                )
                .min(1)
                .max(BULK_MAX),
            })
            .strict()
            .openapi('AdminBulkMrp'),
        },
      },
    },
  },
  responses: {
    200: json(
      z
        .object({
          updated: z.array(z.string()),
          skipped: z.array(z.object({ sku: z.string(), reason: z.enum(['NOT_FOUND', 'BELOW_PRICE']) })),
        })
        .openapi('AdminBulkMrpResult'),
      'Done',
    ),
    ...errorResponses,
  },
});

export function adminCatalogueGroupRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const user = (c: { get: (k: 'auth') => { user: { id: string } } }) => c.get('auth').user.id;
  return app
    .openapi(groups, async (c) => c.json({ brands: await listBrandGroups(deps.db) }, 200))
    .openapi(importStatus, async (c) => c.json({ run: await lastImportRun(deps.db) }, 200))
    .openapi(switchRoute('brand'), async (c) => {
      const b = c.req.valid('json');
      const r = await setBrandHidden(deps.db, {
        slug: c.req.valid('param').slug,
        hidden: b.hidden,
        reasonCode: b.reasonCode ?? null,
        expectedVersion: b.version,
        staffUserId: user(c),
      });
      return c.json(r, 200);
    })
    .openapi(switchRoute('range'), async (c) => {
      const b = c.req.valid('json');
      const r = await setRangeHidden(deps.db, {
        slug: c.req.valid('param').slug,
        hidden: b.hidden,
        reasonCode: b.reasonCode ?? null,
        expectedVersion: b.version,
        staffUserId: user(c),
      });
      return c.json(r, 200);
    })
    .openapi(bulkStatus, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await bulkSetProductStatus(deps.db, { slugs: b.slugs, action: b.action, staffUserId: user(c) }),
        200,
      );
    })
    .openapi(mrps, async (c) =>
      c.json(await bulkSetMrp(deps.db, { items: c.req.valid('json').items, staffUserId: user(c) }), 200),
    );
}
