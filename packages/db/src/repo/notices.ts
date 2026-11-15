import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  composeNotice,
  noticeLink,
  NOTICE_CATALOGUE,
  type NoticeKind,
  type NoticeOverride,
} from '@mechdost/shared/notice-catalogue';
import {
  BELL_BADGE_MAX,
  type Notice,
  type NoticePage,
  type NoticePreferences,
} from '@mechdost/shared/notice-api';
import type { Permission } from '@mechdost/shared/rbac';
import {
  consents,
  notificationPreferences,
  notificationTemplates,
  notifications,
  pushDevices,
  users,
} from '../schema';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import { STAFF_WITH } from './live';
import { enqueueNotification, type Locale } from './notify';
import type { Tx } from './orders';
import { globalIntSetting } from './settings-admin';
import { rowsOf } from './sql-rows';

/**
 * In-app notifications and web push (spec 10, design 2026-11-15). The one writer is `queueNotice`; callers invoke it
 * inside the transaction of the change they announce, so a rolled-back change never notifies and a retried one
 * notifies once (the dedupe key is UNIQUE per person). Per recipient it writes:
 * - the in-app row (always, for transactional and reminder kinds: the bell cannot be switched off), already in the
 *   person's language;
 * - one `push` outbox row, only if the person has a live device and has not switched push off for the category.
 * Promotional kinds need the marketing consent, the promotional preference and the weekly cap on top.
 */

/** Values the text may use; only the kind's closed placeholder list is read, everything else is dropped. */
export type NoticeParams = Record<string, string | number>;

export interface QueueNoticeInput {
  kind: NoticeKind;
  userId: string;
  /** What it is about (order id, assignment id, refund id…): with the version it forms the dedupe key. */
  entityId: string;
  version: number | string;
  /** Placeholder values; a function gets the person's language (phrases are localized by the caller). */
  params: NoticeParams | ((locale: Locale) => NoticeParams);
  /** The page it opens may need codes the text does not; defaults to `params`. */
  linkParams?: NoticeParams;
}

const stringify = (p: NoticeParams): Record<string, string> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));

/** `notification_templates` overrides for a kind and language: the bell text and, if set, the push text. */
async function overrides(
  tx: Tx,
  kind: NoticeKind,
  locale: Locale,
): Promise<{
  inapp: NoticeOverride | null;
  push: NoticeOverride | null;
  off: { inapp: boolean; push: boolean };
}> {
  const rows = await tx
    .select({
      channel: notificationTemplates.channel,
      subject: notificationTemplates.subject,
      body: notificationTemplates.body,
      enabled: notificationTemplates.enabled,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.key, kind),
        eq(notificationTemplates.locale, locale),
        inArray(notificationTemplates.channel, ['inapp', 'push']),
      ),
    );
  const pick = (channel: string): NoticeOverride | null => {
    const r = rows.find((x) => x.channel === channel);
    return r ? { title: r.subject, body: r.body } : null;
  };
  const disabled = (channel: string) => rows.some((x) => x.channel === channel && !x.enabled);
  return {
    inapp: pick('inapp'),
    push: pick('push'),
    off: { inapp: disabled('inapp'), push: disabled('push') },
  };
}

/** Whether the person has the marketing consent right now (the latest consent row says granted). */
export async function hasMarketingConsent(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.purpose, 'marketing')))
    .orderBy(desc(consents.createdAt), desc(consents.id))
    .limit(1);
  return row?.granted ?? false;
}

async function preferenceOn(
  tx: Tx,
  userId: string,
  channel: 'push' | 'inapp',
  category: 'transactional' | 'promotional' | 'reminders',
): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channel, channel),
        eq(notificationPreferences.category, category),
      ),
    )
    .limit(1);
  // No row: order, booking and reminder messages are on; promotions are off until the person says yes.
  return row?.enabled ?? category !== 'promotional';
}

async function hasLiveDevice(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: pushDevices.id })
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.revokedAt)))
    .limit(1);
  return row !== undefined;
}

/** Promotions already sent to this person in the last 7 days (in-app rows are written for each). */
async function promotionsThisWeek(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.category, 'promotional'),
        sql`${notifications.createdAt} > now() - interval '7 days'`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Writes the bell row and, when wanted, the push outbox row for one person. Returns true when a new in-app row was
 * written (false: already written for this change, person inactive, switched off, or capped).
 */
