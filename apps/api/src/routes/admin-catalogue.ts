import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  createProduct,
  getAdminProduct,
  HIGHLIGHT_LEN,
  HIGHLIGHT_MAX,
  importProducts,
  listAdminProducts,
  type NewProduct,
  setProductAttributes,
  setProductStatus,
  setProductVehicleTypes,
  setVariantNetQuantity,
  updateProductTexts,
} from '@mechdost/db/repo';
import { AdminImportReport, AdminProductCreated, NewProductFields } from '@mechdost/shared/admin-catalogue';
import {
  csvImportRows,
  FIELD_COLUMN,
  IMPORT_MAX_CSV_CHARS,
  type ImportRowError,
} from '@mechdost/shared/catalogue-import';
import { NET_QTY_MAX, NET_UNITS } from '@mechdost/shared/product-attributes';
import { can } from '@mechdost/shared/rbac';
import { PRODUCT_STATES } from '@mechdost/shared/state';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { enforceRate, rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { ApiError, Forbidden } from '../errors';
import { adminCatalogueGroupRoutes } from './admin-catalogue-groups';
import { productPhotoAdminRoutes } from './product-photos';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin catalogue editor (spec 02/08): verified staff with `products:write` read and edit English + Hindi texts;
 * `products:publish` changes status. The catalogue is global (not city-scoped). Strict bodies: only the listed
 * text fields can be changed here (no mass assignment of price, HSN or status).
 */
const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
  .openapi({ param: { name: 'slug', in: 'path' }, example: 'exide-xltz4a-2w-battery' });

const Product = z
  .object({
    slug: z.string(),
    status: z.string(),
    version: z.number().int(),
    brand: z.string(),
    category: z.string(),
    name: z.string(),
    nameHi: z.string().nullable(),
    specSummary: z.string().nullable(),
    specSummaryHi: z.string().nullable(),
    compatibility: z.string().nullable(),
    compatibilityHi: z.string().nullable(),
    description: z.string().nullable(),
    descriptionHi: z.string().nullable(),
    highlights: z.array(z.string()),
    highlightsHi: z.array(z.string()),
    vehicleTypes: z.array(z.string()),
    rejectionReason: z.string().nullable(),
    missingHindi: z.array(z.string()),
  })
  .openapi('AdminProduct');

/** The editor's view of one product: the list fields plus its typed attributes and every pack. */
const ProductDetail = Product.extend({
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  variants: z.array(
    z.object({
      sku: z.string(),
      mrpPaise: z.number().int().nullable(),
      netQuantity: z.object({ qty: z.number().int(), unit: z.enum(NET_UNITS) }).nullable(),
    }),
  ),
}).openapi('AdminProductDetail');

const text = (max: number) => z.string().max(max).nullable().optional();
const highlights = z.array(z.string().max(HIGHLIGHT_LEN)).max(HIGHLIGHT_MAX).optional();
const Patch = z
  .object({
    version: z.number().int().min(1),
    name: z.string().min(3).max(160).optional(),
    nameHi: text(160),
    specSummary: text(200),
    specSummaryHi: text(200),
    compatibility: text(300),
    compatibilityHi: text(300),
    description: text(4000),
    descriptionHi: text(4000),
    highlights,
    highlightsHi: highlights,
  })
  .strict()
  .openapi('AdminProductTextPatch');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = { 404: json(ErrorSchema, 'Not found'), 409: json(ErrorSchema, 'Changed meanwhile') };

const list = createRoute({
  method: 'get',
  path: '/admin/catalogue/products',
  tags: ['admin'],
  summary: 'Products in slug order with their missing Hindi fields',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.enum(PRODUCT_STATES).optional(),
      missingHindi: z.enum(['true', 'false']).optional(),
      /** Packs without an MRP ("price on request"). */
      missingMrp: z.enum(['true', 'false']).optional(),
      brand: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
        .optional(),
      range: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
        .optional(),
      after: z
        .string()
        .regex(/^[a-z0-9-]{1,120}$/)
        .optional(),
    }),
  },
  responses: {
    200: json(z.object({ items: z.array(Product), next: z.string().nullable() }), 'Products'),
    ...errorResponses,
  },
});

