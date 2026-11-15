import { randomUUID, createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  cityScopeFrom,
  findMediaForServing,
  listPhotosForCustomer,
  listPhotosForStaff,
  listPhotosForWorkshop,
  listWorkshopGallery,
  prepareServicePhoto,
  removeServicePhoto,
  saveServicePhoto,
  workshopIdsFrom,
  type GalleryPhoto,
  type PhotoRow,
  type PhotoSettings,
} from '@mechdost/db/repo';
import {
  PHOTO_MAX_BYTES,
  PHOTO_UPLOAD_WINDOW_SECONDS,
  PHOTO_UPLOADS_PER_WINDOW,
  PhotoRemovedDto,
  PhotoStageSchema,
  PublicGalleryDto,
  ServicePhotosDto,
} from '@mechdost/shared/service-photos';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, errorBody } from '../errors';
import { log } from '../logger';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { processPhoto } from '../photos/image';
import { signPhotoUrl, verifyPhotoUrl } from '../photos/url-token';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { json, RequestCode } from './service-schemas';

/**
 * Job photos (spec 06 "Job photos", spec 13 "Uploads", design 2026-11-15).
 * - Workshop (`service:work`, own workshops only): upload (multipart, <= 8 MB, streamed against the limit), list,
 *   remove until the bill. The image is checked by its first bytes, decoded, auto-rotated and re-encoded as WebP
 *   (metadata gone), stored under random keys in a private bucket, then recorded with the status and limit checked
 *   again under the request lock.
 * - Customer (own requests) and staff (city scope) list. The listing carries short-lived image URLs (10 minutes, one
 *   photo each); the image route re-checks the signature on every read. No Storage URL or key ever leaves the server.
 * - Public: the workshop page's gallery, only while the admin setting is on and only for completed jobs.
 */
export const PHOTO_UPLOAD_RATE: RateRule = {
  name: 'photo_upload_user',
  limit: PHOTO_UPLOADS_PER_WINDOW,
  windowSeconds: PHOTO_UPLOAD_WINDOW_SECONDS,
};
export const PHOTO_READ_RATE: RateRule = { name: 'photo_read_ip', limit: 600, windowSeconds: 60 };
const GALLERY_RATE: RateRule = { name: 'photo_gallery_ip', limit: 120, windowSeconds: 60 };

/** Multipart framing adds a little to the file itself. */
const UPLOAD_BODY_MAX = PHOTO_MAX_BYTES + 64 * 1024;

const sec = [{ bearerAuth: [] }];
const MediaId = z.uuid().openapi({ param: { name: 'mediaId', in: 'path' } });
const Variant = z.enum(['thumb', 'large']).openapi({ param: { name: 'variant', in: 'path' } });
const PhotoId = z.uuid().openapi({ param: { name: 'photoId', in: 'path' } });
const Slug = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9-]+$/)
  .openapi({ param: { name: 'slug', in: 'path' } });

const code = { params: z.object({ code: RequestCode }) };

const wsList = createRoute({
  method: 'get',
  path: '/workshop/requests/{code}/photos',
  tags: ['workshop'],
  summary: "A job's before and after photos (your workshop's requests only)",
  security: sec,
  request: code,
  responses: { 200: json(ServicePhotosDto, 'Photos'), ...errorResponses },
});
const wsRemove = createRoute({
  method: 'delete',
  path: '/workshop/requests/{code}/photos/{photoId}',
  tags: ['workshop'],
  summary: 'Remove a photo until the job is billed (audited)',
  security: sec,
  request: { params: z.object({ code: RequestCode, photoId: PhotoId }) },
  responses: { 200: json(PhotoRemovedDto, 'Removed'), ...errorResponses },
});
const customerList = createRoute({
  method: 'get',
  path: '/service-requests/{code}/photos',
  tags: ['services'],
  summary: 'The before and after photos of your own request',
  security: sec,
  request: code,
  responses: { 200: json(ServicePhotosDto, 'Photos'), ...errorResponses },
});
const staffList = createRoute({
  method: 'get',
  path: '/admin/service-requests/{code}/photos',
  tags: ['admin'],
  summary: 'The photos of a request in your city scope',
  security: sec,
  request: code,
  responses: { 200: json(ServicePhotosDto, 'Photos'), ...errorResponses },
});
const gallery = createRoute({
  method: 'get',
  path: '/workshops/{slug}/photos',
  tags: ['workshops'],
  summary:
    "Recent completed jobs' photos for the workshop page; empty and disabled unless the admin turned it on",
  request: { params: z.object({ slug: Slug }) },
  responses: { 200: json(PublicGalleryDto, 'Gallery'), ...errorResponses },
});