export async function queueNotice(tx: Tx, input: QueueNoticeInput): Promise<boolean> {
  const def = NOTICE_CATALOGUE[input.kind];
  const [user] = await tx
    .select({ language: users.language, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (user?.status !== 'active') return false;
  const locale: Locale = user.language === 'hi' ? 'hi' : 'en';

  if (def.category === 'promotional') {
    if (!(await hasMarketingConsent(tx, input.userId))) return false;
    if (!(await preferenceOn(tx, input.userId, 'inapp', 'promotional'))) return false;
    if (
      (await promotionsThisWeek(tx, input.userId)) >=
      (await globalIntSetting(tx, 'notifications.promo_per_week'))
    )
      return false;
  }

  const raw = typeof input.params === 'function' ? input.params(locale) : input.params;
  const params = stringify(raw);
  const custom = await overrides(tx, input.kind, locale);
  if (custom.off.inapp) return false;
  const text = composeNotice(input.kind, locale, params, custom.inapp);
  const link = noticeLink(input.kind, locale, stringify(input.linkParams ?? raw));
  const dedupe = `${input.kind}:${input.entityId}:v${String(input.version)}`;

  const inserted = await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      category: def.category,
      kind: input.kind,
      entityType: def.entity,
      entityId: input.entityId,
      dedupeKey: dedupe,
      title: text.title,
      body: text.body,
      link,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (inserted.length === 0) return false;

  if (custom.off.push) return true;
  if (!(await preferenceOn(tx, input.userId, 'push', def.category))) return true;
  if (!(await hasLiveDevice(tx, input.userId))) return true;
  const push = custom.push ? composeNotice(input.kind, locale, params, custom.push) : text;
  await enqueueNotification(tx, {
    dedupeKey: `${dedupe}:${input.userId}:push`,
    channel: 'push',
    recipientUserId: input.userId,
    templateKey: input.kind,
    locale,
    // Title, short body and link only: no address, phone or amount on a lock screen.
    payload: { title: push.title, body: push.body, link },
  });
  return true;
}

/** People holding `permission` for the city (custom roles count; partner-scoped grants never do). */
export async function staffRecipients(
  tx: Tx,
  permission: Permission,
  cityId: string | null,
): Promise<string[]> {
  const rows = rowsOf<{ user_id: string }>(
    await tx.execute(STAFF_WITH(permission, sql`select ${cityId}::uuid`)),
  );
  return [...new Set(rows.map((r) => r.user_id))];
}

const STAFF_PERMISSION = {
  'staff.order_needs_routing': 'orders:route',
  'staff.shop_declined': 'orders:route',
  'staff.shop_timed_out': 'orders:route',
  'staff.shop_gave_up': 'orders:route',
  'staff.refund_overdue': 'refunds:approve',
  'staff.new_application': 'applications:review',
  'staff.new_ticket': 'tickets:reply',
} as const satisfies Partial<Record<NoticeKind, Permission>>;

export type StaffNoticeKind = keyof typeof STAFF_PERMISSION;

/**
 * A notice for the staff of a city: whoever holds the kind's permission there (the same rule that picks who gets
 * a live ping and who the API lets read the thing). Several staff, one row each.
 */
export async function queueStaffNotice(
  tx: Tx,
  input: {
    kind: StaffNoticeKind;
    cityId: string | null;
    entityId: string;
    version: number | string;
    params?: NoticeParams;
  },
): Promise<number> {
  let written = 0;
  for (const userId of await staffRecipients(tx, STAFF_PERMISSION[input.kind], input.cityId)) {
    if (
      await queueNotice(tx, {
        kind: input.kind,
        userId,
        entityId: input.entityId,
        version: input.version,
        params: input.params ?? {},
      })
    )
      written += 1;
  }
  return written;
}

// ── The bell and the centre page ──────────────────────────────────────────────────────────────────────────────

const viewOf = (r: typeof notifications.$inferSelect): Notice => ({
  id: r.id,
  kind: r.kind,
  category: r.category as Notice['category'],
  title: r.title,
  body: r.body,
  link: r.link,
  read: r.readAt !== null,
  createdAt: r.createdAt.toISOString(),
});

/** Unread count, stopped at one past the badge maximum so a person with thousands costs one short index scan. */
export async function unreadNoticeCount(tx: Tx, userId: string): Promise<number> {
  const [row] = rowsOf<{ n: number }>(
    await tx.execute(sql`
      select count(*)::int as n from (
        select 1 from notifications where user_id = ${userId} and read_at is null limit ${BELL_BADGE_MAX + 1}
      ) unread`),
  );
  return row?.n ?? 0;
}

/** The person's notifications, newest first, by keyset cursor (hard rule 7). Only their own rows exist for them. */
export async function listNotices(
  tx: Tx,
  userId: string,
  opts: { cursor?: string | undefined; limit?: number | undefined },
): Promise<NoticePage> {
  const size = pageSize(opts.limit, 10, 50);
  const after = opts.cursor ? decodeCursor(opts.cursor, 'timestamp') : null;
  const rows = await tx
    .select({ row: notifications, k: sql<string>`${notifications.createdAt}::text` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        after
          ? sql`(${notifications.createdAt}, ${notifications.id}) < (${after.k}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(size + 1);
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    notices: page.map((r) => viewOf(r.row)),
    nextCursor: rows.length > size && last ? encodeCursor({ k: last.k, id: last.row.id }) : null,
    unread: await unreadNoticeCount(tx, userId),
  };
}

/** Marks the person's own rows read (ids or everything unread); a foreign id changes nothing. */
export async function markNoticesRead(
  tx: Tx,
  userId: string,
  which: { ids: string[] } | { all: true },
): Promise<{ updated: number; unread: number }> {
  const rows = await tx
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        'ids' in which ? inArray(notifications.id, which.ids) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return { updated: rows.length, unread: await unreadNoticeCount(tx, userId) };
}

/** Daily retention: deletes the bell rows older than `days`, in batches so one run never holds a long lock. */
export async function purgeOldNotices(tx: Tx, days: number, batch = 5000): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = rowsOf<{ id: string }>(
      await tx.execute(sql`
        delete from notifications where id in (
          select id from notifications where created_at < now() - make_interval(days => ${days}) limit ${batch}
        ) returning id`),
    );
    total += rows.length;
    if (rows.length < batch) return total;
  }
}

// ── Preferences ───────────────────────────────────────────────────────────────────────────────────────────────

export async function getNoticePreferences(tx: Tx, userId: string): Promise<NoticePreferences> {
  return {
    pushTransactional: await preferenceOn(tx, userId, 'push', 'transactional'),
    promotions:
      (await hasMarketingConsent(tx, userId)) && (await preferenceOn(tx, userId, 'push', 'promotional')),
  };
}

const upsertPreference = (
  tx: Tx,
  userId: string,
  channel: 'push' | 'inapp',
  category: 'transactional' | 'promotional' | 'reminders',
  enabled: boolean,
) =>
  tx
    .insert(notificationPreferences)
    .values({ userId, channel, category, enabled })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.channel,
        notificationPreferences.category,
      ],
      set: { enabled },
    });

/**
 * Switches the person's own choices. Push for updates covers the transactional and reminder categories at once.
 * Promotions write an append-only consent row (purpose `marketing`, the notice version shown) and both promotional
 * preferences, so withdrawing is as easy as granting and the history is kept (DPDP).
 */
export async function setNoticePreferences(
  tx: Tx,
  userId: string,
  change: Partial<NoticePreferences>,
  noticeVersion: string,
  source: 'account_notifications' | 'account_privacy' = 'account_notifications',
): Promise<NoticePreferences> {
  if (change.pushTransactional !== undefined) {
    await upsertPreference(tx, userId, 'push', 'transactional', change.pushTransactional);
    await upsertPreference(tx, userId, 'push', 'reminders', change.pushTransactional);
  }
  if (change.promotions !== undefined) {
    const current = await hasMarketingConsent(tx, userId);
    if (current !== change.promotions) {
      await tx.insert(consents).values({
        userId,
        purpose: 'marketing',
        granted: change.promotions,
        noticeVersion,
        source,
      });
      await recordServerEvent(tx, 'marketing_consent_changed', {
        userId,
        props: { granted: change.promotions, noticeVersion },
      });
    }
    await upsertPreference(tx, userId, 'push', 'promotional', change.promotions);
    await upsertPreference(tx, userId, 'inapp', 'promotional', change.promotions);
  }
  return getNoticePreferences(tx, userId);
}

// ── Devices ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PushDeviceInput {
  token: string;
  locale: Locale;
  uaFamily: 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';
}

/**
 * Registers or refreshes this browser's token. One row per token: a browser that signs in as someone else moves the
 * token to the new person (and clears a revocation), so the old person's messages never reach it.
 */
export async function registerPushDevice(
  tx: Tx,
  userId: string,
  input: PushDeviceInput,
  max: number,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(pushDevices)
    .values({ userId, fcmToken: input.token, locale: input.locale, uaFamily: input.uaFamily })
    .onConflictDoUpdate({
      target: pushDevices.fcmToken,
      set: {
        userId,
        locale: input.locale,
        uaFamily: input.uaFamily,
        lastSeenAt: sql`now()`,
        revokedAt: null,
      },
    })
    .returning({ id: pushDevices.id });
  if (!row) throw new Error('push device upsert returned no row');
  // Keep the newest `max` live devices; older ones are revoked (a replaced phone must not keep receiving).
  await tx.execute(sql`
    update push_devices set revoked_at = now()
    where user_id = ${userId} and revoked_at is null and id in (
      select id from push_devices where user_id = ${userId} and revoked_at is null
      order by last_seen_at desc, id desc offset ${max}
    )`);
  return row;
}

/** Turns this device off for its owner. Another person's id is 404, never a hint that it exists. */
export async function revokePushDevice(tx: Tx, userId: string, deviceId: string): Promise<void> {
  const rows = await tx
    .update(pushDevices)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(pushDevices.id, deviceId), eq(pushDevices.userId, userId)))
    .returning({ id: pushDevices.id });
  if (rows.length === 0) throw new NotFoundError('Device not found');
}

/** The person's live tokens, for the dispatcher. */
export async function livePushTokens(tx: Tx, userId: string): Promise<{ id: string; token: string }[]> {
  return tx
    .select({ id: pushDevices.id, token: pushDevices.fcmToken })
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.revokedAt)));
}

/** Firebase said these tokens are gone (unregistered, invalid): revoked so we stop sending to them. */
export async function revokePushTokens(tx: Tx, tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  await tx
    .update(pushDevices)
    .set({ revokedAt: sql`now()` })
    .where(and(inArray(pushDevices.fcmToken, [...tokens]), isNull(pushDevices.revokedAt)));
}

// ── Scheduled alerts (small worker jobs) ───────────────────────────────────────────────────────────────────

/**
 * Shops with an order offer about to expire are reminded once (`minutes` before it runs out; dedupe per offer).
 * Called every minute by the worker; offers already past their time are the expiry job's, not ours.
 */
export async function queueOfferExpiryReminders(tx: Tx, minutes: number): Promise<number> {
  if (minutes <= 0) return 0;
  const due = rowsOf<{ id: string; shop_id: string; code: string; mins: number }>(
    await tx.execute(sql`
      select a.id, a.shop_id, g.code,
             greatest(1, ceil(extract(epoch from (a.expires_at - now())) / 60))::int as mins
      from order_assignments a
      join orders o on o.id = a.order_id
      join order_groups g on g.id = o.group_id
      where a.status = 'offered' and a.expires_at > now()
        and a.expires_at <= now() + make_interval(mins => ${minutes})
      order by a.expires_at limit 200`),
  );
  let sent = 0;
  for (const offer of due) {
    const people = rowsOf<{ user_id: string }>(
      await tx.execute(sql`select user_id from shop_users where shop_id = ${offer.shop_id}`),
    );
    for (const p of people)
      if (
        await queueNotice(tx, {
          kind: 'shop.offer_expiring',
          userId: p.user_id,
          entityId: offer.id,
          version: 1,
          params: { orderCode: offer.code, minutes: offer.mins },
        })
      )
        sent += 1;
  }
  return sent;
}

/**
 * Refund requests waiting past the approval SLA (`refunds.approval_sla_hours`) alert the finance staff of the order's
 * city once each (dedupe per refund). Called hourly by the worker.
 */
export async function queueRefundOverdueAlerts(tx: Tx, slaHours: number): Promise<number> {
  const due = rowsOf<{ id: string; code: string; city_id: string | null }>(
    await tx.execute(sql`
      select r.id, g.code,
             (select o.city_id from orders o where o.group_id = r.group_id order by o.created_at limit 1) as city_id
      from refunds r join order_groups g on g.id = r.group_id
      where r.status = 'requested' and r.created_at < now() - make_interval(hours => ${slaHours})
      order by r.created_at limit 200`),
  );
  let sent = 0;
  for (const r of due)
    sent += await queueStaffNotice(tx, {
      kind: 'staff.refund_overdue',
      cityId: r.city_id,
      entityId: r.id,
      version: 1,
      params: { orderCode: r.code },
    });
  return sent;
}
