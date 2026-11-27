/**
 * Feed DTOs (spec 23 § 4 flows 4–6, § 8 "Feed & posts", "Stories", "Discover/tags" (tags only), "Share teaser";
 * plan tasks D1–D2). Strict at the boundary (SR-5, no mass assignment): `status`, `authorId`, `cityId`,
 * `contentType` (members only post `ugc`; Sponsored comes from the promotions service, SR-41), counters and
 * `expiresAt` are never accepted from a client. The repository checks what needs the database (media owner, kind,
 * duration and caps; curated tags; settings). Smart correction runs on the phone through `POST /ustaad/correct`
 * (spec 23 § 11.1); the body carries the result and, when the words changed, the original.
 */
import { z } from 'zod';
import { CORRECTION_APPLIED, POST_TEMPLATES, TAG_GROUPS, USTAAD_SEGMENT_CODES } from '../codes';
import { safeLinkUrl } from '../links';

const idemKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const cursor = z.string().max(300).optional();
const limit = z.coerce.number().int().min(1).max(30).default(20);

/** Post kinds a member creates through `POST /ustaad/posts` (a story goes through `POST /ustaad/stories`). */
export const POST_CREATE_KINDS = [
  'voice',
  'photo',
  'video',
  'text',
  'document',
  'poll',
  'link',
  'mixed',
] as const;
export type PostCreateKind = (typeof POST_CREATE_KINDS)[number];
const MEDIA_KINDS_OF_POST: readonly PostCreateKind[] = ['voice', 'photo', 'video', 'document', 'mixed'];

