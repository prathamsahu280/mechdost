/**
 * Ustaad media routes (spec 23 § 8 "Media", § 10). Member routes behind the gate: declare (presigned upload, 10
 * minutes, bound to the member, kind, size and type; SR-12), more part URLs for a resumable upload (only up to the
 * declared size), complete (verify), and a signed read URL (≤ 10 minutes, windowed, after the read check; SR-21). No
 * media host configured → 503 MEDIA_UNAVAILABLE. Non-members never reach these (404 from the gate or the guard).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  declareUstaadMedia,
  pendingUstaadMediaOf,
  readableUstaadMedia,
  readUstaadSettingValues,
  setUstaadMediaUploadId,
  ustaadMediaVariantKey,
} from '@mechdost/db/repo';
import { MEDIA_PART_BYTES, MEDIA_SINGLE_PUT_MAX } from '@mechdost/shared/ustaad/codes';
import { CompleteMediaDto, DeclareMediaDto, MediaUrlQueryDto } from '@mechdost/shared/ustaad/dto/media';
import { ApiError } from '../../errors';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { readWindow, type MediaHost } from '../../ustaad/media/host';
import { completeAndVerify } from '../../ustaad/media/verify';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const UPLOAD_TTL_SEC = 600;
const Id = z.object({ id: z.uuid() });
const Declared = z
  .object({
    mediaId: z.uuid(),
    put: z
      .object({ url: z.string(), headers: z.record(z.string(), z.string()), method: z.literal('PUT') })
      .optional(),
    multipart: z
      .object({ uploadId: z.string(), parts: z.number().int(), partBytes: z.number().int() })
      .optional(),
    expiresAt: z.string(),
  })
  .openapi('UstaadDeclaredUpload');
const Verified = z
  .object({
    id: z.uuid(),
    kind: z.string(),
    status: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    durationMs: z.number().int().nullable(),
  })
  .openapi('UstaadMedia');

const declare = createRoute({
  method: 'post',
  path: '/ustaad/media',
  tags: ['ustaad'],
  summary:
    'Declare an upload (kind, MIME type, bytes, sha256, duration) and get a presigned upload valid 10 minutes',
  security: [{ bearerAuth: [] }],
  request: { body: body(DeclareMediaDto) },
  responses: { 201: json(Declared, 'Upload URL(s)'), ...conflict, ...errorResponses },
});
const parts = createRoute({
  method: 'post',
  path: '/ustaad/media/{id}/parts',
  tags: ['ustaad'],
  summary: 'Signed URLs for parts of a resumable upload (only parts within the declared size)',
  security: [{ bearerAuth: [] }],
  request: {
    params: Id,
    body: body(z.object({ partNos: z.array(z.number().int().min(1).max(32)).min(1).max(32) }).strict()),
  },
  responses: {
    200: json(
      z.object({
        parts: z.array(
          z.object({ partNo: z.number().int(), url: z.string(), headers: z.record(z.string(), z.string()) }),
        ),
      }),
      'Part URLs',
    ),
    ...errorResponses,
  },
});
const complete = createRoute({
  method: 'post',
  path: '/ustaad/media/{id}/complete',
  tags: ['ustaad'],
  summary: 'Finish an upload: size, type, magic bytes, duration and metadata checks; verified or rejected',
  security: [{ bearerAuth: [] }],
  request: { params: Id, body: body(CompleteMediaDto) },
  responses: { 200: json(Verified, 'Verified'), ...conflict, ...errorResponses },
});
const url = createRoute({
  method: 'get',
  path: '/ustaad/media/{id}/url',
  tags: ['ustaad'],
  summary: 'A signed read URL (≤ 10 minutes) for media the member may see',
  security: [{ bearerAuth: [] }],
  request: { params: Id, query: MediaUrlQueryDto },
  responses: {
    200: json(z.object({ url: z.string(), expiresAt: z.string() }), 'Signed URL'),
    ...errorResponses,
  },
});

export function ustaadMediaRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const member = (c: Context<AppEnv>) => {
    const m = c.get('ustaadMember');
    if (!m) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return m;
  };
  const hostOf = (): MediaHost => {
    if (!deps.mediaHost) throw new ApiError(503, 'MEDIA_UNAVAILABLE', 'Uploads are not available right now');
    return deps.mediaHost;
  };
  const memberKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  for (const path of ['/ustaad/media', '/ustaad/media/*']) app.use(path, requireUstaadMember(deps));
  app.on('POST', '/ustaad/media', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.mediaUploads, memberKey));
  app.on(
    'GET',
    '/ustaad/media/:id/url',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.mediaReadsPerIp, (c) => c.get('clientIp')),
  );

  return app
    .openapi(declare, async (c) => {
      const host = hostOf();
      const m = member(c);
      const b = c.req.valid('json');
      const expiresAt = new Date(Date.now() + UPLOAD_TTL_SEC * 1000);
      const row = await declareUstaadMedia(deps.db, {
        memberId: m.id,
        userId: c.get('auth').user.id,
        host: host.id,
        kind: b.kind,
        mime: b.mime,
        bytes: b.bytes,
        sha256: b.sha256,
        durationMs: b.durationMs ?? null,
        width: b.width ?? null,
        height: b.height ?? null,
        uploadExpiresAt: expiresAt,
        hostMaxBytes: host.maxFileBytes,
        // Spec 23 § 10a: the author's typed text alternative, fixed once declared (screened with the content).
        summary: b.summary ?? null,
        captions: b.captions ?? null,
      });
      if (host.supportsMultipart && b.bytes > MEDIA_SINGLE_PUT_MAX) {
        const { uploadId } = await host.createMultipart('quarantine', row.objectKey, b.mime);
        await setUstaadMediaUploadId(deps.db, row.id, uploadId);
        return c.json(
          {
            mediaId: row.id,
            multipart: {
              uploadId,
              parts: Math.ceil(b.bytes / MEDIA_PART_BYTES),
              partBytes: MEDIA_PART_BYTES,
            },
            expiresAt: expiresAt.toISOString(),
          },
          201,
        );
      }
      const put = await host.presignPut(
        'quarantine',
        row.objectKey,
        { mime: b.mime, bytes: b.bytes },
        UPLOAD_TTL_SEC,
      );
      return c.json({ mediaId: row.id, put, expiresAt: expiresAt.toISOString() }, 201);
    })
    .openapi(parts, async (c) => {
      const host = hostOf();
      const row = await pendingUstaadMediaOf(deps.db, {
        mediaId: c.req.valid('param').id,
        memberId: member(c).id,
      });
      if (!row.uploadId) throw new ApiError(409, 'MEDIA_SINGLE_PUT', 'This upload is a single file');
      const total = Math.ceil(row.declaredBytes / MEDIA_PART_BYTES);
      const out = [];
      for (const partNo of [...new Set(c.req.valid('json').partNos)]) {
        // Only parts inside the declared size; each signs its exact length, so the total can never exceed it.
        if (partNo > total) throw new ApiError(422, 'MEDIA_TOO_LARGE', 'More parts than the declared size');
        const bytes = partNo < total ? MEDIA_PART_BYTES : row.declaredBytes - MEDIA_PART_BYTES * (total - 1);
        const p = await host.presignPart(
          'quarantine',
          row.objectKey,
          row.uploadId,
          partNo,
          bytes,
          UPLOAD_TTL_SEC,
        );
        out.push({ partNo, ...p });
      }
      return c.json({ parts: out }, 200);
    })
    .openapi(complete, async (c) => {
      const host = hostOf();
      const b = c.req.valid('json');
      const v = await completeAndVerify(
        { db: deps.db, host, classifier: deps.safetyClassifier ?? null },
        { mediaId: c.req.valid('param').id, memberId: member(c).id, ...(b.parts ? { parts: b.parts } : {}) },
      );
      return c.json(
        {
          id: v.id,
          kind: v.kind,
          status: v.status,
          width: v.width,
          height: v.height,
          durationMs: v.durationMs,
        },
        200,
      );
    })
    .openapi(url, async (c) => {
      const host = hostOf();
      const row = await readableUstaadMedia(deps.db, {
        mediaId: c.req.valid('param').id,
        viewerMemberId: member(c).id,
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const variant = c.req.valid('query').variant;
      const key = (variant ? await ustaadMediaVariantKey(deps.db, row.id, variant) : null) ?? row.objectKey;
      const ttl =
        Math.min(
          Number(
            (await readUstaadSettingValues(deps.db, ['ustaad.media.url_ttl_min']))[
              'ustaad.media.url_ttl_min'
            ],
          ),
          10,
        ) * 60;
      const w = readWindow(Date.now(), ttl);
      const signed = await host.presignGet(row.bucket as 'media' | 'docs', key, w.expiresSec, {
        signAt: w.signAt,
        // PDFs are always a download from the docs host, never rendered inline (SR-16, AT-UP-6).
        ...(row.kind === 'document' ? { disposition: 'attachment' as const, filename: 'document.pdf' } : {}),
      });
      c.header('Cache-Control', 'private, no-store');
      return c.json({ url: signed, expiresAt: w.expiresAt.toISOString() }, 200);
    });
}
