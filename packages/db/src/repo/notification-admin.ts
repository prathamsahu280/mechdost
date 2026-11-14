import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  emailOverrideProblem,
  isEmailTemplateKey,
  sampleEmailParams,
} from '@mechdost/shared/email-templates';
import {
  DEFAULT_WHATSAPP_RATES_MILLIPAISE,
  WHATSAPP_TEMPLATES,
  isWhatsAppTemplateKey,
  placeholderProblem,
  utilityTemplateProblem,
} from '@mechdost/shared/whatsapp';
import { auditLog, notificationOutbox, notificationTemplates, settings, users } from '../schema';
import { ConflictError, ValidationError } from './errors';
import { enqueueNotification, type Channel, type Locale } from './notify';
import type { Tx } from './orders';

/**
 * Admin control over notifications (hard rule 8; user 2026-11-02: "all these options need to be with the admin
 * too"). Staff with `notifications:manage` (checked in the API) edit template text per event × channel × locale,
 * switch channels on/off per event, set the WhatsApp budget alert and read delivery/cost numbers. Every change is
 * compare-and-set on `version` with an audit row in the same transaction.
 */
const CHANNELS: readonly Channel[] = ['inapp', 'email', 'sms', 'whatsapp', 'push'];

export interface TemplateRecord {
  key: string;
  channel: Channel;
  locale: Locale;
  subject: string | null;
  body: string;
  enabled: boolean;
  version: number;
  updatedAt: Date;
}

export async function listNotificationTemplates(db: Tx): Promise<TemplateRecord[]> {
  const rows = await db
    .select()
    .from(notificationTemplates)
    .orderBy(notificationTemplates.key, notificationTemplates.channel, notificationTemplates.locale);
  return rows.map((r) => ({
    key: r.key,
    channel: r.channel as Channel,
    locale: r.locale as Locale,
    subject: r.subject,
    body: r.body,
    enabled: r.enabled,
    version: r.version,
    updatedAt: r.updatedAt,
  }));
}

/** Validates a template for its channel. WhatsApp: known event, utility wording, matching placeholders. */
export function templateProblem(input: { key: string; channel: Channel; body: string }): string | null {
  if (!CHANNELS.includes(input.channel)) return 'TEMPLATE_CHANNEL';
  // Emails have their own editor and checks (closed placeholder list per template): `saveEmailTemplate`.
  if (input.channel === 'email') return 'TEMPLATE_EMAIL_ENDPOINT';
  const body = input.body.trim();
  if (body.length === 0) return 'TEMPLATE_EMPTY';
  if (input.channel === 'whatsapp') {
    if (!isWhatsAppTemplateKey(input.key)) return 'TEMPLATE_UNKNOWN_EVENT';
    const t = WHATSAPP_TEMPLATES[input.key];
    if (utilityTemplateProblem(body)) return 'TEMPLATE_PROMO_WORDING';
    if (placeholderProblem(body, t.params.length)) return 'TEMPLATE_PLACEHOLDERS';
  } else if (body.length > 4000) {
    return 'TEMPLATE_TOO_LONG';
  }
  return null;
}

const MESSAGES: Record<string, string> = {
  TEMPLATE_CHANNEL: 'Unknown channel',
  TEMPLATE_EMAIL_ENDPOINT: 'Emails are edited in the Emails tab',
  TEMPLATE_EMPTY: 'Write the message text',
  TEMPLATE_UNKNOWN_EVENT: 'This event has no WhatsApp template',
  TEMPLATE_PROMO_WORDING:
    'Order updates cannot mention offers, discounts or coupons (WhatsApp would bill them as marketing)',
  TEMPLATE_PLACEHOLDERS: 'Use exactly the placeholders {{1}}, {{2}}… this message needs',
  TEMPLATE_TOO_LONG: 'Keep the message under 4,000 characters',
};

