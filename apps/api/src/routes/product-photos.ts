import { createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  findProductPhotoForServing,
  listPhotoQueue,
  listProductPhotos,
  prepareProductPhoto,
  removeProductPhoto,
  reorderProductPhotos,
  reviewProductPhoto,
  saveProductPhoto,
  shopIdsFrom,
  updateProductPhotoAlt,
  uuidv7,
  type PhotoActor,
  type ProductPhotoRow,
  type RemovedPhotoKeys,
} from '@mechdost/db/repo';
import {
  AdminProductPhotoDto,
  AdminProductPhotosDto,
  PhotoOrderBody,
  PhotoPatchBody,
  PhotoQueueDto,
  PhotoRejectBody,
  PhotoRemovedDto,
  PRODUCT_PHOTO_MAX,
  PRODUCT_PHOTO_UPLOAD_WINDOW_SECONDS,
  PRODUCT_PHOTO_UPLOADS_PER_WINDOW,
  ProductPhotoAltSchema,
  productPhotoPath,
  type ProductPhotoWidth,
} from '@mechdost/shared/product-photos';
import { PHOTO_MAX_BYTES } from '@mechdost/shared/service-photos';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, errorBody } from '../errors';
import { log } from '../logger';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { processProductPhoto } from '../photos/image';
import { signPhotoUrl, verifyPhotoUrl } from '../photos/url-token';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Product photos (spec 02 "Product photos", spec 13 "Uploads", design 2026-11-15 item 1).
 * - Staff (`products:write`, mounted inside the admin catalogue module so one middleware stack guards them): upload
 *   (multipart `file`, `alt`, `altHi`), list, reorder, edit the description, remove. `products:publish`: the approval
 *   queue for shops' photos (approve, or refuse with a reason code).
 * - Shops (`inventory:write`, their own shops): add photos to products they sell, only while the setting
 *   `catalogue.shop_photo_uploads` is on; a photo waits for approval; they may remove their own pending photo.
 * - Public: `GET /product-photos/{id}/{320|640|1600}`. Ruling 2026-11-15: product photos are public once approved, so
 *   the answer is a cacheable one-year `immutable` image by its (never reused) id; the bucket itself stays private and
 *   Storage is reached only here. A photo that is pending, refused or removed is 404 unless the URL carries a valid
 *   10-minute signature (the previews the editor and the shop see).
 * The image goes through the same gate as job photos (first bytes, decode, re-encode, EXIF gone) and is cut into three
 * variants plus a placeholder. Without Storage keys (Q112) every upload answers 503 `PHOTOS_UNAVAILABLE`.
 */
export const PRODUCT_PHOTO_UPLOAD_RATE: RateRule = {
  name: 'product_photo_upload_user',
  limit: PRODUCT_PHOTO_UPLOADS_PER_WINDOW,
  windowSeconds: PRODUCT_PHOTO_UPLOAD_WINDOW_SECONDS,
};
/** A listing page shows up to a few dozen photos; the long cache keeps repeat views off this limit. */
export const PRODUCT_PHOTO_READ_RATE: RateRule = { name: 'product_photo_ip', limit: 1200, windowSeconds: 60 };

