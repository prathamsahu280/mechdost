/**
 * Response shapes of the Ustaad Q&A, Learn, local and media routes that have no named DTO yet (the routes declare
 * them inline). The web client checks every answer with these (hard rule 4); keep them in step with
 * `apps/api/src/routes/ustaad/{qa,local,media}.ts`.
 */
import { z } from 'zod';
import { USTAAD_CONNECTION_STATUSES, USTAAD_THREAD_STATUSES } from '../../state';
import { CommentViewDto, PostViewDto, StoryRingDto, TagListItemDto } from './feed';
import { JobDto, MyLocationDto, ZoneDto } from './local';
import { QuestionCardDto } from './qa';

export const QuestionListResponse = z.object({
  items: z.array(QuestionCardDto),
  nextCursor: z.string().nullable(),
});
export const AskedResponse = z.object({ code: z.string(), status: z.string() });
export const AnsweredResponse = z.object({ id: z.uuid(), status: z.string() });
export const HelpfulResponse = z.object({ helpfulCount: z.number().int(), voted: z.boolean() });
export const SolvedResponse = z.object({ status: z.literal('solved') });
export const LearnProgressResponse = z.object({ watchedSeconds: z.number().int(), completed: z.boolean() });
export const MyLocationResponse = z.object({ location: MyLocationDto.nullable() });
export const OkResponse = z.object({ ok: z.literal(true) });
export const ZonesResponse = z.object({ zones: z.array(ZoneDto) });
export const JobsResponse = z.object({ items: z.array(JobDto), next: z.string().nullable() });
export const AppliedResponse = z.object({ applicationId: z.string(), status: z.string() });
export const MovedResponse = z.object({ status: z.string() });
export const DeclaredUploadResponse = z.object({
  mediaId: z.uuid(),
  put: z.object({ url: z.string(), headers: z.record(z.string(), z.string()) }).optional(),
  expiresAt: z.string(),
});
export const VerifiedMediaResponse = z.object({ id: z.uuid(), status: z.string() });
export const SignedUrlResponse = z.object({ url: z.string(), expiresAt: z.string() });

// ── Feed, graph and messages (workstream D; keep in step with routes/ustaad/{feed,social,messages}.ts) ─────────────

export const CreatedResponse = z.object({ id: z.uuid(), status: z.string() });
export const StoryCreatedResponse = CreatedResponse.extend({ expiresAt: z.string() });
export const StatusResponse = z.object({ status: z.string() });
export const LikeStateResponse = z.object({ liked: z.boolean(), likes: z.number().int().nullable() });
export const UsefulStateResponse = z.object({ useful: z.boolean(), usefulCount: z.number().int() });
export const SavedResponse = z.object({ saved: z.boolean() });
export const ShareLinkResponse = z.object({ token: z.string(), path: z.string() });
export const CommentPageResponse = z.object({
  items: z.array(CommentViewDto),
  nextCursor: z.string().nullable(),
});
export const VotedResponse = z.object({ optionId: z.uuid() });
export const StoryRingsResponse = z.object({ rings: z.array(StoryRingDto) });
export const SeenResponse = z.object({ seen: z.boolean() });
export const TagsResponse = z.object({ tags: z.array(TagListItemDto) });
export const TagPageResponse = z.object({
  tag: TagListItemDto,
  items: z.array(PostViewDto),
  nextCursor: z.string().nullable(),
});
export const TagFollowResponse = z.object({ followed: z.boolean() });
export const OpenShareResponse = z.object({ postId: z.uuid() });
/** The public teaser (`GET /ustaad/s/{token}`, no sign-in): a generic card only. */
export const ShareTeaserResponse = z.object({ kind: z.literal('ustaad_post') });
export const RemovedResponse = z.object({ removed: z.boolean() });
export const BlockedResponse = z.object({ blocked: z.boolean() });
export const MutedResponse = z.object({ muted: z.boolean() });
export const ConnectionMovedResponse = z.object({
  id: z.uuid(),
  status: z.enum(USTAAD_CONNECTION_STATUSES),
});
export const ThreadStartedResponse = z.object({
  threadId: z.uuid(),
  status: z.enum(USTAAD_THREAD_STATUSES),
  messageId: z.uuid(),
  pending: z.boolean(),
});
export const ThreadStatusResponse = z.object({ status: z.enum(USTAAD_THREAD_STATUSES) });
export const PromotionHiddenResponse = z.object({ hidden: z.literal(true) });
export const MessageSentResponse = z.object({ messageId: z.uuid(), pending: z.boolean() });