export async function saveNotificationTemplate(
  db: Tx,
  input: {
    key: string;
    channel: Channel;
    locale: Locale;
    body: string;
    subject?: string | null;
    enabled: boolean;
    /** null = create (fails if someone created it meanwhile). */
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number }> {
  const problem = templateProblem(input);
  if (problem) throw new ValidationError(MESSAGES[problem] ?? problem, problem);
  const body = input.body.trim();
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
          body,
          subject: input.subject ?? null,
          enabled: input.enabled,
          updatedBy: input.staffUserId,
        })
        .onConflictDoNothing()
        .returning({ version: notificationTemplates.version });
    } else {
      [saved] = await tx
        .update(notificationTemplates)
        .set({ body, subject: input.subject ?? null, enabled: input.enabled, updatedBy: input.staffUserId })
        .where(and(where, eq(notificationTemplates.version, input.expectedVersion)))
        .returning({ version: notificationTemplates.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this template; reload and try again', 'STALE_TEMPLATE');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'notification_template.saved',
      entity: 'notification_template',
      entityId: `${input.key}:${input.channel}:${input.locale}`,
      before: before ? { body: before.body, enabled: before.enabled, version: before.version } : null,
      after: { body, enabled: input.enabled, version: saved.version },
    });
    return saved;
  });
}

/**
 * Whether an event should be sent on a channel: an enabled template must exist for it. WhatsApp therefore stays
 * off for an event until staff have written and enabled its template (and the Meta template is approved).
 */
export async function notificationChannelEnabled(db: Tx, key: string, channel: Channel): Promise<boolean> {
  const rows = await db
    .select({ enabled: notificationTemplates.enabled })
    .from(notificationTemplates)
    .where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.channel, channel)));
  return rows.some((r) => r.enabled);
}

export const WHATSAPP_BUDGET_KEY = 'notifications.whatsapp_monthly_budget_paise';

/** Global setting (city null). Returns the value and version, or null when unset. */
export async function getGlobalSetting(
  db: Tx,
  key: string,
): Promise<{ value: unknown; version: number } | null> {
  const [row] = await db
    .select({ value: settings.value, version: settings.version })
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.cityId)));
  return row ?? null;
}

export async function putGlobalSetting(
  db: Tx,
  input: { key: string; value: unknown; expectedVersion: number | null; staffUserId: string },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(settings)
      .where(and(eq(settings.key, input.key), isNull(settings.cityId)));
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(settings)
        .values({ key: input.key, value: input.value, updatedBy: input.staffUserId })
        .onConflictDoNothing()
        .returning({ version: settings.version });
    } else {
      [saved] = await tx
        .update(settings)
        .set({ value: input.value, updatedBy: input.staffUserId })
        .where(
          and(
            eq(settings.key, input.key),
            isNull(settings.cityId),
            eq(settings.version, input.expectedVersion),
          ),
        )
        .returning({ version: settings.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this setting; reload and try again', 'STALE_SETTING');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'setting.saved',
      entity: 'setting',
      entityId: input.key,
      before: before ? { value: before.value, version: before.version } : null,
      after: { value: input.value, version: saved.version },
    });
    return saved;
  });
}

export interface WhatsAppUsage {
  since: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  byCategory: { category: string; billable: number; costPaise: number }[];
  costPaise: number;
}

/**
 * WhatsApp delivery and estimated cost since a date (IST month start for the budget view). Cost = billable
 * delivered messages × the rate per category (millipaise), rounded to whole paise at the end.
 */
export async function whatsAppUsage(
  db: Tx,
  opts: { since: Date; ratesMillipaise?: Readonly<Record<string, number>> },
): Promise<WhatsAppUsage> {
  const rates = opts.ratesMillipaise ?? DEFAULT_WHATSAPP_RATES_MILLIPAISE;
  const base = and(eq(notificationOutbox.channel, 'whatsapp'), gte(notificationOutbox.createdAt, opts.since));
  const [totals] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${notificationOutbox.status} = 'sent')`.mapWith(Number),
      delivered: sql<number>`count(${notificationOutbox.deliveredAt})`.mapWith(Number),
      read: sql<number>`count(${notificationOutbox.readAt})`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${notificationOutbox.status} = 'failed')`.mapWith(Number),
    })
    .from(notificationOutbox)
    .where(base);
  const categories = await db
    .select({
      category: notificationOutbox.pricingCategory,
      billable: sql<number>`count(*)`.mapWith(Number),
    })
    .from(notificationOutbox)
    .where(and(base, eq(notificationOutbox.billable, true)))
    .groupBy(notificationOutbox.pricingCategory);
  let totalMilli = 0;
  const byCategory = categories.map((c) => {
    const category = c.category ?? 'unknown';
    const milli = c.billable * (rates[category] ?? 0);
    totalMilli += milli;
    return { category, billable: c.billable, costPaise: Math.round(milli / 1000) };
  });
  return {
    since: opts.since.toISOString(),
    sent: totals?.sent ?? 0,
    delivered: totals?.delivered ?? 0,
    read: totals?.read ?? 0,
    failed: totals?.failed ?? 0,
    byCategory,
    costPaise: Math.round(totalMilli / 1000),
  };
}