/** A hashtag as typed (SR-25): letters, marks, digits, underscore after NFC; one leading `#`. */
const TAG_INPUT_RE = /^[\p{L}\p{M}\p{N}_]{2,40}$/u;
export function normaliseTagInput(raw: string): string | null {
  const t = raw.trim().normalize('NFC').toLowerCase().replace(/^#/, '');
  return TAG_INPUT_RE.test(t) ? t : null;
}
const tagInput = z
  .string()
  .max(41)
  .transform((v, ctx) => {
    const t = normaliseTagInput(v);
    if (t === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid tag' });
      return z.NEVER;
    }
    return t;
  });

export const PostMediaInputDto = z
  .object({ mediaId: z.uuid(), role: z.enum(['before', 'after']).optional() })
  .strict();

export const PollInputDto = z
  .object({
    options: z.array(text(80)).min(2).max(4),
    closesInHours: z.number().int().min(1).max(168).default(24),
  })
  .strict();

const correctionFields = {
  bodyOriginal: text(3000).optional(),
  correction: z.enum(CORRECTION_APPLIED).default('none'),
};

export const CreatePostDto = z
  .object({
    kind: z.enum(POST_CREATE_KINDS),
    template: z.enum(POST_TEMPLATES).optional(),
    body: text(3000).optional(),
    ...correctionFields,
    fixSymptom: text(500).optional(),
    fixCause: text(500).optional(),
    fixFix: text(500).optional(),
    media: z.array(PostMediaInputDto).max(10).default([]),
    poll: PollInputDto.optional(),
    linkUrl: z.string().trim().max(2000).optional(),
    segmentCode: z.enum(USTAAD_SEGMENT_CODES).optional(),
    vehicleModelId: z.uuid().optional(),
    /** Curated tags only (slug, Hindi name or alias); the repository resolves them and caps at `tags.max_per_post`. */
    tags: z.array(tagInput).max(5).default([]),
    idemKey,
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const hasMedia = p.media.length > 0;
    if (MEDIA_KINDS_OF_POST.includes(p.kind) !== hasMedia)
      issue('media', hasMedia ? 'This kind of post has no media' : 'Add a photo, voice note, video or file');
    if ((p.kind === 'poll') !== (p.poll !== undefined))
      issue('poll', 'Polls only, and every poll needs options');
    if ((p.kind === 'link') !== (p.linkUrl !== undefined))
      issue('linkUrl', 'Links only, and a link needs a URL');
    if (p.linkUrl !== undefined && safeLinkUrl(p.linkUrl) === null)
      issue('linkUrl', 'This link cannot be posted');
    const hasFix = p.fixSymptom !== undefined || p.fixCause !== undefined || p.fixFix !== undefined;
    if (p.template === 'fix_log') {
      if (p.fixSymptom === undefined || p.fixFix === undefined)
        issue('fixSymptom', 'Problem and fix are needed');
    } else if (hasFix) issue('fixSymptom', 'Only a fix log has these fields');
    if (p.template === 'tip' && p.body === undefined) issue('body', 'Write the tip');
    if (p.kind === 'text' && p.body === undefined && p.template !== 'fix_log')
      issue('body', 'Write something');
    const roles = p.media.map((m) => m.role);
    if (p.template === 'before_after') {
      if (p.kind !== 'photo') issue('kind', 'Before/after is a photo post');
      if (!roles.includes('before') || !roles.includes('after') || roles.includes(undefined))
        issue('media', 'Mark each photo before or after');
    } else if (roles.some((r) => r !== undefined)) issue('media', 'Roles are for before/after posts');
    if (new Set(p.media.map((m) => m.mediaId)).size !== p.media.length) issue('media', 'Duplicate media');
    if (new Set(p.tags).size !== p.tags.length) issue('tags', 'Duplicate tag');
    if (p.correction === 'none' && p.bodyOriginal !== undefined)
      issue('bodyOriginal', 'No correction was used');
    if (p.bodyOriginal !== undefined && p.body === undefined) issue('bodyOriginal', 'Nothing was corrected');
  });
export type CreatePost = z.infer<typeof CreatePostDto>;

/** A story: one photo, voice note or short video (+ the video's poster frame), optional one-line caption. */
export const CreateStoryDto = z
  .object({
    mediaId: z.uuid(),
    posterMediaId: z.uuid().optional(),
    body: text(200).optional(),
    idemKey,
  })
  .strict()
  .refine((s) => s.posterMediaId !== s.mediaId, { message: 'Duplicate media', path: ['posterMediaId'] });
export type CreateStory = z.infer<typeof CreateStoryDto>;

export const CommentDto = z
  .object({
    body: text(1000).optional(),
    bodyOriginal: text(1000).optional(),
    correction: z.enum(CORRECTION_APPLIED).default('none'),
    /** A voice note or a photo (the caller's own, verified). */
    mediaId: z.uuid().optional(),
    /** A reply to a top-level comment of the same post (one level only). */
    parentId: z.uuid().optional(),
    idemKey,
  })
  .strict()
  .refine((c) => c.body !== undefined || c.mediaId !== undefined, {
    message: 'Speak, type or add a photo',
    path: ['body'],
  })
  .refine((c) => c.correction !== 'none' || c.bodyOriginal === undefined, {
    message: 'No correction was used',
    path: ['bodyOriginal'],
  });
export type CommentInput = z.infer<typeof CommentDto>;

export const SHARE_CHANNELS = ['whatsapp', 'copy_link', 'member'] as const;
export const ShareDto = z.object({ channel: z.enum(SHARE_CHANNELS) }).strict();
export const PollVoteDto = z.object({ optionId: z.uuid() }).strict();

export const FEED_TABS = ['for_you', 'following'] as const;
export type FeedTab = (typeof FEED_TABS)[number];
export const FeedQueryDto = z.object({ tab: z.enum(FEED_TABS).default('for_you'), cursor, limit }).strict();
export const PageQueryDto = z.object({ cursor, limit }).strict();
export const TagListQueryDto = z
  .object({
    q: z.string().trim().max(41).optional(),
    group: z.enum(TAG_GROUPS).optional(),
  })
  .strict();
export const TAG_SLUG_RE = /^[a-z0-9][a-z0-9_]{1,39}$/;
export const TagSuggestionDto = z.object({ text: text(40).pipe(z.string().min(2)) }).strict();

// ── Views (never a phone number, SR-34) ───────────────────────────────────────────────────────────────────────

export const PostAuthorDto = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  displayNameHi: z.string().nullable(),
  level: z.string(),
  track: z.string(),
  official: z.boolean(),
  photoMediaId: z.uuid().nullable(),
});
export type PostAuthor = z.infer<typeof PostAuthorDto>;

