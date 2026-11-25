import { BELL_BADGE_MAX, noticeBucket, type Notice, type NoticePriority } from '@mechdost/shared/notice-api';

/**
 * Small pure helpers for the bell and the notification centre (design 2026-11-15; spec 10). No React, no i18n
 * runtime: the always-loaded header shell and the lazy chunks both use them.
 */

/** Window event the bell fires when new notifications arrive; screens that list the same things refetch on it. */
export const NOTICES_EVENT = 'mechdost:notices';
export interface NoticesEventDetail {
  /** Kinds of the notifications that just arrived (`shop.order_routed`, `order.confirmed`…). */
  kinds: string[];
}

/** Polling pace by role: partners and staff wait on live orders (15 s), customers 60 s; hidden tabs do not poll. */
export const POLL_MS = { portal: 15_000, customer: 60_000, maxBackoff: 300_000 } as const;
export const pollInterval = (role: string, failures: number): number => {
  const base = role === 'customer' ? POLL_MS.customer : POLL_MS.portal;
  return Math.min(base * 2 ** Math.min(failures, 5), POLL_MS.maxBackoff);
};

/** What the badge shows: nothing for 0, the number up to 99, then "99+" (the text comes from the locale). */
export const badgeText = (unread: number, more: string): string =>
  unread <= 0 ? '' : unread > BELL_BADGE_MAX ? more : String(unread);

/** `{count}` templates (the same trick the compare tray uses): no ICU runtime in the header. */
export const withCount = (template: string, count: string | number): string =>
  template.replace('{count}', String(count));

/** The sentence a screen reader hears when the count changes ("3 new notifications", "99+ new notifications"). */
export const liveText = (
  unread: number,
  copy: { liveOne: string; liveOther: string; more: string },
): string =>
  unread <= 0 ? '' : unread === 1 ? copy.liveOne : withCount(copy.liveOther, badgeText(unread, copy.more));

/** Notifications that appeared since the last poll: newer than every id we already knew about. */
export function arrivedSince(known: ReadonlySet<string>, latest: readonly Notice[]): Notice[] {
  return latest.filter((n) => !known.has(n.id));
}

/** Where "empty state" sends each role (one next action): shoppers to the shop, partners and staff to their portal. */
export const emptyActionFor = (role: string): { href: string; shop: boolean } =>
  role === 'admin'
    ? { href: '/admin', shop: false }
    : role === 'shop'
      ? { href: '/partner/shop', shop: false }
      : role === 'workshop'
        ? { href: '/partner/workshop', shop: false }
        : { href: '/shop', shop: true };

/** The tag a notification carries: "New" while unread; "Done" once its action was taken care of (never "New"). */
export const noticeTag = (n: Pick<Notice, 'read' | 'resolved'>): 'new' | 'done' | null =>
  n.resolved ? 'done' : n.read ? null : 'new';

/**
 * How each priority looks (spec 10, design-system "Notice priority"). Existing tokens only: error red, accent orange,
 * muted navy, success green. Never colour alone: each also has its own icon (lucide name, drawn by `NoticeItem`) and a
 * visible text label (`bell.<key>` in the locale files). `bar` is the left bar, `tile` the icon tile, `label` the
 * label colour; light and dark come from the tokens.
 */
export const PRIORITY_VIEW = {
  urgent: {
    icon: 'TriangleAlert',
    bar: 'bg-error',
    tile: 'bg-error/10 text-error',
    label: 'text-error',
    key: 'priorityUrgent',
  },
  action: {
    icon: 'ClipboardList',
    bar: 'bg-accent-button',
    tile: 'bg-accent-soft text-accent-soft-text',
    label: 'text-accent-soft-text',
    key: 'priorityAction',
  },
  info: {
    icon: 'Info',
    bar: 'bg-muted',
    tile: 'bg-pill text-muted',
    label: 'text-muted',
    key: 'priorityInfo',
  },
  success: {
    icon: 'CircleCheck',
    bar: 'bg-success',
    tile: 'bg-success-bg text-success',
    label: 'text-success',
    key: 'prioritySuccess',
  },
} as const satisfies Record<
  NoticePriority,
  { icon: string; bar: string; tile: string; label: string; key: string }
>;

/**
 * The order the server returns: unread urgent, unread, read; newest first inside each group. The page never
 * re-sorts (the server's cursor depends on it); this mirror is for tests and for placing an item optimistically.
 */
export function priorityOrder(
  a: Pick<Notice, 'read' | 'priority' | 'createdAt'>,
  b: Pick<Notice, 'read' | 'priority' | 'createdAt'>,
): number {
  return (
    noticeBucket(a) - noticeBucket(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
  );
}

/** "Cleared {count} read notifications" with the number filled in (no i18n runtime in the bell chunk). */
export const undoCountText = (template: string, count: number): string => withCount(template, count);

/** "12 Nov, 4:05 pm" in the person's language, India time. */
export function noticeTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}