// ----- Emails (design 2026-11-15): code defaults + admin text overrides ---------------------------------------
// One row per template and language in `notification_templates` (channel `email`). No row = the code default and
// switched on. Subject, heading and button label are null for "default"; body is '' for "default". `enabled`
// false = the email is not sent in that language (`emailTemplateEnabled`).

export interface EmailTemplateRecord {
  key: string;
  locale: Locale;
  subject: string | null;
  heading: string | null;
  body: string;
  buttonLabel: string | null;
  enabled: boolean;
  version: number;
  updatedAt: Date;
}

export async function listEmailTemplates(db: Tx): Promise<EmailTemplateRecord[]> {
  const rows = await db
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.channel, 'email'))
    .orderBy(notificationTemplates.key, notificationTemplates.locale);
  return rows.map((r) => ({
    key: r.key,
    locale: r.locale as Locale,
    subject: r.subject,
    heading: r.heading,
    body: r.body,
    buttonLabel: r.buttonLabel,
    enabled: r.enabled,
    version: r.version,
    updatedAt: r.updatedAt,
  }));
}

/**
 * "Send me a test": one outbox row to the signed-in staff member's own verified address, with the template's
 * sample data (never real customer data), through the same dispatcher and Resend path as real mail. It ignores the
 * on/off switch (to try a template before switching it on) and is audited. Marked `test` so the subject says so.
 */
export async function queueEmailTest(
  db: Tx,
  input: { key: string; locale: Locale; staffUserId: string },
): Promise<void> {
  if (!isEmailTemplateKey(input.key))
    throw new ValidationError(EMAIL_MESSAGES.EMAIL_UNKNOWN_TEMPLATE ?? '', 'EMAIL_UNKNOWN_TEMPLATE');
  const key = input.key;
  await db.transaction(async (tx) => {
    const [me] = await tx
      .select({ email: users.email, verified: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, input.staffUserId))
      .limit(1);
    if (!me?.email || !me.verified)
      throw new ValidationError('Your own email address is not verified', 'EMAIL_TEST_NO_ADDRESS');
    await enqueueNotification(tx, {
      dedupeKey: `email_test:${key}:${crypto.randomUUID()}`,
      channel: 'email',
      recipientUserId: input.staffUserId,
      recipient: me.email,
      templateKey: key,
      locale: input.locale,
      payload: { ...sampleEmailParams(key), test: 'true' },
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'email_template.test_sent',
      entity: 'email_template',
      entityId: `${key}:${input.locale}`,
    });
  });
}

/** The admin's text override for one email and language at send time (null = code defaults). */
export async function emailOverrideFor(
  db: Tx,
  key: string,
  locale: Locale,
): Promise<{
  subject: string | null;
  heading: string | null;
  body: string;
  buttonLabel: string | null;
} | null> {
  const [row] = await db
    .select({
      subject: notificationTemplates.subject,
      heading: notificationTemplates.heading,
      body: notificationTemplates.body,
      buttonLabel: notificationTemplates.buttonLabel,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.key, key),
        eq(notificationTemplates.channel, 'email'),
        eq(notificationTemplates.locale, locale),
      ),
    )
    .limit(1);
  return row ?? null;
}

const EMAIL_MESSAGES: Record<string, string> = {
  EMAIL_UNKNOWN_TEMPLATE: 'This email does not exist',
  EMAIL_PLACEHOLDER: 'Use only the placeholders listed for this email, in curly brackets',
  EMAIL_HTML: 'Write plain text: the layout is fixed and HTML is not allowed',
  EMAIL_SUBJECT_LINES: 'The subject must be one line',
  EMAIL_TOO_LONG: 'The text is too long',
};