const detail = createRoute({
  method: 'get',
  path: '/admin/catalogue/products/{slug}',
  tags: ['admin'],
  summary: 'One product, English and Hindi side by side',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ slug: Slug }) },
  responses: { 200: json(ProductDetail, 'Product'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const patch = createRoute({
  method: 'patch',
  path: '/admin/catalogue/products/{slug}',
  tags: ['admin'],
  summary: 'Edit English and Hindi texts (compare-and-set on version)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ slug: Slug }),
    body: { required: true, content: { 'application/json': { schema: Patch } } },
  },
  responses: {
    200: json(z.object({ version: z.number().int(), missingHindi: z.array(z.string()) }), 'Saved'),
    ...conflict,
    ...errorResponses,
  },
});

const status = createRoute({
  method: 'post',
  path: '/admin/catalogue/products/{slug}/status',
  tags: ['admin'],
  summary: 'Publish, reject (with a reason for the shop), archive or revive',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ slug: Slug }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              to: z.enum(PRODUCT_STATES),
              version: z.number().int().min(1),
              rejectionReason: z.string().trim().min(5).max(300).optional(),
            })
            .strict()
            .openapi('AdminProductStatus'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ version: z.number().int(), status: z.string() }), 'Changed'),
    ...conflict,
    ...errorResponses,
  },
});

const vehicleTypes = createRoute({
  method: 'put',
  path: '/admin/catalogue/products/{slug}/vehicle-types',
  tags: ['admin'],
  summary: 'Set the vehicle types a product is for (2W, 3W, 4W; empty = fitment not listed)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ slug: Slug }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              version: z.number().int().min(1),
              vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(VEHICLE_TYPES.length * 2),
            })
            .strict()
            .openapi('AdminProductVehicleTypes'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ version: z.number().int(), vehicleTypes: z.array(z.enum(VEHICLE_TYPES)) }), 'Saved'),
    ...conflict,
    ...errorResponses,
  },
});

const attributes = createRoute({
  method: 'put',
  path: '/admin/catalogue/products/{slug}/attributes',
  tags: ['admin'],
  summary: "Set a product's typed attributes (checked against its category's definitions; replaces the set)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ slug: Slug }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              version: z.number().int().min(1),
              attributes: z
                .record(z.string().max(40), z.union([z.string().max(40), z.number(), z.boolean()]))
                .refine((a) => Object.keys(a).length <= 20, 'At most 20 attributes'),
            })
            .strict()
            .openapi('AdminProductAttributes'),
        },
      },
    },
  },
  responses: {
    200: json(
      z.object({
        version: z.number().int(),
        attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      }),
      'Saved',
    ),
    ...conflict,
    ...errorResponses,
  },
});

/** One pack's net quantity: a whole number in ml, g, piece or m (design 2026-11-13). */
const Pack = z.object({ qty: z.number().int().min(1).max(NET_QTY_MAX), unit: z.enum(NET_UNITS) }).strict();

const netQuantity = createRoute({
  method: 'put',
  path: '/admin/catalogue/variants/{sku}/net-quantity',
  tags: ['admin'],
  summary: 'Set or clear the net quantity of one pack (for the unit price)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ sku: z.string().min(1).max(64) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ netQuantity: Pack.nullable() }).strict().openapi('AdminVariantNetQuantity'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ sku: z.string(), netQuantity: Pack.nullable() }), 'Saved'),
    ...conflict,
    ...errorResponses,
  },
});

const create = createRoute({
  method: 'post',
  path: '/admin/catalogue/products',
  tags: ['admin'],
  summary: 'Add a product with its first pack (draft; live only with products:publish and publish=true)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: NewProductFields.extend({ publish: z.boolean().optional() })
            .strict()
            .openapi('AdminNewProduct'),
        },
      },
    },
  },
  responses: {
    201: json(AdminProductCreated.openapi('AdminProductCreated'), 'Created'),
    409: json(ErrorSchema, 'SKU_TAKEN or SLUG_TAKEN'),
    422: json(ErrorSchema, 'A catalogue rule failed (code names it; details.errors by field)'),
    ...errorResponses,
  },
});

const importRoute = createRoute({
  method: 'post',
  path: '/admin/catalogue/import',
  tags: ['admin'],
  summary:
    'Import products from CSV (docs/runbooks/catalogue-import.md): all rows checked first, one transaction, SKUs already present skipped',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              csv: z.string().min(1).max(IMPORT_MAX_CSV_CHARS),
              dryRun: z.boolean().optional(),
              publish: z.boolean().optional(),
            })
            .strict()
            .openapi('AdminCatalogueImport'),
        },
      },
    },
  },
  responses: {
    200: json(AdminImportReport.openapi('AdminImportReport'), 'Imported (or checked, on a dry run)'),
    422: json(
      ErrorSchema,
      'IMPORT_FILE (details.reason) or IMPORT_ROWS_INVALID (details.errors); nothing written',
    ),
    ...errorResponses,
  },
});

/** One problem per row and column, named by the CSV column (the same names the runbook and the screen use). */
function rowIssues(row: number, input: Record<string, unknown>, issues: readonly z.core.$ZodIssue[]) {
  const out = new Map<string, ImportRowError>();
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    const field = FIELD_COLUMN[key];
    if (!field || out.has(field)) continue;
    const code = !(key in input)
      ? 'REQUIRED'
      : issue.code === 'too_big' && issue.origin === 'string'
        ? 'TOO_LONG'
        : 'INVALID';
    out.set(field, { row, field, code });
  }
  return [...out.values()];
}

