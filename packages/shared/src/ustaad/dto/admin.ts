/**
 * Admin → Ustaad settings contracts (spec 23 § 8 "Admin", § 15; task G1). Request bodies are strict (no mass
 * assignment, SR-5); responses are parsed by the web before use (hard rule 4). Locked items (staff final approval,
 * the Sponsored label, the distance bands) are not settings and never stored: they are shown read-only and any save
 * that names one is refused with 422 `SETTING_INVARIANT` (SR-8, SR-41, SR-29; AT-LEVEL-2, AT-PROMO-1).
 */
import { z } from 'zod';
import {
  COACHMARK_TARGETS,
  PROMOTION_SLOTS,
  PROMOTION_STATES,
  PROMOTION_TARGETS,
  REPORT_CLOCKS,
  REPORT_REASONS,
  TAG_GROUPS,
  USTAAD_BADGE_KINDS,
  USTAAD_BADGE_RULE_KINDS,
  USTAAD_LEVELS,
  USTAAD_SEGMENT_CODES,
  WORD_LISTS,
} from '../codes';
import { InternalPathDto } from '../paths';
import { USTAAD_VIDEO_RAISE_REASONS } from '../settings';

// ── Locked items ─────────────────────────────────────────────────────────────────────────────────────────────

export const USTAAD_LOCKED_ITEMS = [
  /** SR-8 founder ruling: verification and every Bada/Master promotion need a staff approval row. */
  { item: 'ustaad.verify.staff_final_approval', value: true },
  /** SR-41, ASCI: the label on every promotion, in its first line. */
  { item: 'ustaad.promo.label', value: { en: 'Sponsored', hi: 'प्रायोजित' } },
  /** SR-29: changing the edges would let differencing reveal positions. Kilometres. */
  { item: 'ustaad.loc.distance_bands', value: [2, 5, 10] },
] as const;
export type UstaadLockedItem = (typeof USTAAD_LOCKED_ITEMS)[number]['item'];

export function isUstaadLockedItem(key: string): key is UstaadLockedItem {
  return USTAAD_LOCKED_ITEMS.some((l) => l.item === key);
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────

const SettingValue = z.union([z.number().int(), z.boolean(), z.string().max(40)]);
const Version = z.number().int().min(1);

/**
 * One save = every changed key with the version it was read at (null = never saved). Keys are checked against the
 * registry by the server, after the locked-item check, so a locked item answers SETTING_INVARIANT, not 400.
 */
export const UstaadSettingsSaveDto = z
  .object({
    changes: z
      .array(
        z
          .object({ key: z.string().min(1).max(80), value: SettingValue, version: Version.nullable() })
          .strict(),
      )
      .min(1)
      .max(200)
      .refine((c) => new Set(c.map((x) => x.key)).size === c.length, 'DUPLICATE_KEY'),
    /** Needed when the save raises `ustaad.posts.video_max_s` above 180 (super admin only, audited). */
    reasonCode: z.enum(USTAAD_VIDEO_RAISE_REASONS).optional(),
  })
  .strict();
export type UstaadSettingsSave = z.infer<typeof UstaadSettingsSaveDto>;

export const UstaadSettingRowDto = z.object({
  key: z.string(),
  value: SettingValue,
  default: SettingValue,
  version: z.number().int().nullable(),
});
export const UstaadSettingsListDto = z.object({
  settings: z.array(UstaadSettingRowDto),
  /** May the caller save (holds `ustaad:settings`)? The page is read-only otherwise. */
  canEdit: z.boolean(),
  /** May the caller raise the video length above 180 s (super admin)? */
  canRaiseVideo: z.boolean(),
});
export type UstaadSettingsList = z.infer<typeof UstaadSettingsListDto>;
export const UstaadSettingsSavedDto = z.object({
  versions: z.record(z.string(), z.number().int()),
});

// ── Shared pieces ────────────────────────────────────────────────────────────────────────────────────────────

/** NFC, lower case, trimmed, inner spaces collapsed: the `phrase_norm` / alias form the filters match on. */
export function normaliseUstaadPhrase(text: string): string {
  return text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

const textEn = (max: number) => z.string().trim().min(1).max(max);
const textHi = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max);
const code = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const position = z.number().int().min(0).max(100);
const count = z.number().int().min(0).max(100_000);

export const VersionDto = z.object({ version: Version }).strict();

// ── Levels ───────────────────────────────────────────────────────────────────────────────────────────────────

export const LevelRuleWriteDto = z
  .object({
    level: z.enum(USTAAD_LEVELS),
    ruleGroup: z.string().regex(/^[A-Z]$/),
    minFollowers: count,
    minBestAnswers: count,
    minHelpfulPct: z.number().int().min(0).max(100),
    minVerifiedYears: z.number().int().min(0).max(50),
    minVideos: count,
    minRecommendations: count,
    needsStaffReview: z.boolean(),
    perkEn: optionalText(200),
    perkHi: optionalText(300),
    coinMultiplierBp: z.number().int().min(10_000).max(30_000),
    nameEn: textEn(40),
    nameHi: textHi(60),
    position,
  })
  .strict();
export const LevelRuleUpdateDto = LevelRuleWriteDto.extend({ version: Version }).strict();
export const LevelRuleRowDto = LevelRuleWriteDto.extend({ id: z.string(), version: z.number().int() });

// ── Badges ───────────────────────────────────────────────────────────────────────────────────────────────────

export const BadgeRuleDto = z
  .object({
    schema_version: z.literal(1),
    kind: z.enum(USTAAD_BADGE_RULE_KINDS),
    tag: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_]{1,39}$/)
      .optional(),
    segment: z.enum(USTAAD_SEGMENT_CODES).optional(),
    count: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();
export const BadgeWriteDto = z
  .object({
    code,
    nameEn: textEn(60),
    nameHi: textHi(90),
    ruleEn: textEn(200),
    ruleHi: textHi(300),
    icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
    kind: z.enum(USTAAD_BADGE_KINDS),
    rule: BadgeRuleDto,
    active: z.boolean(),
  })
  .strict();
export const BadgeUpdateDto = BadgeWriteDto.extend({ version: Version }).strict();
export const BadgeRowDto = BadgeWriteDto.extend({ id: z.string(), version: z.number().int() });

// ── Tags ─────────────────────────────────────────────────────────────────────────────────────────────────────

const alias = z.string().max(40).transform(normaliseUstaadPhrase).pipe(z.string().min(1));
export const TagWriteDto = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9_]{1,39}$/),
    nameEn: textEn(60),
    nameHi: textHi(90),
    group: z.enum(TAG_GROUPS),
    aliases: z.array(alias).max(20),
    active: z.boolean(),
  })
  .strict();
