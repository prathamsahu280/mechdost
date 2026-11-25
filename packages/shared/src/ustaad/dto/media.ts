/**
 * Media DTOs (spec 23 § 10 step 2, SR-12, SR-15, SR-17). The declaration binds the upload to a kind, MIME type, size
 * and hash; the server signs exactly those and refuses anything else. SVG, HTML, archives and executables are not in
 * any kind's MIME list, so they never parse.
 */
import { z } from 'zod';
import {
  MEDIA_HARD_CAP_BYTES,
  MEDIA_KINDS,
  MEDIA_MIMES,
  MEDIA_VARIANTS,
  type UstaadMediaKind,
} from '../codes';

const ALL_MIMES = [...new Set(Object.values(MEDIA_MIMES).flat())] as [string, ...string[]];

export const DeclareMediaDto = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    mime: z.enum(ALL_MIMES),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(Math.max(...Object.values(MEDIA_HARD_CAP_BYTES))),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Container duration for video and audio, as measured on the phone (checked again from the file). */
    durationMs: z.number().int().min(1).max(600_000).optional(),
    width: z.number().int().min(1).max(10_000).optional(),
    height: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = MEDIA_MIMES[v.kind];
    if (!allowed.includes(v.mime)) ctx.addIssue({ code: 'custom', path: ['mime'], message: 'MEDIA_TYPE' });
    if ((v.kind === 'video' || v.kind === 'audio') && v.durationMs === undefined)
      ctx.addIssue({ code: 'custom', path: ['durationMs'], message: 'MEDIA_TOO_LONG' });
  });
export type DeclareMedia = z.infer<typeof DeclareMediaDto>;

export const CompleteMediaDto = z
  .object({
    /** Multipart only: the part numbers and ETags the host returned, in order. */
    parts: z
      .array(z.object({ partNo: z.number().int().min(1).max(32), etag: z.string().min(1).max(200) }).strict())
      .max(32)
      .optional(),
  })
  .strict();

export const MediaUrlQueryDto = z.object({ variant: z.enum(MEDIA_VARIANTS).optional() }).strict();

export interface DeclaredUpload {
  mediaId: string;
  /** Single PUT (≤ 16 MB): the URL and the headers the phone must send exactly. */
  put?: { url: string; headers: Record<string, string> };
  /** Resumable (> 16 MB): the upload id and the number of 8 MB parts; part URLs via `POST …/{id}/parts`. */
  multipart?: { uploadId: string; parts: number; partBytes: number };
  expiresAt: string;
}

export const isMediaKind = (v: string): v is UstaadMediaKind =>
  (MEDIA_KINDS as readonly string[]).includes(v);
