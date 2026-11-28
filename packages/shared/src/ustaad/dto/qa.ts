/**
 * Q&A and Learn DTOs (spec 23 § 4 flow 4 and 12, § 8 "Q&A" and "Learn"; plan tasks C1–C2). Strict at the boundary
 * (SR-5, no mass assignment): `status`, `bestAnswerId`, `helpfulCount`, `countsForLevels`, the asker and the city are
 * never accepted from a client. A question is asked by voice (an audio note, no speech-to-text), by text, or both; an
 * answer is a voice note, text, or both. `idemKey` makes a retried send create nothing twice.
 */
import { z } from 'zod';
import { CORRECTION_APPLIED, SAFETY_TAGS, USTAAD_SEGMENT_CODES, USTAAD_WORK_CODES } from '../codes';
import { VoiceInfoDto } from './media';

const idemKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

/** The UQ code: `UQ-{CITY}-{YYYY}-{6 RFC 4648 base32}` (the DB CHECK). */
export const USTAAD_QUESTION_CODE_RE = /^UQ-[A-Z]{3}-\d{4}-[A-Z2-7]{6}$/;

/** Title of a voice-only question (the column is NOT NULL); views return `title: null` for it. */
export const VOICE_ONLY_TITLE = '…';

export const AskQuestionDto = z
  .object({
    /** One line; optional when a voice note carries the question. */
    title: text(200).optional(),
    body: text(2000).optional(),
    /** The words before smart correction, when the member used a suggestion or auto mode changed them. */
    bodyOriginal: text(2000).optional(),
    correction: z.enum(CORRECTION_APPLIED).default('none'),
    voiceMediaId: z.uuid().optional(),
    segmentCode: z.enum(USTAAD_SEGMENT_CODES).optional(),
    workCode: z.enum(USTAAD_WORK_CODES).optional(),
    vehicleModelId: z.uuid().optional(),
    safetyTag: z.enum(SAFETY_TAGS).optional(),
    /** `state` = all of Chhattisgarh (only when `general.all_state` is on). */
    reach: z.enum(['city', 'state']).default('city'),
    hideGarage: z.boolean().default(true),
    idemKey,
  })
  .strict()
  .refine((q) => q.title !== undefined || q.voiceMediaId !== undefined, {
    message: 'Speak or type the question',
    path: ['title'],
  });
export type AskQuestion = z.infer<typeof AskQuestionDto>;

export const AnswerDto = z
  .object({
    body: text(2000).optional(),
    bodyOriginal: text(2000).optional(),
    correction: z.enum(CORRECTION_APPLIED).default('none'),
    voiceMediaId: z.uuid().optional(),
    idemKey,
  })
  .strict()
  .refine((a) => a.body !== undefined || a.voiceMediaId !== undefined, {
    message: 'Speak or type the answer',
    path: ['body'],
  });
export type AnswerInput = z.infer<typeof AnswerDto>;

export const BestAnswerDto = z.object({ answerId: z.uuid() }).strict();
export const AnswerPartsDto = z
  .object({ productIds: z.array(z.uuid()).max(5) })
  .strict()
  .refine((p) => new Set(p.productIds).size === p.productIds.length, { message: 'Duplicate part' });

export const QUESTION_FILTERS = ['all', 'for_you', 'mine', 'unanswered'] as const;
export type QuestionFilter = (typeof QUESTION_FILTERS)[number];
export const QuestionListQueryDto = z
  .object({
    filter: z.enum(QUESTION_FILTERS).default('all'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(30).default(20),
  })
  .strict();

const AuthorView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  displayNameHi: z.string().nullable(),
  level: z.string(),
  track: z.string(),
});

export const QuestionCardDto = z.object({
  /** The id the Save control needs (saves are by id); screens link by `code`. */
  id: z.uuid(),
  code: z.string(),
  title: z.string().nullable(),
  hasVoice: z.boolean(),
  segmentCode: z.string().nullable(),
  workCode: z.string().nullable(),
  safetyTag: z.string().nullable(),
  status: z.string(),
  answers: z.number().int(),
  asker: AuthorView,
  mine: z.boolean(),
  /** Whether the signed-in member has saved it (spec 23 § 21i-L); the Save control starts in this state. */
  savedByMe: z.boolean(),
  createdAt: z.string(),
});
export type QuestionCard = z.infer<typeof QuestionCardDto>;