export const TagUpdateDto = TagWriteDto.extend({ version: Version }).strict();
export const TagMergeDto = z.object({ intoId: z.uuid(), version: Version }).strict();
export const TagRowDto = z.object({
  id: z.string(),
  slug: z.string(),
  nameEn: z.string(),
  nameHi: z.string(),
  group: z.enum(TAG_GROUPS),
  aliases: z.array(z.string()),
  active: z.boolean(),
  mergedIntoId: z.string().nullable(),
  posts: z.number().int(),
  version: z.number().int(),
});

// ── Word lists ───────────────────────────────────────────────────────────────────────────────────────────────

export const WORD_LANGS = ['any', 'hi', 'en', 'hinglish', 'cg'] as const;
const wordBase = {
  phrase: z.string().trim().min(1).max(120),
  replacement: z.string().trim().min(1).max(120).optional(),
  lang: z.enum(WORD_LANGS),
  active: z.boolean(),
};
const replacementRule = (w: { list: string; replacement?: string | undefined }) =>
  (w.list === 'correction') === (w.replacement !== undefined);
export const WordWriteDto = z
  .object({ list: z.enum(WORD_LISTS), ...wordBase })
  .strict()
  .refine(replacementRule, { message: 'REPLACEMENT_ONLY_FOR_CORRECTION', path: ['replacement'] });
/** The list never changes on an edit (a word moves list by being added to the other one). */
export const WordUpdateDto = z.object({ ...wordBase, version: Version }).strict();
export const WordRowDto = z.object({
  id: z.string(),
  list: z.enum(WORD_LISTS),
  phrase: z.string(),
  replacement: z.string().nullable(),
  lang: z.enum(WORD_LANGS),
  active: z.boolean(),
  version: z.number().int(),
});

// ── Report reasons ───────────────────────────────────────────────────────────────────────────────────────────

export const ReasonWriteDto = z
  .object({
    code: z.enum(REPORT_REASONS),
    labelEn: textEn(80),
    labelHi: textHi(120),
    active: z.boolean(),
    defaultClock: z.enum(REPORT_CLOCKS),
  })
  .strict();
export const ReasonUpdateDto = ReasonWriteDto.omit({ code: true }).extend({ version: Version }).strict();
export const ReasonRowDto = ReasonWriteDto.extend({ version: z.number().int() });

// ── Reach cities ─────────────────────────────────────────────────────────────────────────────────────────────

export const ReachCityWriteDto = z.object({ enabled: z.boolean(), version: Version.nullable() }).strict();
export const ReachCityRowDto = z.object({
  cityId: z.string(),
  code: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
  enabled: z.boolean(),
  version: z.number().int().nullable(),
});

// ── Promotions ───────────────────────────────────────────────────────────────────────────────────────────────

/** Moves an admin may make; `live` is reached by the schedule (worker), never by hand. */
const PROMOTION_MOVES: Record<
  (typeof PROMOTION_STATES)[number],
  readonly (typeof PROMOTION_STATES)[number][]
