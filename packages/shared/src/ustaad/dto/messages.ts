/**
 * Message DTOs (spec 23 § 4 flow 7, § 8 "Messages", SR-33–35; workstream D2). Request-only: the first message is a
 * text-only request; no links or media before the receiver accepts (the repository checks it, these shapes only make
 * the request text-only). Staff read a thread only through an open report (audited).
 */
import { z } from 'zod';
import { MESSAGE_KINDS } from '../codes';
import { VoiceInfoDto } from './media';
import { USTAAD_THREAD_STATUSES } from '../../state';
import { CursorDto, MemberCardDto } from './social';

const text = z.string().trim().min(1).max(1000);

export const StartThreadDto = z.object({ memberId: z.uuid(), text }).strict();
export type StartThread = z.infer<typeof StartThreadDto>;

export const SendMessageDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text }).strict(),
  z.object({ kind: z.literal('voice'), mediaId: z.uuid() }).strict(),
  z.object({ kind: z.literal('photo'), mediaId: z.uuid(), text: text.optional() }).strict(),
  z.object({ kind: z.literal('post_share'), postId: z.uuid() }).strict(),
]);
export type SendMessage = z.infer<typeof SendMessageDto>;

export const ThreadIdParamDto = z.object({ id: z.uuid() });
export const THREAD_ACTIONS = ['accept', 'decline'] as const;
export const ThreadActionParamDto = z.object({ id: z.uuid(), action: z.enum(THREAD_ACTIONS) });
export const ThreadMuteDto = z.object({ muted: z.boolean() }).strict();

export const MessageViewDto = z.object({
  id: z.uuid(),
  mine: z.boolean(),
  kind: z.enum(MESSAGE_KINDS),
  text: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  /** Voice messages: duration, size and typed summary (spec 23 § 10a). */
  voice: VoiceInfoDto.nullable().optional(),
  postId: z.uuid().nullable(),
  /** Only on the sender's own held message: "Our team will check it first" (no reason, no filter oracle). */
  pending: z.boolean(),
  /** My message has been read by the other member (read receipt). */
  read: z.boolean(),
  createdAt: z.string(),
});
export type MessageView = z.infer<typeof MessageViewDto>;

export const ThreadViewDto = z.object({
  id: z.uuid(),
  status: z.enum(USTAAD_THREAD_STATUSES),
  /** True when the caller started the request. */
  mine: z.boolean(),
  other: MemberCardDto,
  muted: z.boolean(),
  unread: z.boolean(),
  lastMessageAt: z.string().nullable(),
  /**
   * The last message the caller may see, for the inbox row (UI upgrade U3): its kind, the first 80 characters of a
   * text, the length of a voice note, and whether it is mine. Held and deleted messages never count.
   */
  last: z
    .object({
      kind: z.enum(MESSAGE_KINDS),
      text: z.string().max(80).nullable(),
      durationMs: z.number().int().nullable(),
      mine: z.boolean(),
    })
    .nullable()
    .optional(),
});
export type ThreadView = z.infer<typeof ThreadViewDto>;

export const ThreadListQueryDto = z
  .object({
    box: z.enum(['inbox', 'requests', 'sent']).default('inbox'),
    cursor: CursorDto.optional(),
  })
  .strict();
export type ThreadListQuery = z.infer<typeof ThreadListQueryDto>;

export const ThreadPageDto = z.object({ items: z.array(ThreadViewDto), nextCursor: z.string().nullable() });

export const MessageListQueryDto = z.object({ cursor: CursorDto.optional() }).strict();
export const MessagePageDto = z.object({
  thread: ThreadViewDto,
  items: z.array(MessageViewDto),
  nextCursor: z.string().nullable(),
});

/** Why a staff member opens a reported thread (SR-38); written to `audit_log` with the report code. */
export const DM_READ_REASONS = ['report_review', 'legal_order', 'child_safety'] as const;
export const USTAAD_REPORT_CODE_RE = /^UR-[A-Z]{3}-\d{4}-[A-Z2-7]{6}$/;
export const StaffThreadReadQueryDto = z
  .object({ reportCode: z.string().regex(USTAAD_REPORT_CODE_RE), reason: z.enum(DM_READ_REASONS) })
  .strict();
export type StaffThreadReadQuery = z.infer<typeof StaffThreadReadQueryDto>;

export const StaffThreadMessageDto = z.object({
  id: z.uuid(),
  senderId: z.uuid(),
  kind: z.enum(MESSAGE_KINDS),
  text: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  postId: z.uuid().nullable(),
  held: z.boolean(),
  deleted: z.boolean(),
  createdAt: z.string(),
});
export const StaffThreadViewDto = z.object({
  threadId: z.uuid(),
  status: z.enum(USTAAD_THREAD_STATUSES),
  members: z.array(z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() })),
  messages: z.array(StaffThreadMessageDto),
});
export type StaffThreadView = z.infer<typeof StaffThreadViewDto>;
