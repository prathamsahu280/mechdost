import { ChoicesViewDto, MeResponseDto } from '@mechdost/shared/ustaad/dto/members';
import { ApplicantsResponseDto, JobDto } from '@mechdost/shared/ustaad/dto/local';
import { AppealFiledDto, StandingDto } from '@mechdost/shared/ustaad/dto/moderation';
import { LearnViewDto, QuestionDetailDto } from '@mechdost/shared/ustaad/dto/qa';
import {
  AnsweredResponse as Answered,
  AppliedResponse as Applied,
  AskedResponse as Asked,
  DeclaredUploadResponse as Declared,
  HelpfulResponse as Voted,
  JobsResponse as Jobs,
  LearnProgressResponse as Progress,
  MovedResponse as Moved,
  MyLocationResponse as LocationOut,
  OkResponse as Ok,
  QuestionListResponse as QuestionList,
  SignedUrlResponse as Signed,
  SolvedResponse as Solved,
  VerifiedMediaResponse as Verified,
  ZonesResponse as Zones,
} from '@mechdost/shared/ustaad/dto/responses';
import {
  NoContentDto as NoBody,
  SaveCollectionDto,
  SavedPageDto,
  SavedSummaryDto,
  SaveStateDto,
} from '@mechdost/shared/ustaad/dto/saved';
import { authed, type ApiResult, type Schema } from '../orders-api';
import { baseMime } from './media-core';
import { track } from '../analytics';
import type { UstaadClient } from './client';

/**
 * The real Ustaad client (spec 23 § 8): every call is signed in and every answer is checked with the shared schemas.
 * Loaded only on real-sign-in builds (`client.ts`).
 */
const map = <A, B>(r: ApiResult<A>, f: (a: A) => B): ApiResult<B> =>
  r.ok ? { ok: true, data: f(r.data) } : r;

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT with upload progress (fetch has none); the exact headers the API signed. */
function put(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress: (pct: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      resolve(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = () => {
      resolve(false);
    };
    xhr.send(file);
  });
}