> = {
  draft: ['scheduled', 'ended'],
  scheduled: ['draft', 'ended'],
  live: ['ended'],
  ended: [],
};
export function promotionMoveAllowed(
  from: (typeof PROMOTION_STATES)[number],
  to: (typeof PROMOTION_STATES)[number],
): boolean {
  return PROMOTION_MOVES[from].includes(to);
}

const promotionFields = {
  slot: z.enum(PROMOTION_SLOTS),
  titleEn: textEn(80),
  titleHi: textHi(120),
  bodyEn: optionalText(200),
  bodyHi: optionalText(300),
  target: z.enum(PROMOTION_TARGETS),
  targetId: z.string().trim().min(1).max(300),
  cityIds: z.array(z.uuid()).max(50),
  segmentCodes: z.array(z.enum(USTAAD_SEGMENT_CODES)).max(USTAAD_SEGMENT_CODES.length),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /**
   * Never editable (SR-41). Present in the shape only so the server can refuse it with 422 SETTING_INVARIANT
   * (AT-PROMO-1) instead of a generic 400.
   */
  label: z.unknown().optional(),
};
const promotionChecks = (
  p: { target: string; targetId: string; startsAt: string; endsAt: string },
  ctx: z.RefinementCtx,
) => {
  if (Date.parse(p.endsAt) <= Date.parse(p.startsAt))
    ctx.addIssue({ code: 'custom', message: 'WINDOW', path: ['endsAt'] });
  if (p.target === 'url_internal' && !InternalPathDto.safeParse(p.targetId).success)
    ctx.addIssue({ code: 'custom', message: 'UNSAFE_PATH', path: ['targetId'] });
};
export const PromotionWriteDto = z.object(promotionFields).strict().superRefine(promotionChecks);
export const PromotionUpdateDto = z
  .object({ ...promotionFields, version: Version })
  .strict()
  .superRefine(promotionChecks);
export const PromotionMoveDto = z.object({ to: z.enum(PROMOTION_STATES), version: Version }).strict();
export const PromotionRowDto = z.object({
  id: z.string(),
  slot: z.enum(PROMOTION_SLOTS),
  titleEn: z.string(),
  titleHi: z.string(),
  bodyEn: z.string(),
  bodyHi: z.string(),
  target: z.enum(PROMOTION_TARGETS),
  targetId: z.string(),
  cityIds: z.array(z.string()),
  segmentCodes: z.array(z.string()),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(PROMOTION_STATES),
  version: z.number().int(),
});

// ── Tutorial cards and coach-marks ───────────────────────────────────────────────────────────────────────────

/** Column limits of `ustaad_tutorial_cards` (CHECK). Pictures and narration come with the media routes (A4). */
export const TutorialCardWriteDto = z
  .object({
    code,
    position,
    titleEn: textEn(80),
    titleHi: textHi(120),
    bodyEn: textEn(300),
    bodyHi: textHi(400),
    active: z.boolean(),
  })
  .strict();
export const TutorialCardUpdateDto = TutorialCardWriteDto.extend({ version: Version }).strict();
export const TutorialCardRowDto = TutorialCardWriteDto.extend({ id: z.string(), version: z.number().int() });

export const CoachmarkWriteDto = z
  .object({
    target: z.enum(COACHMARK_TARGETS),
    textEn: textEn(140),
    textHi: textHi(200),
    position,
    active: z.boolean(),
  })
  .strict();
export const CoachmarkUpdateDto = CoachmarkWriteDto.extend({ version: Version }).strict();
export const CoachmarkRowDto = CoachmarkWriteDto.extend({ id: z.string(), version: z.number().int() });

// ── Inferred types (the db package has no zod of its own) ───────────────────────────────────────────────────
export type LevelRuleWrite = z.infer<typeof LevelRuleWriteDto>;
export type BadgeWrite = z.infer<typeof BadgeWriteDto>;
export type TagWrite = z.infer<typeof TagWriteDto>;
export type TagMerge = z.infer<typeof TagMergeDto>;
export type WordWrite = z.infer<typeof WordWriteDto>;
export type WordUpdate = z.infer<typeof WordUpdateDto>;
export type ReasonWrite = z.infer<typeof ReasonWriteDto>;
export type ReasonUpdate = z.infer<typeof ReasonUpdateDto>;
export type ReachCityWrite = z.infer<typeof ReachCityWriteDto>;
export type PromotionWrite = Omit<z.infer<typeof PromotionWriteDto>, 'label'>;
export type PromotionMove = z.infer<typeof PromotionMoveDto>;
export type TutorialCardWrite = z.infer<typeof TutorialCardWriteDto>;
export type CoachmarkWrite = z.infer<typeof CoachmarkWriteDto>;
