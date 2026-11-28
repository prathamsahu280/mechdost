/**
 * Typed fixtures of the Mechanic Network composer and story viewer (spec 23 § 21i-L, batch H) for the API-mode audit.
 * Every body carries the shared schema the screen parses with (hard rule 4). Sample names only. No module-level
 * mutable state.
 *
 * Create `mode=post|story` (story = the address `?story=1`), `kind` (the tile the page set-up presses),
 * `result=idle|uploading|posted|held|daily-cap|links-locked|tag-unknown` (the page set-up fills a text, poll, link,
 * fix-log or tip post and sends it; `uploading` holds the file upload answer back 15 s; voice, video, PDF and
 * recorded media cannot be made in a headless browser, so those kinds show the composer without a send);
 * Story viewer `story=photo|voice|video|mine` (the page set-up presses the first ring) and `playback=running|paused`
 * (paused = the Auto next switch is pressed off).
 */
import { CorrectResponse } from '@mechdost/shared/ustaad/correction';
import { ComposeLimitsDto, type StoryRing } from '@mechdost/shared/ustaad/dto/feed';
import {
  CreatedResponse,
  DeclaredUploadResponse,
  SeenResponse,
  StoryCreatedResponse,
  StoryRingsResponse,
  TagsResponse,
  VerifiedMediaResponse,
} from '@mechdost/shared/ustaad/dto/responses';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { AUDIT_API_ORIGIN } from './session.ts';
import { get, iso, MEMBER, meMember, type Out, uuid } from './ustaad-member-fixtures.ts';
import { author, medium, ustaadFeedMocks } from './ustaad-social-fixtures.ts';

const REFUSED: Readonly<Record<string, string>> = {
  'daily-cap': 'USTAAD_DAILY_CAP',
  'links-locked': 'USTAAD_LINKS_LOCKED',
  'tag-unknown': 'USTAAD_TAG_UNKNOWN',
};

/** One answer for a post or a story: the refusal word of the state, held for a check, or published. */
const outcome = (c: AuditCase): Reply | { id: string; status: string } => {
  const code = REFUSED[String(c.state.result)];
  if (code) return { status: 422, code };
  return { id: uuid(2000), status: c.state.result === 'held' ? 'held' : 'published' };
};

const TAGS = [
  { slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', group: 'work', followed: false },
  { slug: 'clutch', nameEn: 'Clutch', nameHi: 'क्लच', group: 'work', followed: false },
  { slug: 'two-wheeler', nameEn: 'Two wheeler', nameHi: 'दोपहिया', group: 'segment', followed: true },
];

export function ustaadCreateMocks(): Mock[] {
  const created = (path: RegExp, schema: { parse(value: unknown): unknown }, extra: object): Mock => ({
    method: 'POST',
    path,
    schema,
    reply: ({ c }): Reply => {
      const o = outcome(c);
      return 'code' in o ? o : { body: { ...o, ...extra } };
    },
  });
  return [
    meMember(),
    // The composer asks what it may offer before any upload (SIM-P6, SIM-P29): nothing is locked in these rows.
    get(/^\/ustaad\/feed\/limits$/, ComposeLimitsDto, () => ({
      body: { maxPhotos: 10, stories: 'open', canWrite: true } satisfies Out<typeof ComposeLimitsDto>,
    })),
    get(/^\/ustaad\/tags$/, TagsResponse, (_c, q) => ({
      body: {
        tags: TAGS.filter(
          (t) => !q.get('q') || t.nameEn.toLowerCase().includes(q.get('q')?.toLowerCase() ?? ''),
        ),
      } satisfies Out<typeof TagsResponse>,
    })),
    {
      // Smart correction on send: nothing to change.
      method: 'POST',
      path: /^\/ustaad\/correct$/,
      schema: CorrectResponse,
      reply: ({ body }): Reply => {
        const text = typeof body === 'object' && body !== null && 'text' in body ? String(body.text) : '';
        return {
          body: {
            mode: 'off',
            engine: null,
            text,
            original: text,
            changed: false,
            changes: 0,
            segments: [],
          } satisfies Out<typeof CorrectResponse>,
        };
      },
    },
    created(/^\/ustaad\/posts$/, CreatedResponse, {}),
    created(/^\/ustaad\/stories$/, StoryCreatedResponse, { expiresAt: iso(-60 * 24) }),
    // A picked photo: declare, the signed PUT (held back for `uploading`), then complete.
    {
      method: 'POST',
      path: /^\/ustaad\/media$/,
      schema: DeclaredUploadResponse,
      reply: (): Reply => ({
        body: {
          mediaId: uuid(2001),
          put: { url: `${AUDIT_API_ORIGIN}/v1/ustaad/media/upload/sink`, headers: {} },
          expiresAt: iso(-15),
        } satisfies Out<typeof DeclaredUploadResponse>,
      }),
    },
    {
      method: 'PUT',
      path: /^\/ustaad\/media\/upload\/sink$/,
      reply: ({ c }): Reply =>
        c.state.result === 'uploading' ? { body: {}, delayMs: 15_000 } : { body: {} },
    },
    {
      method: 'POST',
      path: /^\/ustaad\/media\/[^/]+\/complete$/,
      schema: VerifiedMediaResponse,
      reply: (): Reply => ({
        body: { id: uuid(2001), status: 'ready' } satisfies Out<typeof VerifiedMediaResponse>,
      }),
    },
  ];
}

// ── Story viewer ──────────────────────────────────────────────────────────────────────────────────────────────

/** One ring: mine (with "Seen by") or another member's, the first story of the kind the state names, then a photo. */
function ring(c: AuditCase): StoryRing {
  const mine = c.state.story === 'mine';
  const kind = c.state.story === 'voice' ? 'audio' : c.state.story === 'video' ? 'video' : 'image';
  const story = (n: number, k: string, seenBy: number | null) => ({
    id: uuid(2100 + n),
    body: n === 1 ? 'Open till 8 pm today' : null,
    media: [medium(k, 40 + n)],
    seen: false,
    seenBy,
    createdAt: iso(120),
    expiresAt: iso(-60 * 20),
  });
  const who = author(c, 1, 'Suresh Verma', 'सुरेश वर्मा');
  return {
    author: mine ? { ...who, id: MEMBER.id, handle: MEMBER.handle } : who,
    mine,
    allSeen: mine,
    stories: [story(1, mine ? 'image' : kind, mine ? 7 : null), story(2, 'image', mine ? 3 : null)],
  };
}

export function ustaadStoryViewerMocks(): Mock[] {
  return [
    // First match wins: these two answer before the feed's own story rings.
    get(/^\/ustaad\/stories$/, StoryRingsResponse, (c) => ({
      body: { rings: [ring(c)] } satisfies Out<typeof StoryRingsResponse>,
    })),
    {
      method: 'POST',
      path: /^\/ustaad\/stories\/[^/]+\/view$/,
      schema: SeenResponse,
      reply: (): Reply => ({ body: { seen: true } satisfies Out<typeof SeenResponse> }),
    },
    ...ustaadFeedMocks(),
  ];
}