export const AnswerViewDto = z.object({
  id: z.uuid(),
  body: z.string().nullable(),
  /** "Edited · see original" (spec 23 § 11.1): shown only when the correction changed the words. */
  bodyOriginal: z.string().nullable(),
  correction: z.string(),
  voiceMediaId: z.uuid().nullable(),
  /** Duration, size and typed summary of the voice answer (spec 23 § 10a). */
  voice: VoiceInfoDto.nullable().optional(),
  helpfulCount: z.number().int(),
  votedByMe: z.boolean(),
  isBest: z.boolean(),
  mine: z.boolean(),
  savedByMe: z.boolean(),
  author: AuthorView,
  parts: z.array(
    z.object({ productId: z.uuid(), slug: z.string(), name: z.string(), nameHi: z.string().nullable() }),
  ),
  createdAt: z.string(),
});
export type AnswerView = z.infer<typeof AnswerViewDto>;

export const QuestionDetailDto = QuestionCardDto.extend({
  body: z.string().nullable(),
  bodyOriginal: z.string().nullable(),
  correction: z.string(),
  voiceMediaId: z.uuid().nullable(),
  voice: VoiceInfoDto.nullable().optional(),
  bestAnswerId: z.uuid().nullable(),
  vehicleModel: z.string().nullable(),
  /** What the viewer may do on this thread (the API checks again on every write). */
  can: z.object({ answer: z.boolean(), chooseBest: z.boolean() }),
  answerList: z.array(AnswerViewDto),
});
export type QuestionDetail = z.infer<typeof QuestionDetailDto>;

// ── Learn (Seekho) ────────────────────────────────────────────────────────────────────────────────────────────
export const LearnProgressDto = z
  .object({
    /**
     * Hosted video: seconds watched since the last write (a heartbeat, ≤ 5 minutes). The server counts at most the
     * wall-clock time since its last write for this member and resource, so a jump to the end never completes it.
     */
    deltaSeconds: z.number().int().min(1).max(300).optional(),
    /** External link: "I watched it" (self-marked, capped per day). */
    selfMark: z.literal(true).optional(),
  })
  .strict()
  .refine((p) => (p.deltaSeconds === undefined) !== (p.selfMark === undefined), {
    message: 'Send watched seconds or a self mark',
  });
export type LearnProgress = z.infer<typeof LearnProgressDto>;

export const LearnResourceViewDto = z.object({
  id: z.uuid(),
  kind: z.string(),
  titleEn: z.string(),
  titleHi: z.string(),
  segmentCode: z.string().nullable(),
  workCode: z.string().nullable(),
  durationS: z.number().int().nullable(),
  mediaId: z.uuid().nullable(),
  url: z.string().nullable(),
  label: z.string(),
  watchedSeconds: z.number().int(),
  completed: z.boolean(),
  savedByMe: z.boolean(),
  /** Size of the hosted file in bytes (from the media row); null for links (spec 23 § 21i-L). */
  sizeBytes: z.number().int().nullable(),
  /** When the member last moved this lesson along (ISO, UTC); null if never touched. Drives "Continue". */
  lastWatchedAt: z.string().nullable(),
});
export const LearnCourseViewDto = z.object({
  id: z.uuid(),
  code: z.string(),
  titleEn: z.string(),
  titleHi: z.string(),
  resources: z.array(LearnResourceViewDto),
});
export const LearnViewDto = z.object({
  courses: z.array(LearnCourseViewDto),
  /** Resources outside any course ("Short videos"). */
  loose: z.array(LearnResourceViewDto),
});
export type LearnView = z.infer<typeof LearnViewDto>;
export type LearnResourceView = z.infer<typeof LearnResourceViewDto>;
