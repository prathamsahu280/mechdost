'use client';

import Link from 'next/link';
import { Bell, Package, Tag, Wrench, type LucideIcon } from 'lucide-react';
import type { Notice } from '@mechdost/shared/notice-api';
import { noticeTag, noticeTime } from '@/lib/notices-view';

/** The tile icon by the family of the notification kind (`order.confirmed` → order). */
function iconFor(kind: string | null): LucideIcon {
  const family = kind?.split('.')[0] ?? '';
  if (family === 'order') return Package;
  if (['service', 'request', 'workshop', 'booking', 'estimate'].includes(family)) return Wrench;
  if (['quote', 'price', 'coupon', 'offer'].includes(family)) return Tag;
  return Bell;
}

/**
 * One notification, used by the bell dropdown and the notification centre (spec 10). A link to the page it is about;
 * unread ones carry a visible "New" tag (not colour alone); ones whose action is already taken care of (order routed,
 * refund decided…) carry "Done" and are muted, never "New". Long titles wrap, never clip (long Hindi
 * titles, state audit).
 */
export function NoticeItem({
  notice,
  locale,
  newLabel,
  doneLabel,
  onOpen,
}: {
  notice: Notice;
  locale: string;
  newLabel: string;
  doneLabel: string;
  onOpen: (n: Notice) => void;
}) {
  const Icon = iconFor(notice.kind);
  const tag = noticeTag(notice);
  const content = (
    <>
      <span
        aria-hidden="true"
        className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent-soft-text"
      >
        <Icon className="size-[17px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-[14px] leading-snug font-bold break-words text-ink">
            {notice.title}
          </span>
          {tag === 'new' ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-accent-soft-text uppercase">
              {newLabel}
            </span>
          ) : tag === 'done' ? (
            <span className="shrink-0 rounded-full bg-pill px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-muted uppercase">
              {doneLabel}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug break-words text-muted">{notice.body}</span>
        <span className="mt-1 block text-[11px] text-muted">{noticeTime(notice.createdAt, locale)}</span>
      </span>
    </>
  );
  const className = `flex min-h-11 items-start gap-2.5 rounded-xl px-2.5 py-2.5 hover:bg-pill focus-visible:bg-pill${
    tag === 'done' ? ' opacity-75' : ''
  }`;
  return notice.link ? (
    <Link
      href={notice.link}
      className={className}
      onClick={() => {
        onOpen(notice);
      }}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