const UPLOAD_BODY_MAX = PHOTO_MAX_BYTES + 64 * 1024;
const sec = [{ bearerAuth: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
  .openapi({ param: { name: 'slug', in: 'path' } });
const PhotoId = z.uuid().openapi({ param: { name: 'photoId', in: 'path' } });
const Width = z.enum(['320', '640', '1600']);
const problems = {
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Conflict (limit, changed, already reviewed)'),
  422: json(ErrorSchema, 'A rule was not met'),
  ...errorResponses,
};
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const adminList = createRoute({
  method: 'get',
  path: '/admin/catalogue/products/{slug}/photos',
  tags: ['admin'],
  summary: 'A product’s photos in order, pending ones included',
  security: sec,
  request: { params: z.object({ slug: Slug }) },
  responses: { 200: json(AdminProductPhotosDto, 'Photos'), ...problems },
});
const adminOrder = createRoute({
  method: 'put',
  path: '/admin/catalogue/products/{slug}/photos/order',
  tags: ['admin'],
  summary: 'Set the order: the ids must be exactly the product’s photos, first is the cover',
  security: sec,
  request: { params: z.object({ slug: Slug }), ...body(PhotoOrderBody) },
  responses: { 200: json(AdminProductPhotosDto, 'Photos'), ...problems },
});
const adminPatch = createRoute({
  method: 'patch',
  path: '/admin/catalogue/products/{slug}/photos/{photoId}',
  tags: ['admin'],
  summary: 'Edit a photo’s description in English and Hindi (send the version you read)',
  security: sec,
  request: { params: z.object({ slug: Slug, photoId: PhotoId }), ...body(PhotoPatchBody) },
  responses: { 200: json(z.object({ photo: AdminProductPhotoDto }), 'Saved'), ...problems },
});
const adminRemove = createRoute({
  method: 'delete',
  path: '/admin/catalogue/products/{slug}/photos/{photoId}',
  tags: ['admin'],
  summary: 'Remove a photo (audited; its files are deleted)',
  security: sec,
  request: { params: z.object({ slug: Slug, photoId: PhotoId }) },
  responses: { 200: json(PhotoRemovedDto, 'Removed'), ...problems },
});
const queue = createRoute({
  method: 'get',
  path: '/admin/catalogue/photo-queue',
  tags: ['admin'],
  summary: 'Shops’ photos waiting for approval, oldest first',
  security: sec,
  responses: { 200: json(PhotoQueueDto, 'Queue'), ...problems },
});
const approve = createRoute({
  method: 'post',
  path: '/admin/catalogue/photos/{photoId}/approve',
  tags: ['admin'],
  summary: 'Approve a shop’s photo: it becomes public',
  security: sec,
  request: { params: z.object({ photoId: PhotoId }) },
  responses: { 200: json(PhotoRemovedDto, 'Approved'), ...problems },
});
const reject = createRoute({
  method: 'post',
  path: '/admin/catalogue/photos/{photoId}/reject',
  tags: ['admin'],
  summary: 'Refuse a shop’s photo with a reason code: it is removed',
  security: sec,
  request: { params: z.object({ photoId: PhotoId }), ...body(PhotoRejectBody) },
  responses: { 200: json(PhotoRemovedDto, 'Refused'), ...problems },
});
const shopList = createRoute({
  method: 'get',
  path: '/shop/products/{slug}/photos',
  tags: ['shop'],
  summary: 'The photos of a product your shop sells (approved, and your own pending)',
  security: sec,
  request: { params: z.object({ slug: Slug }) },
  responses: { 200: json(AdminProductPhotosDto, 'Photos'), ...problems },
});
const shopRemove = createRoute({
  method: 'delete',
  path: '/shop/products/{slug}/photos/{photoId}',
  tags: ['shop'],
  summary: 'Remove your own photo while it waits for approval',
  security: sec,
  request: { params: z.object({ slug: Slug, photoId: PhotoId }) },
  responses: { 200: json(PhotoRemovedDto, 'Removed'), ...problems },
});

function storageOf(deps: AppDeps) {
  if (!deps.keyring || !deps.photoStorage)
    throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
  return { keyring: deps.keyring, storage: deps.photoStorage };
}
type Storage = ReturnType<typeof storageOf>;

/** A 10-minute signed URL of the 640 px variant, for photos that are not public (yet). */
const previewUrlOf = (kc: Storage, photoId: string): string => {
  const { exp, sig } = signPhotoUrl(kc.keyring, photoId);
  return `${productPhotoPath(photoId, 640)}?e=${String(exp)}&s=${sig}`;
};

const toDto = (p: ProductPhotoRow, kc: Storage) => {
  return {
    id: p.id,
    status: p.status,
    alt: p.alt,
    altHi: p.altHi,
    sort: p.sort,
    width: p.width,
    height: p.height,
    lqip: p.lqip,
    previewUrl: previewUrlOf(kc, p.id),
    submittedByShopId: p.submittedByShopId,
    version: p.version,
  };
};

/** Best-effort delete of the files of a removed photo (the rows are already gone from every list). */
async function deleteObjects(storage: Storage['storage'], keys: RemovedPhotoKeys | null): Promise<void> {
  if (!keys) return;
  await Promise.allSettled(keys.paths.map((p) => storage.remove(p)));
}

/**
 * Upload handler shared by staff and shops (multipart `file`, `alt`, `altHi`). Order of work: Storage configured,
 * form valid, rights/setting/limit pre-check (404/409 before any image work), decode and re-encode, store, then the
 * repository re-checks everything under the product lock. A failure at any step removes what was stored.
 */
async function uploadPhoto(deps: AppDeps, c: Context<AppEnv>, slug: string, actor: PhotoActor) {
  const kc = storageOf(deps);
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data'))
    throw new ApiError(422, 'PHOTO_TYPE', 'Send the photo as a form upload');
  const form = await c.req.parseBody();
  const alt = ProductPhotoAltSchema.safeParse(form.alt);
  const altHi = ProductPhotoAltSchema.safeParse(form.altHi);
  if (!alt.success || !altHi.success)
    throw new ApiError(422, 'PRODUCT_PHOTO_ALT', 'Describe the photo in English and Hindi');
  const file = form.file;
  if (!(file instanceof File)) throw new ApiError(422, 'PHOTO_TYPE', 'Send a photo');
  if (file.size > PHOTO_MAX_BYTES)
    throw new ApiError(413, 'PHOTO_TOO_LARGE', 'The photo is bigger than 8 MB');

  const { productId } = await prepareProductPhoto(deps.db, { slug, actor });
  const processed = await processProductPhoto(Buffer.from(await file.arrayBuffer()));
  const mediaId = uuidv7();
  const dir = `product/${productId}`;
  const path = `${dir}/${mediaId}.webp`;
  const thumbPath = `${dir}/${mediaId}-thumb.webp`;
  const path640 = `${dir}/${mediaId}-640.webp`;
  const cleanup = () =>
    Promise.allSettled([path, thumbPath, path640].map((p) => kc.storage.remove(p))).then(() => undefined);
  try {
    await kc.storage.put(path, processed.w1600);
    await kc.storage.put(thumbPath, processed.w320);
    await kc.storage.put(path640, processed.w640);
  } catch (err) {
    log('error', 'photo_storage_failed', {
      op: 'put',
      message: err instanceof Error ? err.message : 'unknown',
    });
    await cleanup();
    throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
  }
  try {
    const row = await saveProductPhoto(deps.db, {
      slug,
      actor,
      alt: alt.data,
      altHi: altHi.data,
      image: {
        mediaId,
        bucket: kc.storage.bucket,
        path,
        thumbPath,
        path640,
        width: processed.width,
        height: processed.height,
        bytes: processed.w1600.length,
        thumbBytes: processed.w320.length,
        sha256: createHash('sha256').update(processed.w1600).digest('hex'),
        lqip: processed.lqip,
      },
    });
    return c.json({ photo: toDto(row, kc) }, 201);
  } catch (err) {
    await cleanup();
    throw err;
  }
}

const uploadLimit = bodyLimit({
  maxSize: UPLOAD_BODY_MAX,
  onError: (c) => c.json(errorBody(c, 'PHOTO_TOO_LARGE', 'The photo is bigger than 8 MB'), 413),
});

/**
 * Staff routes. Mounted by `adminCatalogueRoutes` after its own sign-in, rate-limit, verification and
 * `products:write` middleware (L190), so only the publish-level routes add a permission here.
 */
export function productPhotoAdminRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const user = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.on('GET', '/admin/catalogue/photo-queue', requirePermission('products:publish'));
  app.on('POST', '/admin/catalogue/photos/:photoId/approve', requirePermission('products:publish'));
  app.on('POST', '/admin/catalogue/photos/:photoId/reject', requirePermission('products:publish'));

  app.post(
    '/admin/catalogue/products/:slug/photos',
    rateLimit(deps.rateLimiter, PRODUCT_PHOTO_UPLOAD_RATE, (c) => c.get('auth').user.id),
    uploadLimit,
    (c) => {
      const slug = Slug.safeParse(c.req.param('slug'));
      if (!slug.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return uploadPhoto(deps, c, slug.data, { kind: 'staff', userId: user(c) });
    },
  );

  const listBody = async (slug: string, kc: Storage, actor: PhotoActor) => {
    const r = await listProductPhotos(deps.db, { slug, actor });
    return {
      photos: r.photos.map((p) => toDto(p, kc)),
      max: PRODUCT_PHOTO_MAX,
      shopUploadsEnabled: r.shopUploadsEnabled,
    };
  };

  return app
    .openapi(adminList, async (c) =>
      c.json(
        await listBody(c.req.valid('param').slug, storageOf(deps), { kind: 'staff', userId: user(c) }),
        200,
      ),
    )
    .openapi(adminOrder, async (c) => {
      const kc = storageOf(deps);
      const rows = await reorderProductPhotos(deps.db, {
        slug: c.req.valid('param').slug,
        ids: c.req.valid('json').ids,
        userId: user(c),
      });
      return c.json(
        { photos: rows.map((p) => toDto(p, kc)), max: PRODUCT_PHOTO_MAX, shopUploadsEnabled: false },
        200,
      );
    })
    .openapi(adminPatch, async (c) => {
      const kc = storageOf(deps);
      const p = c.req.valid('param');
      const { version, alt, altHi } = c.req.valid('json');
      const row = await updateProductPhotoAlt(deps.db, {
        slug: p.slug,
        photoId: p.photoId,
        version,
        alt,
        altHi,
        userId: user(c),
      });
      return c.json({ photo: toDto(row, kc) }, 200);
    })
    .openapi(adminRemove, async (c) => {
      const p = c.req.valid('param');
      const keys = await removeProductPhoto(deps.db, {
        slug: p.slug,
        photoId: p.photoId,
        actor: { kind: 'staff', userId: user(c) },
      });
      deps.photoCache?.evict(p.photoId);
      if (deps.photoStorage) await deleteObjects(deps.photoStorage, keys);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(queue, async (c) => {
      const kc = storageOf(deps);
      const q = await listPhotoQueue(deps.db);
      return c.json(
        {
          items: q.items.map((i) => ({
            ...i,
            createdAt: i.createdAt.toISOString(),
            previewUrl: previewUrlOf(kc, i.photoId),
          })),
        },
        200,
      );
    })
    .openapi(approve, async (c) => {
      await reviewProductPhoto(deps.db, {
        photoId: c.req.valid('param').photoId,
        decision: 'approved',
        userId: user(c),
      });
      return c.json({ ok: true as const }, 200);
    })
    .openapi(reject, async (c) => {
      const keys = await reviewProductPhoto(deps.db, {
        photoId: c.req.valid('param').photoId,
        decision: 'rejected',
        reasonCode: c.req.valid('json').reasonCode,
        userId: user(c),
      });
      deps.photoCache?.evict(c.req.valid('param').photoId);
      if (deps.photoStorage) await deleteObjects(deps.photoStorage, keys);
      return c.json({ ok: true as const }, 200);
    });
}

/** Shop routes and the public image route. */
export function productPhotoRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const user = (c: Context<AppEnv>) => c.get('auth').user.id;
  const actorOf = (c: Context<AppEnv>): PhotoActor => ({
    kind: 'shop',
    userId: user(c),
    shopIds: shopIdsFrom(c.get('auth').grants, 'inventory:write'),
  });

  app.use('/shop/products/*', authenticate(deps, cache));
  app.use(
    '/shop/products/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/shop/products/*', requireVerified);
  app.use('/shop/products/*', requirePermission('inventory:write'));
  app.use(
    '/product-photos/:id/:width',
    rateLimit(deps.rateLimiter, PRODUCT_PHOTO_READ_RATE, (c) => c.get('clientIp')),
  );

  app.post(
    '/shop/products/:slug/photos',
    rateLimit(deps.rateLimiter, PRODUCT_PHOTO_UPLOAD_RATE, (c) => c.get('auth').user.id),
    uploadLimit,
    (c) => {
      const slug = Slug.safeParse(c.req.param('slug'));
      if (!slug.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return uploadPhoto(deps, c, slug.data, actorOf(c));
    },
  );

  // The public image route. Approved photos of live products are public and immutable (the id is never reused);
  // anything else is served only under a valid signature (editor and shop previews), else 404 with no hint why.
  app.get('/product-photos/:id/:width', async (c) => {
    const kc = storageOf(deps);
    const id = z.uuid().safeParse(c.req.param('id'));
    const width = Width.safeParse(c.req.param('width'));
    if (!id.success || !width.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    const served = await findProductPhotoForServing(deps.db, id.data);
    if (!served) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    const sig = c.req.query('s');
    const signed = sig !== undefined && verifyPhotoUrl(kc.keyring, id.data, Number(c.req.query('e')), sig);
    if (!served.approved && !signed) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    // Only approved (public, immutable) photos use the cache; previews and errors always go to Storage.
    const cache = served.approved ? (deps.photoCache ?? null) : null;
    const w = Number(width.data);
    let bytes = cache?.get(id.data, w) ?? null;
    if (!bytes) {
      bytes = await kc.storage.get(served.paths[w as ProductPhotoWidth]);
      if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      cache?.set(id.data, w, bytes);
    }
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': 'image/webp',
      'Content-Disposition': 'inline; filename="product.webp"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': served.approved ? 'public, max-age=31536000, immutable' : 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
  });

  return app
    .openapi(shopList, async (c) => {
      const kc = storageOf(deps);
      const r = await listProductPhotos(deps.db, { slug: c.req.valid('param').slug, actor: actorOf(c) });
      return c.json(
        {
          photos: r.photos.map((p) => toDto(p, kc)),
          max: PRODUCT_PHOTO_MAX,
          shopUploadsEnabled: r.shopUploadsEnabled,
        },
        200,
      );
    })
    .openapi(shopRemove, async (c) => {
      const p = c.req.valid('param');
      const keys = await removeProductPhoto(deps.db, {
        slug: p.slug,
        photoId: p.photoId,
        actor: actorOf(c),
      });
      deps.photoCache?.evict(p.photoId);
      if (deps.photoStorage) await deleteObjects(deps.photoStorage, keys);
      return c.json({ ok: true as const }, 200);
    });
}
