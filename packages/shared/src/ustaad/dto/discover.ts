/**
 * Discover DTOs (spec 23 § 4 flow 8, § 9.4, SR-37; workstream D2): typed search with filters, ranked by helpful and
 * best answers (followers weigh 0), 20 per page, cursor only, no total. Distance is a band code, never a number.
 */
import { z } from 'zod';
import { DISTANCE_BANDS } from '../zones';
import { POST_KINDS, USTAAD_LEVELS, USTAAD_SPECIALITY_CODES } from '../codes';
import { CursorDto, MemberCardDto } from './social';

export const DiscoverQueryDto = z
  .object({
    q: z.string().trim().min(2).max(60).optional(),
    work: z.enum(USTAAD_SPECIALITY_CODES).optional(),
    level: z.enum(USTAAD_LEVELS).optional(),
    /** A city code (`RPR`); default the caller's city. */
    city: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    cursor: CursorDto.optional(),
  })
  .strict();
export type DiscoverQuery = z.infer<typeof DiscoverQueryDto>;

export const DiscoverPersonDto = MemberCardDto.extend({
  specialities: z.array(z.enum(USTAAD_SPECIALITY_CODES)),
  /** Null when `feed.show_follower_counts` is off. */
  followers: z.number().int().nullable(),
  helpfulAnswers: z.number().int(),
  bestAnswers: z.number().int(),
  /** Under 30 days on the network (a "new Ustaad" slot). */
  isNew: z.boolean(),
  /** Rough distance band from the caller's garage pin, when both pins exist and are not hidden (SR-29). */
  distanceBand: z.enum(DISTANCE_BANDS).nullable(),
});
export type DiscoverPerson = z.infer<typeof DiscoverPersonDto>;

export const DiscoverPageDto = z.object({
  items: z.array(DiscoverPersonDto),
  nextCursor: z.string().nullable(),
});

export const DiscoverTagDto = z.object({
  slug: z.string(),
  nameEn: z.string(),
  nameHi: z.string(),
  /** Posts and questions with the tag in the last 14 days, in the caller's reach. */
  uses: z.number().int(),
});
export const DiscoverTagsDto = z.object({ items: z.array(DiscoverTagDto) });

export const TopPostDto = z.object({
  id: z.uuid(),
  kind: z.enum(POST_KINDS),
  author: MemberCardDto,
  likes: z.number().int().nullable(),
  saves: z.number().int(),
  createdAt: z.string(),
});
export type TopPost = z.infer<typeof TopPostDto>;
export const TopPostsDto = z.object({ items: z.array(TopPostDto) });