export function apiUstaadClient(locale: string): UstaadClient {
  const get = <T>(path: string, schema: Schema<T>) => authed(locale, path, schema);
  const send = <T>(
    path: string,
    schema: Schema<T>,
    body: unknown,
    method: 'POST' | 'PUT' | 'PATCH' = 'POST',
  ) => authed(locale, path, schema, { method, body });
  const enc = encodeURIComponent;
  return {
    sample: false,
    me: () => get('/ustaad/me', MeResponseDto),
    questions: (filter, cursor) =>
      get(
        `/ustaad/questions?filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        QuestionList,
      ),
    question: (code) => get(`/ustaad/questions/${encodeURIComponent(code)}`, QuestionDetailDto),
    ask: async (input) => map(await send('/ustaad/questions', Asked, input), (d) => ({ code: d.code })),
    answer: async (code, input) =>
      map(await send(`/ustaad/questions/${encodeURIComponent(code)}/answers`, Answered, input), (d) => ({
        id: d.id,
      })),
    helpful: (id) => send(`/ustaad/answers/${id}/helpful`, Voted, {}),
    best: (code, answerId) =>
      send(`/ustaad/questions/${encodeURIComponent(code)}/best`, Solved, { answerId }),
    learn: () => get('/ustaad/learn', LearnViewDto),
    progress: (id, body) => send(`/ustaad/learn/${id}/progress`, Progress, body, 'PUT'),
    myLocation: async () => map(await get('/ustaad/me/location', LocationOut), (d) => d.location),
    saveLocation: async (input) => {
      const r = await send('/ustaad/me/location', LocationOut, input, 'PUT');
      if (!r.ok) return r;
      return r.data.location
        ? { ok: true, data: r.data.location }
        : { ok: false, status: 500, code: 'BAD_RESPONSE' };
    },
    signboard: (mediaId) => send('/ustaad/me/location/signboard', Ok, { mediaId }),
    zones: async () => map(await get('/ustaad/zones', Zones), (d) => d.zones),
    jobs: (role, cursor) => {
      const q = new URLSearchParams();
      if (role) q.set('role', role);
      if (cursor) q.set('cursor', cursor);
      const qs = q.toString();
      return get(`/ustaad/jobs${qs ? `?${qs}` : ''}`, Jobs);
    },
    job: (code) => get(`/ustaad/jobs/${encodeURIComponent(code)}`, JobDto),
    postJob: (input) => send('/ustaad/jobs', JobDto, input),
    apply: (code, body) => send(`/ustaad/jobs/${encodeURIComponent(code)}/apply`, Applied, body),
    moveJob: (code, action) => send(`/ustaad/jobs/${encodeURIComponent(code)}/${action}`, Moved, {}),
    choices: () => get('/ustaad/me/choices', ChoicesViewDto),
    saveChoices: (body) => send('/ustaad/me/choices', ChoicesViewDto, body, 'PUT'),
    standing: () => get('/ustaad/me/standing', StandingDto),
    fileAppeal: (reportCode, note) => send('/ustaad/me/appeals', AppealFiledDto, { reportCode, note }),
    applicants: (code, cursor) =>
      get(
        `/ustaad/jobs/${encodeURIComponent(code)}/applications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        ApplicantsResponseDto,
      ),
    moveApplication: (id, action) =>
      send(`/ustaad/applications/${encodeURIComponent(id)}/${action}`, Moved, {}),
    upload: async (file, meta, onProgress) => {
      const declared = await send('/ustaad/media', Declared, {
        kind: meta.kind,
        mime: baseMime(meta.mime),
        bytes: file.size,
        sha256: await sha256Hex(file),
        ...(meta.durationMs === undefined ? {} : { durationMs: meta.durationMs }),
        ...(meta.width === undefined ? {} : { width: meta.width, height: meta.height }),
        ...(meta.summary ? { summary: meta.summary } : {}),
        ...(meta.captions ? { captions: meta.captions } : {}),
      });
      if (declared.ok && (meta.kind === 'audio' || meta.kind === 'video') && (meta.summary || meta.captions))
        track('ustaad_media_text_added', {
          kind: meta.kind,
          summary: Boolean(meta.summary),
          captions: Boolean(meta.captions),
        });
      if (!declared.ok) return declared;
      // Voice notes and phone photos stay far under the 16 MB single-PUT limit; multipart is the feed's (D) path.
      if (!declared.data.put) return { ok: false, status: 0, code: 'MEDIA_TOO_LARGE' };
      onProgress(0);
      const sent = await put(declared.data.put.url, declared.data.put.headers, file, onProgress);
      if (!sent) return { ok: false, status: 0, code: 'NETWORK' };
      const verified = await send(`/ustaad/media/${declared.data.mediaId}/complete`, Verified, {});
      return map(verified, () => ({ mediaId: declared.data.mediaId }));
    },
    mediaUrl: async (id) => map(await get(`/ustaad/media/${id}/url`, Signed), (d) => ({ url: d.url })),
    savedList: (f) => {
      const q = new URLSearchParams();
      if (f.kind) q.set('kind', f.kind);
      if (f.collectionId) q.set('collectionId', f.collectionId);
      if (f.q) q.set('q', f.q);
      if (f.cursor) q.set('cursor', f.cursor);
      const s = q.toString();
      return get(`/ustaad/saves${s ? `?${s}` : ''}`, SavedPageDto);
    },
    savedSummary: () => get('/ustaad/saves/summary', SavedSummaryDto),
    setSaved: (kind, id, on) =>
      authed(locale, `/ustaad/saves/${kind}/${enc(id)}`, SaveStateDto, { method: on ? 'PUT' : 'DELETE' }),
    createCollection: (name) => send('/ustaad/save-collections', SaveCollectionDto, { name }),
    renameCollection: (id, name, version) =>
      send(`/ustaad/save-collections/${enc(id)}`, SaveCollectionDto, { name, version }, 'PATCH'),
    deleteCollection: (id) =>
      authed(locale, `/ustaad/save-collections/${enc(id)}`, NoBody, { method: 'DELETE' }),
    setInCollection: (id, t, on) =>
      authed(locale, `/ustaad/save-collections/${enc(id)}/items/${t.kind}/${enc(t.id)}`, NoBody, {
        method: on ? 'PUT' : 'DELETE',
      }),
  };
}
