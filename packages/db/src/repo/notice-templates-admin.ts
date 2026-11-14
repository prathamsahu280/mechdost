import { and, eq, inArray } from 'drizzle-orm';
import { isNoticeKind, noticeOverrideProblem } from '@mechdost/shared/notice-catalogue';
import { auditLog, notificationTemplates } from '../schema';
import { ConflictError, ValidationError } from './errors';
import type { Locale } from './notify';
import type { Tx } from './orders';

/**
 * Admin control over the in-app and push messages (hard rule 8; design 2026-11-15 bell and push). One row per kind,
 * channel (`inapp` = the bell and centre page, `push`) and language in `notification_templates`; staff with
 * `notifications:manage` (checked in the API) edit them. `subject` holds the title (null = the default), `body`
 * '' = the default text, `enabled` false = not sent on that channel in that language. No row = the locale-file text,
 * on. A push with no row of its own uses the bell text. Every change is compare-and-set on `version` with an audit
 * row in the same transaction.
 */
export type NoticeChannel = 'inapp' | 'push';

export interface NoticeTemplateRecord {
  key: string;
  channel: NoticeChannel;
  locale: Locale;
  title: string | null;
  body: string;
  enabled: boolean;
  version: number;
  updatedAt: Date;
}

const MESSAGES: Record<string, string> = {
  NOTICE_UNKNOWN_KIND: 'This message does not exist',
  NOTICE_TOO_LONG: 'The text is too long',
  NOTICE_UNKNOWN_PLACEHOLDER: 'Use only the placeholders listed for this message, in curly brackets',
  NOTICE_HTML: 'Write plain text: HTML is not allowed',
};

const blankToNull = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);

export async function listNoticeTemplates(db: Tx): Promise<NoticeTemplateRecord[]> {
  const rows = await db
    .select()
    .from(notificationTemplates)
    .where(inArray(notificationTemplates.channel, ['inapp', 'push']))
    .orderBy(notificationTemplates.key, notificationTemplates.channel, notificationTemplates.locale);
  return rows.map((r) => ({
    key: r.key,
    channel: r.channel as NoticeChannel,
    locale: r.locale as Locale,
    title: r.subject,
    body: r.body,
    enabled: r.enabled,
    version: r.version,
    updatedAt: r.updatedAt,
  }));
}

export async function saveNoticeTemplate(
  db: Tx,
  input: {
    key: string;
    channel: NoticeChannel;
    locale: Locale;
    title?: string | null;
    body?: string | null;
    enabled: boolean;
    /** null = create (fails if someone created it meanwhile). */
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number }> {
  const text = { title: blankToNull(input.title), body: blankToNull(input.body) ?? '' };
  const problem = noticeOverrideProblem(input.key, text);
  if (problem) throw new ValidationError(MESSAGES[problem] ?? problem, problem);
  return db.transaction(async (tx) => {
    const where = and(
      eq(notificationTemplates.key, input.key),
      eq(notificationTemplates.channel, input.channel),
      eq(notificationTemplates.locale, input.locale),
    );
    const [before] = await tx.select().from(notificationTemplates).where(where);
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(notificationTemplates)
        .values({
          key: input.key,
          channel: input.channel,
          locale: input.locale,
          subject: text.title,
          body: text.body,
          enabled: input.enabled,
          updatedBy: input.staffUserId,
        })
        .onConflictDoNothing()
        .returning({ version: notificationTemplates.version });
    } else {
      [saved] = await tx
        .update(notificationTemplates)
        .set({ subject: text.title, body: text.body, enabled: input.enabled, updatedBy: input.staffUserId })
        .where(and(where, eq(notificationTemplates.version, input.expectedVersion)))
        .returning({ version: notificationTemplates.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this message; reload and try again', 'STALE_TEMPLATE');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'notice_template.saved',
      entity: 'notice_template',
      entityId: `${input.key}:${input.channel}:${input.locale}`,
      before: before
        ? { title: before.subject, body: before.body, enabled: before.enabled, version: before.version }
        : null,
      after: { ...text, enabled: input.enabled, version: saved.version },
    });
    return saved;
  });
}

/** Back to the code default text (compare-and-set, audited); a switched-off message stays off with no text left. */
export async function resetNoticeTemplate(
  db: Tx,
  input: {
    key: string;
    channel: NoticeChannel;
    locale: Locale;
    expectedVersion: number;
    staffUserId: string;
  },
): Promise<void> {
  if (!isNoticeKind(input.key))
    throw new ValidationError(MESSAGES.NOTICE_UNKNOWN_KIND ?? '', 'NOTICE_UNKNOWN_KIND');
  await db.transaction(async (tx) => {
    const where = and(
      eq(notificationTemplates.key, input.key),
      eq(notificationTemplates.channel, input.channel),
      eq(notificationTemplates.locale, input.locale),
      eq(notificationTemplates.version, input.expectedVersion),
    );
    const [before] = await tx.select().from(notificationTemplates).where(where).for('update');
    if (!before)
      throw new ConflictError('Someone else changed this message; reload and try again', 'STALE_TEMPLATE');
    if (before.enabled) await tx.delete(notificationTemplates).where(where);
    else
      await tx
        .update(notificationTemplates)
        .set({ subject: null, body: '', updatedBy: input.staffUserId })
        .where(where);
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'notice_template.reset',
      entity: 'notice_template',
      entityId: `${input.key}:${input.channel}:${input.locale}`,
      before: { title: before.subject, body: before.body, enabled: before.enabled, version: before.version },
      after: { reset: true },
    });
  });
}
