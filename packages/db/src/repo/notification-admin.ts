import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_WHATSAPP_RATES_MILLIPAISE,
  WHATSAPP_TEMPLATES,
  isWhatsAppTemplateKey,
  placeholderProblem,
  utilityTemplateProblem,
} from '@mechdost/shared/whatsapp';
import { auditLog, notificationOutbox, notificationTemplates, settings } from '../schema';
import { ConflictError, ValidationError } from './errors';
import type { Channel, Locale } from './notify';
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