export const PostMediaViewDto = z.object({
  mediaId: z.uuid(),
  kind: z.string(),
  role: z.string().nullable(),
  position: z.number().int(),
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int(),
  lqip: z.string().nullable(),
  /** Spec 23 § 10a: the author's typed summary (voice or video) and, for video, captions as WebVTT. */
  summary: z.string().nullable().optional(),
  captionsLang: z.enum(['hi', 'en']).nullable().optional(),
  captionsVtt: z.string().nullable().optional(),
});
export type PostMediaView = z.infer<typeof PostMediaViewDto>;

export const TagViewDto = z.object({
  slug: z.string(),
  nameEn: z.string(),
  nameHi: z.string(),
  group: z.string(),
});
export type TagView = z.infer<typeof TagViewDto>;

export const PostViewDto = z.object({
  id: z.uuid(),
  kind: z.string(),
  template: z.string().nullable(),
  /** `sponsored` is labelled "Sponsored / प्रायोजित" by the website (locked label, SR-41). */
  contentType: z.string(),
  body: z.string().nullable(),
  bodyOriginal: z.string().nullable(),
  correction: z.string(),
  fix: z.object({ symptom: z.string(), cause: z.string().nullable(), fix: z.string() }).nullable(),
  segmentCode: z.string().nullable(),
  vehicleModelId: z.uuid().nullable(),
  link: z
    .object({
      url: z.string(),
      host: z.string().nullable(),
      preview: z.object({ title: z.string().nullable(), description: z.string().nullable() }).nullable(),
    })
    .nullable(),
  media: z.array(PostMediaViewDto),
  poll: z
    .object({
      id: z.uuid(),
      closesAt: z.string(),
      closed: z.boolean(),
      options: z.array(z.object({ id: z.uuid(), label: z.string(), votes: z.number().int() })),
      myOptionId: z.uuid().nullable(),
    })
    .nullable(),
  tags: z.array(TagViewDto),
  /** `likes` is null when `feed.show_like_counts` is off; `saves` only for the author. */
  counts: z.object({
    likes: z.number().int().nullable(),
    comments: z.number().int(),
    saves: z.number().int().nullable(),
  }),
  likedByMe: z.boolean(),
  savedByMe: z.boolean(),
  mine: z.boolean(),
  /** `held` only on the author's own posts ("Our team will check it first"; no reason given). */
  status: z.string(),
  author: PostAuthorDto,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type PostView = z.infer<typeof PostViewDto>;

export const FeedPageDto = z.object({ items: z.array(PostViewDto), nextCursor: z.string().nullable() });
export type FeedPage = z.infer<typeof FeedPageDto>;

export const StoryViewDto = z.object({
  id: z.uuid(),
  body: z.string().nullable(),
  media: z.array(PostMediaViewDto),
  seen: z.boolean(),
  /** "Seen by N": the owner's own stories only (null for everyone else). */
  seenBy: z.number().int().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type StoryView = z.infer<typeof StoryViewDto>;
export const StoryRingDto = z.object({
  author: PostAuthorDto,
  mine: z.boolean(),
  allSeen: z.boolean(),
  stories: z.array(StoryViewDto),
});
export type StoryRing = z.infer<typeof StoryRingDto>;

export const CommentViewDto = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  parentId: z.uuid().nullable(),
  body: z.string().nullable(),
  bodyOriginal: z.string().nullable(),
  correction: z.string(),
  media: PostMediaViewDto.nullable(),
  author: PostAuthorDto,
  mine: z.boolean(),
  /** `held` only on the author's own comments. */
  status: z.string(),
  createdAt: z.string(),
});
export type CommentView = z.infer<typeof CommentViewDto>;

export const TagListItemDto = TagViewDto.extend({ followed: z.boolean() });
export type TagListItem = z.infer<typeof TagListItemDto>;
