/**
 * Inbox tools of the support console (design 2026-11-15 "Support next tier", item 4; spec 09): canned reply bodies,
 * assignment and the shapes the admin screens validate (hard rule 4). Texts exist in English and Hindi (rule 10).
 */
import { z } from 'zod';

/** The slug of a canned reply (also its analytics code). */
export const CANNED_KEY_RE = /^[a-z][a-z0-9_]{2,39}$/;
export const CANNED_TITLE_MAX = 80;
export const CANNED_BODY_MAX = 2000;

const text = (max: number) => z.string().trim().min(1).max(max);

export const CannedReplyBody = z
  .object({
    key: z.string().regex(CANNED_KEY_RE),
    titleEn: text(CANNED_TITLE_MAX),
    titleHi: text(CANNED_TITLE_MAX),
    bodyEn: text(CANNED_BODY_MAX),
    bodyHi: text(CANNED_BODY_MAX),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();
export type CannedReplyBodyDto = z.infer<typeof CannedReplyBody>;

export const CannedReplyDto = z.object({
  id: z.string(),
  key: z.string(),
  titleEn: z.string(),
  titleHi: z.string(),
  bodyEn: z.string(),
  bodyHi: z.string(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
});
export type CannedReply = z.infer<typeof CannedReplyDto>;
export const CannedReplyList = z.object({ replies: z.array(CannedReplyDto), canEdit: z.boolean() });

export const SupportAgent = z.object({ id: z.string(), name: z.string().nullable() });
export type SupportAgentDto = z.infer<typeof SupportAgent>;
export const SupportAgentList = z.object({ agents: z.array(SupportAgent) });
export const SupportAssigned = z.object({ version: z.number().int(), assignee: SupportAgent.nullable() });

/** Stable error codes of the inbox routes (the website translates them; hard rule 10). */
export const SUPPORT_INBOX_ERROR_CODES = [
  'ASSIGNEE_INVALID',
  'STALE_TICKET',
  'TICKET_CLOSED',
  'STALE_CANNED_REPLY',
  'CANNED_REPLY_KEY_TAKEN',
  'CANNED_REPLY_INVALID',
] as const;

/** `POST /admin/support/tickets/{code}/deletion/confirm` (item 7). */
export const SupportConfirmed = z.object({ version: z.number().int() });
