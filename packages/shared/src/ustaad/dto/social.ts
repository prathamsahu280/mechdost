/**
 * Follow, connect, block and mute DTOs (spec 23 § 4 flow 7, § 8 "Graph"; workstream D2). Strict bodies (no mass
 * assignment): statuses, counters, `requestedBy` and pairs are never accepted from a client. Member cards carry no
 * phone number, garage or location (SR-34); counts follow `feed.show_follower_counts`.
 */
import { z } from 'zod';
import { USTAAD_LEVELS, USTAAD_TRACKS } from '../codes';
import { USTAAD_CONNECTION_STATUSES } from '../../state';

export const MemberIdParamDto = z.object({ memberId: z.uuid() });
export const CursorDto = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** A member as other members see them in lists (no phone, no garage, no location). */
export const MemberCardDto = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  displayNameHi: z.string().nullable(),
  track: z.enum(USTAAD_TRACKS),
  level: z.enum(USTAAD_LEVELS),
  verified: z.boolean(),
  official: z.boolean(),
  areaLabel: z.string(),
  areaLabelHi: z.string().nullable(),
  photoMediaId: z.uuid().nullable(),
});
export type MemberCard = z.infer<typeof MemberCardDto>;

export const FollowResultDto = z.object({
  following: z.boolean(),
  /** Null when `feed.show_follower_counts` is off. */
  followers: z.number().int().nullable(),
});
export type FollowResult = z.infer<typeof FollowResultDto>;

export const FollowListQueryDto = z
  .object({
    memberId: z.uuid().optional(),
    kind: z.enum(['followers', 'following']).default('followers'),
    cursor: CursorDto.optional(),
  })
  .strict();
export type FollowListQuery = z.infer<typeof FollowListQueryDto>;

export const MemberPageDto = z.object({
  items: z.array(MemberCardDto),
  nextCursor: z.string().nullable(),
});

export const ConnectRequestDto = z.object({ memberId: z.uuid() }).strict();
/** `ignore` is the spec's word for decline (§ 8); both are accepted. */
export const CONNECTION_ACTIONS = ['accept', 'decline', 'ignore', 'withdraw', 'remove'] as const;
export const ConnectionActionParamDto = z.object({ id: z.uuid(), action: z.enum(CONNECTION_ACTIONS) });

export const ConnectionViewDto = z.object({
  id: z.uuid(),
  status: z.enum(USTAAD_CONNECTION_STATUSES),
  /** True when the caller sent the request. */
  mine: z.boolean(),
  other: MemberCardDto,
  updatedAt: z.string(),
});
export type ConnectionView = z.infer<typeof ConnectionViewDto>;

export const ConnectionListQueryDto = z
  .object({
    box: z.enum(['connected', 'incoming', 'outgoing']).default('connected'),
    cursor: CursorDto.optional(),
  })
  .strict();
export type ConnectionListQuery = z.infer<typeof ConnectionListQueryDto>;

export const ConnectionPageDto = z.object({
  items: z.array(ConnectionViewDto),
  nextCursor: z.string().nullable(),
});

/** What the caller's profile view needs to draw the buttons (never whether the other blocked the caller). */
export const RelationshipDto = z.object({
  following: z.boolean(),
  followsMe: z.boolean(),
  connection: z
    .object({ id: z.uuid(), status: z.enum(USTAAD_CONNECTION_STATUSES), mine: z.boolean() })
    .nullable(),
  blocked: z.boolean(),
  muted: z.boolean(),
  threadId: z.uuid().nullable(),
});
export type Relationship = z.infer<typeof RelationshipDto>;

export const BlockListDto = z.object({
  blocked: z.array(MemberCardDto),
  muted: z.array(MemberCardDto),
});