const blankToNull = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);

export async function saveEmailTemplate(
  db: Tx,
  input: {
    key: string;
    locale: Locale;
    subject?: string | null;
    heading?: string | null;
    body?: string | null;
    buttonLabel?: string | null;
    enabled: boolean;
    /** null = create (fails if someone created it meanwhile). */
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number }> {
  const text = {
    subject: blankToNull(input.subject),
    heading: blankToNull(input.heading),
    body: blankToNull(input.body) ?? '',
    buttonLabel: blankToNull(input.buttonLabel),
  };
  const problem = emailOverrideProblem(input.key, text);
  if (problem) throw new ValidationError(EMAIL_MESSAGES[problem] ?? problem, problem);
  return db.transaction(async (tx) => {
    const where = and(
      eq(notificationTemplates.key, input.key),
      eq(notificationTemplates.channel, 'email'),
      eq(notificationTemplates.locale, input.locale),
    );
    const [before] = await tx.select().from(notificationTemplates).where(where);
    let saved: { version: number } | undefined;
    if (input.expectedVersion === null) {
      [saved] = await tx
        .insert(notificationTemplates)
        .values({
          key: input.key,
          channel: 'email',
          locale: input.locale,
          ...text,
          enabled: input.enabled,
          updatedBy: input.staffUserId,
        })
        .onConflictDoNothing()
        .returning({ version: notificationTemplates.version });
    } else {
      [saved] = await tx
        .update(notificationTemplates)
        .set({ ...text, enabled: input.enabled, updatedBy: input.staffUserId })
        .where(and(where, eq(notificationTemplates.version, input.expectedVersion)))
        .returning({ version: notificationTemplates.version });
    }
    if (!saved)
      throw new ConflictError('Someone else changed this email; reload and try again', 'STALE_TEMPLATE');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'email_template.saved',
      entity: 'email_template',
      entityId: `${input.key}:${input.locale}`,
      before: before
        ? {
            subject: before.subject,
            heading: before.heading,
            body: before.body,
            buttonLabel: before.buttonLabel,
            enabled: before.enabled,
            version: before.version,
          }
        : null,
      after: { ...text, enabled: input.enabled, version: saved.version },
    });
    return saved;
  });
}

/**
 * Back to the code default text for one language (compare-and-set, audited). The on/off switch is kept: a
 * switched-off email stays off until staff switch it on; an "on" email with no text left simply loses its row.
 */
export async function resetEmailTemplate(
  db: Tx,
  input: { key: string; locale: Locale; expectedVersion: number; staffUserId: string },
): Promise<{ version: number | null }> {
  if (!isEmailTemplateKey(input.key))
    throw new ValidationError(EMAIL_MESSAGES.EMAIL_UNKNOWN_TEMPLATE ?? '', 'EMAIL_UNKNOWN_TEMPLATE');
  return db.transaction(async (tx) => {
    const where = and(
      eq(notificationTemplates.key, input.key),
      eq(notificationTemplates.channel, 'email'),
      eq(notificationTemplates.locale, input.locale),
      eq(notificationTemplates.version, input.expectedVersion),
    );
    const [before] = await tx.select().from(notificationTemplates).where(where).for('update');
    if (!before)
      throw new ConflictError('Someone else changed this email; reload and try again', 'STALE_TEMPLATE');
    let version: number | null = null;
    if (before.enabled) {
      await tx.delete(notificationTemplates).where(where);
    } else {
      const [row] = await tx
        .update(notificationTemplates)
        .set({ subject: null, heading: null, body: '', buttonLabel: null, updatedBy: input.staffUserId })
        .where(where)
        .returning({ version: notificationTemplates.version });
      version = row?.version ?? null;
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'email_template.reset',
      entity: 'email_template',
      entityId: `${input.key}:${input.locale}`,
      before: {
        subject: before.subject,
        heading: before.heading,
        body: before.body,
        buttonLabel: before.buttonLabel,
        enabled: before.enabled,
        version: before.version,
      },
      after: { reset: true },
    });
    return { version };
  });
}
