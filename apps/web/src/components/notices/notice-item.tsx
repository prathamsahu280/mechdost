'use client';

import Link from 'next/link';
import type { Notice } from '@mechdost/shared/notice-api';
import { noticeTime } from '@/lib/notices-view';

/**
 * One notification, used by the bell dropdown and the notification centre (spec 10). A link to the page it is about;
 * unread ones carry a visible "New" tag (not colour alone) and a left bar. Long titles wrap, never clip (long Hindi
 * titles, state audit).
 */
export function NoticeItem({
  notice,
  locale,
  newLabel,
  onOpen,
}: {
  notice: Notice;
  locale: string;
  newLabel: string;
  onOpen: (n: Notice) => void;
}) {
  const content = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-[14px] leading-snug font-bold break-words text-ink">
          {notice.title}
        </span>
        {notice.read ? null : (
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-accent-soft-text uppercase">
            {newLabel}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-[13px] leading-snug break-words text-muted">{notice.body}</span>
      <span className="mt-1 block text-[11px] text-muted">{noticeTime(notice.createdAt, locale)}</span>
    </>
  );
  const className = `block min-h-11 border-l-4 px-4 py-3 hover:bg-pill focus-visible:bg-pill ${
    notice.read ? 'border-transparent' : 'border-accent'
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
