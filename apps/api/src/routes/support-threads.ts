import { createHash, randomUUID } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  assertCanAttach,
  cityScopeFrom,
  createRefundFromTicket,
  customerReplyTicket,
  findTicketMediaForServing,
  openSupportThread,
  saveTicketRefundDestination,
  ticketScopeFrom,
  type StoredImage,
  type TicketView,
  uuidv7,
} from '@mechdost/db/repo';
import { AdminRefundDto } from '@mechdost/shared/refunds-api';
import { SERVICE_CODE_RE } from '@mechdost/shared/service-requests';
import {
  SaveDestinationBody,
  SUPPORT_ATTACH_BYTES,
  SUPPORT_ATTACH_MAX,
  SUPPORT_DESTINATIONS_PER_HOUR,
  SUPPORT_THREADS_PER_HOUR,
  SUPPORT_UPLOAD_WINDOW_SECONDS,
  SUPPORT_UPLOADS_PER_WINDOW,
  SupportDestination,
  SupportIssueCode,
  SupportThreadOpened,
  TicketRefundBody,
} from '@mechdost/shared/support-thread';
import { TICKET_STATES } from '@mechdost/shared/state';
import { ApiError, errorBody } from '../errors';
import { log } from '../logger';
import { enforceRate, rateLimit } from '../middleware/rate-limit';
import { processPhoto } from '../photos/image';
import type { PhotoStorage } from '../photos/storage';
import { signPhotoUrl, verifyPhotoUrl } from '../photos/url-token';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Order and request threads with MechDost support, photo attachments and the COD refund destination (design
 * 2026-11-15, items 1 to 3; spec 09, spec 13 "Uploads"). Mounted inside `supportRoutes`, which already applies sign-in,
 * the per-user limit and the `tickets:create` / `tickets:read` / `tickets:reply` guards to `/support/*` and
 * `/admin/support/*` (one middleware stack per prefix, learning L171); the image route is deliberately outside them
 * (`/support-photos/*`: the signed URL is the capability, exactly like job photos).
 *
 * Attachments go through the one upload pipeline (`photos/image.ts`): bytes decide the type, EXIF is stripped by the
 * re-encode, objects get random keys in the private bucket. Customers see MechDost support only; nothing here returns
 * a shop's or workshop's contact data.
 */
export const THREAD_OPEN_RATE: RateRule = {
  name: 'support_thread_user',
  limit: SUPPORT_THREADS_PER_HOUR,
  windowSeconds: 3600,
};
export const SUPPORT_UPLOAD_RATE: RateRule = {
  name: 'support_upload_user',
  limit: SUPPORT_UPLOADS_PER_WINDOW,
  windowSeconds: SUPPORT_UPLOAD_WINDOW_SECONDS,
};
export const DESTINATION_RATE: RateRule = {
  name: 'support_destination_user',
  limit: SUPPORT_DESTINATIONS_PER_HOUR,
  windowSeconds: 3600,
};
const IMAGE_RATE: RateRule = { name: 'support_photo_read_ip', limit: 600, windowSeconds: 60 };

/** Four photos of 8 MB each plus multipart framing and the text fields. */
export const THREAD_UPLOAD_BODY_MAX = SUPPORT_ATTACH_MAX * SUPPORT_ATTACH_BYTES + 256 * 1024;

const Code = z
  .string()
  .regex(/^REQ-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'REQ-RPR-2026-7K3Q9X' });
const OrderCode = z.string().regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
const MediaId = z.uuid();
const Variant = z.enum(['thumb', 'large']);
const BodyText = z.string().trim().min(1).max(2000);
const IdempotencyHeader = z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,56}$/) });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const sec = [{ bearerAuth: [] }];

const saveDestination = createRoute({
  method: 'put',
  path: '/support/tickets/{code}/refund-destination',
  tags: ['support'],
  summary: 'Give a UPI id or bank account for a cash on delivery refund (stored encrypted, shown masked)',
  security: sec,
  request: {
    params: z.object({ code: Code }),
    body: { required: true, content: { 'application/json': { schema: SaveDestinationBody } } },
  },
  responses: {
    200: json(z.object({ destination: SupportDestination }), 'Saved'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'Closed, or a refund was already requested'),
    422: json(ErrorSchema, 'Not a cash on delivery order, or invalid details'),
    ...errorResponses,
  },
});

const refundFromTicket = createRoute({
  method: 'post',
  path: '/admin/support/tickets/{code}/refund',
  tags: ['admin'],
  summary: 'Ask finance for the manual refund of a cash on delivery order, from the ticket (needs approval)',
  security: sec,
  request: {
    params: z.object({ code: Code }),
    headers: IdempotencyHeader,
    body: { required: true, content: { 'application/json': { schema: TicketRefundBody } } },
  },
  responses: {
    201: json(AdminRefundDto, 'Requested'),
    200: json(AdminRefundDto, 'Replay of an earlier request with the same key'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'Not allowed now'),
    422: json(ErrorSchema, 'The customer has not given a destination'),
    ...errorResponses,
  },
});