export function servicePhotoRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const user = (c: Context<AppEnv>) => c.get('auth').user.id;
  const keyring = () => {
    if (!deps.keyring || !deps.photoStorage)
      throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
    return { keyring: deps.keyring, storage: deps.photoStorage };
  };

  // Workshop and staff and customer paths: sign-in, a per-user limit, verification and the permission, in that order.
  for (const pattern of ['/workshop/requests/*', '/admin/service-requests/*', '/service-requests/*']) {
    app.use(pattern, authenticate(deps, cache));
    app.use(
      pattern,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  app.use(
    '/workshops/:slug/photos',
    rateLimit(deps.rateLimiter, GALLERY_RATE, (c) => c.get('clientIp')),
  );
  app.use('/workshop/requests/*', requireVerified);
  app.use('/admin/service-requests/*', requireVerified);
  app.on('GET', '/workshop/requests/:code/photos', requirePermission('service:read'));
  app.on('DELETE', '/workshop/requests/:code/photos/:photoId', requirePermission('service:work'));
  app.on('POST', '/workshop/requests/:code/photos', requirePermission('service:work'));
  app.on('GET', '/admin/service-requests/:code/photos', requirePermission('service:read'));

  const urls = (mediaId: string, kc: ReturnType<typeof keyring>) => {
    const { exp, sig } = signPhotoUrl(kc.keyring, mediaId);
    const q = `?e=${String(exp)}&s=${sig}`;
    return {
      thumbUrl: `/service-photos/${mediaId}/thumb${q}`,
      largeUrl: `/service-photos/${mediaId}/large${q}`,
    };
  };
  const toDto = (p: PhotoRow, kc: ReturnType<typeof keyring>) => ({
    id: p.id,
    stage: p.stage,
    caption: p.caption,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    ...urls(p.mediaId, kc),
  });
  const listBody = (r: { photos: PhotoRow[]; settings: PhotoSettings }) => {
    const kc = keyring();
    return {
      photos: r.photos.map((p) => toDto(p, kc)),
      required: r.settings.required,
      maxPerStage: r.settings.maxPerStage,
    };
  };

  // Upload: not an OpenAPI route (multipart with a file part: `file` + `stage`). Its own, larger body limit; the global
  // 1 MB limit skips this path (middleware/security.ts).
  app.post(
    '/workshop/requests/:code/photos',
    rateLimit(deps.rateLimiter, PHOTO_UPLOAD_RATE, (c) => c.get('auth').user.id),
    bodyLimit({
      maxSize: UPLOAD_BODY_MAX,
      onError: (c) => c.json(errorBody(c, 'PHOTO_TOO_LARGE', 'The photo is bigger than 8 MB'), 413),
    }),
    async (c) => {
      const kc = keyring();
      const parsedCode = RequestCode.safeParse(c.req.param('code'));
      if (!parsedCode.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data'))
        throw new ApiError(422, 'PHOTO_TYPE', 'Send the photo as a form upload');
      const form = await c.req.parseBody();
      const stage = PhotoStageSchema.safeParse(form.stage);
      const file = form.file;
      if (!stage.success || !(file instanceof File))
        throw new ApiError(422, 'PHOTO_TYPE', 'Send a stage (before or after) and a photo');
      if (file.size > PHOTO_MAX_BYTES)
        throw new ApiError(413, 'PHOTO_TOO_LARGE', 'The photo is bigger than 8 MB');
      const input = {
        workshopIds: workshopIdsFrom(c.get('auth').grants, 'service:work'),
        code: parsedCode.data,
        stage: stage.data,
      };
      // Rights, status window and limit before any image work (404 for another workshop's code).
      const target = await prepareServicePhoto(deps.db, input);
      const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));

      const mediaId = randomUUID();
      const path = `job/${target.requestId}/${mediaId}.webp`;
      const thumbPath = `job/${target.requestId}/${mediaId}-thumb.webp`;
      const cleanup = async () => {
        await Promise.allSettled([kc.storage.remove(path), kc.storage.remove(thumbPath)]);
      };
      try {
        await kc.storage.put(path, processed.large);
        await kc.storage.put(thumbPath, processed.thumb);
      } catch (err) {
        log('error', 'photo_storage_failed', {
          op: 'put',
          message: err instanceof Error ? err.message : 'unknown',
        });
        await cleanup();
        throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
      }
      try {
        const row = await saveServicePhoto(deps.db, {
          ...input,
          staffUserId: user(c),
          image: {
            mediaId,
            bucket: kc.storage.bucket,
            path,
            thumbPath,
            width: processed.width,
            height: processed.height,
            bytes: processed.large.length,
            thumbBytes: processed.thumb.length,
            sha256: createHash('sha256').update(processed.large).digest('hex'),
          },
        });
        return c.json({ photo: toDto(row, kc) }, 201);
      } catch (err) {
        await cleanup();
        throw err;
      }
    },
  );

  // The image route: signed (10 minutes, one photo) or public-gallery; anything else is 404, never a hint why.
  app.get(
    '/service-photos/:mediaId/:variant',
    rateLimit(deps.rateLimiter, PHOTO_READ_RATE, (c) => c.get('clientIp')),
    async (c) => {
      const kc = keyring();
      const mediaId = MediaId.safeParse(c.req.param('mediaId'));
      const variant = Variant.safeParse(c.req.param('variant'));
      if (!mediaId.success || !variant.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const media = await findMediaForServing(deps.db, mediaId.data);
      if (!media) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const exp = Number(c.req.query('e'));
      const sig = c.req.query('s');
      const signed = sig !== undefined && verifyPhotoUrl(kc.keyring, mediaId.data, exp, sig);
      if (!signed && !media.publicNow) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const bytes = await kc.storage.get(variant.data === 'thumb' ? media.thumbPath : media.path);
      if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline; filename="photo.webp"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
        // The website is on another origin of the same site; the URL itself is the capability.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    },
  );

  return app
    .openapi(wsList, async (c) => {
      const r = await listPhotosForWorkshop(
        deps.db,
        workshopIdsFrom(c.get('auth').grants, 'service:read'),
        c.req.valid('param').code,
      );
      return c.json(listBody(r), 200);
    })
    .openapi(wsRemove, async (c) => {
      const p = c.req.valid('param');
      await removeServicePhoto(deps.db, {
        workshopIds: workshopIdsFrom(c.get('auth').grants, 'service:work'),
        code: p.code,
        photoId: p.photoId,
        staffUserId: user(c),
      });
      return c.json({ ok: true }, 200);
    })
    .openapi(customerList, async (c) => {
      const r = await listPhotosForCustomer(deps.db, user(c), c.req.valid('param').code);
      return c.json(listBody(r), 200);
    })
    .openapi(staffList, async (c) => {
      const r = await listPhotosForStaff(
        deps.db,
        cityScopeFrom(c.get('auth').grants, 'service:read'),
        c.req.valid('param').code,
      );
      return c.json(listBody(r), 200);
    })
    .openapi(gallery, async (c) => {
      const g = await listWorkshopGallery(deps.db, c.req.valid('param').slug);
      const photos = g.photos.map((p: GalleryPhoto) => ({
        id: p.id,
        stage: p.stage,
        width: p.width,
        height: p.height,
        // No token: the image route re-checks the public setting and the job's status on every read.
        thumbUrl: `/service-photos/${p.mediaId}/thumb`,
        largeUrl: `/service-photos/${p.mediaId}/large`,
      }));
      c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return c.json({ enabled: g.enabled, photos }, 200);
    });
}