/** Publishing on create needs `products:publish` too (the same rule as the status route). */
function mayPublish(c: Context<AppEnv>, publish: boolean | undefined): boolean {
  if (publish !== true) return false;
  const auth = c.get('auth');
  if (can(auth.grants, 'products:publish')) return true;
  if (can(auth.staffWithheld, 'products:publish'))
    throw Forbidden('STAFF_2FA_REQUIRED', 'Sign in with your password and the code sent to your phone');
  throw Forbidden();
}

export function adminCatalogueRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/catalogue/*'; // one pattern per prefix (L54)
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('products:write'));
  app.on('POST', '/admin/catalogue/products/:slug/status', requirePermission('products:publish'));
  app.on('POST', '/admin/catalogue/import', requirePermission('products:import'));
  app.on('POST', '/admin/catalogue/products/bulk-status', requirePermission('products:publish'));
  // Hiding a brand or range changes the public storefront: publish-level (design 2026-11-22).
  app.on('POST', '/admin/catalogue/brands/:slug/visibility', requirePermission('products:publish'));
  app.on('POST', '/admin/catalogue/ranges/:slug/visibility', requirePermission('products:publish'));
  // Product photos share this stack (sign-in, limits, products:write) and add publish rights for the queue (L190).
  app.route('/', productPhotoAdminRoutes(deps));
  // Brands and ranges, bulk status and MRPs (design 2026-11-22) share the stack too.
  app.route('/', adminCatalogueGroupRoutes(deps));

  return app
    .openapi(create, async (c) => {
      const { publish, ...product } = c.req.valid('json');
      const r = await createProduct(deps.db, {
        product,
        publish: mayPublish(c, publish),
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 201);
    })
    .openapi(importRoute, async (c) => {
      const body = c.req.valid('json');
      const userId = c.get('auth').user.id;
      const publish = mayPublish(c, body.publish);
      await enforceRate(c, deps.rateLimiter, RATE_RULES.catalogueImport, userId);
      const file = csvImportRows(body.csv);
      if (!file.ok)
        throw new ApiError(422, 'IMPORT_FILE', 'The file could not be read', {
          reason: file.code,
          ...(file.code === 'HEADER' ? { missing: file.missing, unknown: file.unknown } : {}),
        });
      const rows: { row: number; input: NewProduct }[] = [];
      const invalid: ImportRowError[] = [];
      for (const r of file.rows) {
        const parsed = NewProductFields.safeParse(r.input);
        const issues = parsed.success ? [] : rowIssues(r.row, r.input, parsed.error.issues);
        const cellFields = new Set(r.errors.map((e) => e.field));
        invalid.push(...r.errors, ...issues.filter((i) => !cellFields.has(i.field)));
        if (parsed.success && r.errors.length === 0) rows.push({ row: r.row, input: parsed.data });
      }
      const report = await importProducts(deps.db, {
        rows,
        invalid,
        dryRun: body.dryRun === true,
        publish,
        staffUserId: userId,
      });
      return c.json(report, 200);
    })
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      const page = await listAdminProducts(deps.db, {
        status: q.status ?? null,
        missingHindiOnly: q.missingHindi === 'true',
        missingMrpOnly: q.missingMrp === 'true',
        brand: q.brand ?? null,
        range: q.range ?? null,
        after: q.after ?? null,
      });
      return c.json(page, 200);
    })
    .openapi(detail, async (c) => {
      const { id: _id, ...p } = await getAdminProduct(deps.db, c.req.valid('param').slug);
      return c.json(p, 200);
    })
    .openapi(patch, async (c) => {
      const { version, ...fields } = c.req.valid('json');
      const r = await updateProductTexts(deps.db, {
        slug: c.req.valid('param').slug,
        expectedVersion: version,
        patch: fields,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(vehicleTypes, async (c) => {
      const b = c.req.valid('json');
      const r = await setProductVehicleTypes(deps.db, {
        slug: c.req.valid('param').slug,
        expectedVersion: b.version,
        vehicleTypes: b.vehicleTypes,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(attributes, async (c) => {
      const b = c.req.valid('json');
      const r = await setProductAttributes(deps.db, {
        slug: c.req.valid('param').slug,
        expectedVersion: b.version,
        attributes: b.attributes,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(netQuantity, async (c) => {
      const r = await setVariantNetQuantity(deps.db, {
        sku: c.req.valid('param').sku,
        netQuantity: c.req.valid('json').netQuantity,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(status, async (c) => {
      const b = c.req.valid('json');
      const r = await setProductStatus(deps.db, {
        slug: c.req.valid('param').slug,
        to: b.to,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        rejectionReason: b.rejectionReason ?? null,
      });
      return c.json(r, 200);
    });
}