interface Kit {
  keyring: NonNullable<AppDeps['keyring']>;
  storage: PhotoStorage;
}

export function supportThreadRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const user = (c: Context<AppEnv>) => c.get('auth').user.id;
  const kit = (): Kit => {
    if (!deps.keyring || !deps.photoStorage)
      throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
    return { keyring: deps.keyring, storage: deps.photoStorage };
  };
  /** The files of a multipart form: `file` once or many times, at most the limit, each within the size limit. */
  const filesOf = (value: unknown): File[] => {
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const files = list.filter((v): v is File => v instanceof File);
    if (files.length !== list.length) throw new ApiError(422, 'PHOTO_TYPE', 'Send photos as file uploads');
    if (files.length > SUPPORT_ATTACH_MAX)
      throw new ApiError(422, 'ATTACHMENT_LIMIT', `Up to ${String(SUPPORT_ATTACH_MAX)} photos per message`);
    if (files.some((f) => f.size > SUPPORT_ATTACH_BYTES))
      throw new ApiError(413, 'PHOTO_TOO_LARGE', 'A photo is bigger than 8 MB');
    return files;
  };

  /** Decode and store every file (random keys, private bucket); on any failure the stored ones are removed again. */
  const storeAll = async (
    files: File[],
    k: Kit,
  ): Promise<{ images: StoredImage[]; cleanup: () => Promise<void> }> => {
    const keys: string[] = [];
    const cleanup = async () => {
      await Promise.allSettled(keys.map((key) => k.storage.remove(key)));
    };
    const images: StoredImage[] = [];
    try {
      for (const file of files) {
        const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
        const mediaId = uuidv7();
        const folder = randomUUID();
        const path = `ticket/${folder}/${mediaId}.webp`;
        const thumbPath = `ticket/${folder}/${mediaId}-thumb.webp`;
        try {
          keys.push(path, thumbPath);
          await k.storage.put(path, processed.large);
          await k.storage.put(thumbPath, processed.thumb);
        } catch (err) {
          log('error', 'photo_storage_failed', {
            op: 'put',
            message: err instanceof Error ? err.message : 'unknown',
          });
          throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
        }
        images.push({
          mediaId,
          bucket: k.storage.bucket,
          path,
          thumbPath,
          width: processed.width,
          height: processed.height,
          bytes: processed.large.length,
          thumbBytes: processed.thumb.length,
          sha256: createHash('sha256').update(processed.large).digest('hex'),
        });
      }
    } catch (err) {
      await cleanup();
      throw err;
    }
    return { images, cleanup };
  };

  const tooLarge = bodyLimit({
    maxSize: THREAD_UPLOAD_BODY_MAX,
    onError: (c) => c.json(errorBody(c, 'PHOTO_TOO_LARGE', 'The photos are too big'), 413),
  });
  const isMultipart = (c: Context<AppEnv>) =>
    (c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data');

  // Open (or continue) the one thread of an order or service job. Multipart: issueCode, orderCode | serviceCode, body,
  // file x 0..4. Not an OpenAPI route (file parts); its own, larger body limit (the global one skips this path).
  app.post(
    '/support/threads',
    rateLimit(deps.rateLimiter, THREAD_OPEN_RATE, (c) => user(c)),
    tooLarge,
    async (c) => {
      if (!isMultipart(c)) throw new ApiError(422, 'PHOTO_TYPE', 'Send the request as a form');
      const form = await c.req.parseBody({ all: true });
      const issue = SupportIssueCode.safeParse(form.issueCode);
      const text = BodyText.safeParse(form.body);
      const order =
        form.orderCode === undefined || form.orderCode === '' ? null : OrderCode.safeParse(form.orderCode);
      const service =
        form.serviceCode === undefined || form.serviceCode === ''
          ? null
          : z.string().regex(SERVICE_CODE_RE).safeParse(form.serviceCode);
      if (!issue.success || !text.success || (order && !order.success) || (service && !service.success))
        throw new ApiError(400, 'VALIDATION_ERROR', 'Check the issue, the order and the message');
      const files = filesOf(form.file);
      let stored: Awaited<ReturnType<typeof storeAll>> | null = null;
      if (files.length > 0) {
        // The photo window counts the whole upload once, however many files it carries.
        await enforceRate(c, deps.rateLimiter, SUPPORT_UPLOAD_RATE, user(c));
        stored = await storeAll(files, kit());
      }
      try {
        const result = await openSupportThread(deps.db, {
          userId: user(c),
          issueCode: issue.data,
          orderCode: order?.success ? order.data : null,
          serviceCode: service?.success ? service.data : null,
          body: text.data,
          images: stored?.images,
          defaultCityCode: deps.config.defaultCityCode,
        });
        return c.json(SupportThreadOpened.parse(result), result.reopened ? 200 : 201);
      } catch (err) {
        await stored?.cleanup();
        throw err;
      }
    },
  );

  // A message with photos on one of the customer's own requests.
  app.post(
    '/support/tickets/:code/photo-messages',
    rateLimit(deps.rateLimiter, SUPPORT_UPLOAD_RATE, (c) => user(c)),
    tooLarge,
    async (c) => {
      const code = Code.safeParse(c.req.param('code'));
      if (!code.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      if (!isMultipart(c)) throw new ApiError(422, 'PHOTO_TYPE', 'Send the message as a form');
      const form = await c.req.parseBody({ all: true });
      const text = BodyText.safeParse(form.body);
      if (!text.success)
        throw new ApiError(400, 'VALIDATION_ERROR', 'Write a message of up to 2000 characters');
      const files = filesOf(form.file);
      if (files.length === 0) throw new ApiError(422, 'PHOTO_TYPE', 'Add at least one photo');
      const k = kit();
      // Rights and state before any image work (404 for another customer's request).
      await assertCanAttach(deps.db, user(c), code.data);
      const stored = await storeAll(files, k);
      try {
        const result = await customerReplyTicket(deps.db, {
          userId: user(c),
          code: code.data,
          body: text.data,
          images: stored.images,
        });
        return c.json({ status: z.enum(TICKET_STATES).parse(result.status) }, 200);
      } catch (err) {
        await stored.cleanup();
        throw err;
      }
    },
  );

  // The image route: signed (10 minutes, one photo); anything else is 404, never a hint why.
  app.get(
    '/support-photos/:mediaId/:variant',
    rateLimit(deps.rateLimiter, IMAGE_RATE, (c) => c.get('clientIp')),
    async (c) => {
      const k = kit();
      const mediaId = MediaId.safeParse(c.req.param('mediaId'));
      const variant = Variant.safeParse(c.req.param('variant'));
      if (!mediaId.success || !variant.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const exp = Number(c.req.query('e'));
      const sig = c.req.query('s');
      if (sig === undefined || !verifyPhotoUrl(k.keyring, mediaId.data, exp, sig))
        throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const media = await findTicketMediaForServing(deps.db, mediaId.data);
      if (!media) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const bytes = await k.storage.get(variant.data === 'thumb' ? media.thumbPath : media.path);
      if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline; filename="photo.webp"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    },
  );

  app.use(
    '/support/tickets/:code/refund-destination',
    rateLimit(deps.rateLimiter, DESTINATION_RATE, (c) => user(c)),
  );

  return app
    .openapi(saveDestination, async (c) => {
      if (!deps.keyring)
        throw new ApiError(503, 'ENCRYPTION_UNAVAILABLE', 'Payout details cannot be stored right now');
      const destination = await saveTicketRefundDestination(deps.db, {
        userId: user(c),
        code: c.req.valid('param').code,
        destination: c.req.valid('json'),
        keyring: deps.keyring,
      });
      return c.json({ destination }, 200);
    })
    .openapi(refundFromTicket, async (c) => {
      if (!deps.keyring)
        throw new ApiError(503, 'ENCRYPTION_UNAVAILABLE', 'Payout details cannot be stored right now');
      const b = c.req.valid('json');
      const grants = c.get('auth').grants;
      const made = await createRefundFromTicket(deps.db, {
        ticketScope: ticketScopeFrom(grants, 'tickets:reply'),
        refundScope: cityScopeFrom(grants, 'refunds:initiate'),
        staffUserId: user(c),
        code: c.req.valid('param').code,
        amountPaise: b.amountPaise,
        reasonCode: b.reasonCode,
        note: b.note,
        idempotencyKey: c.req.valid('header')['idempotency-key'],
        keyring: deps.keyring,
      });
      return c.json(made.refund, made.replay ? 200 : 201);
    });
}

/** Short-lived signed URLs of one photo (10 minutes; the same rule and key as job photos). */
function signAttachment(keyring: NonNullable<AppDeps['keyring']>, mediaId: string) {
  const { exp, sig } = signPhotoUrl(keyring, mediaId);
  const q = `?e=${String(exp)}&s=${sig}`;
  return {
    thumbUrl: `/support-photos/${mediaId}/thumb${q}`,
    largeUrl: `/support-photos/${mediaId}/large${q}`,
  };
}

/** One ticket's JSON with its photos as short-lived URLs (the thread of a customer or of staff). */
export function withAttachmentUrls(t: TicketView, keyring: AppDeps['keyring']) {
  return {
    ...t,
    slaAckDue: t.slaAckDue.toISOString(),
    slaResolveDue: t.slaResolveDue.toISOString(),
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    deletionConfirmedAt: t.deletionConfirmedAt ? t.deletionConfirmedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    messages: t.messages.map(({ attachments, ...m }) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      attachments: attachments.flatMap((a) => {
        return keyring
          ? [{ id: a.mediaId, width: a.width, height: a.height, ...signAttachment(keyring, a.mediaId) }]
          : [];
      }),
    })),
  };
}
