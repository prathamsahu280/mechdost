'use client';

import Link from 'next/link';
import { CircleCheck, ClipboardList, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { Notice, NoticePriority } from '@mechdost/shared/notice-api';
import { noticeTime, PRIORITY_VIEW } from '@/lib/notices-view';

/** The tile icon of each priority: a different shape each, so colour is never the only signal (WCAG 1.4.1). */
const ICONS: Record<NoticePriority, LucideIcon> = {
  urgent: TriangleAlert,
  action: ClipboardList,
  info: Info,
  success: CircleCheck,
};

/**
 * The row that held focus is about to leave the page: move focus to the next row (else the previous one, else the
 * list's heading) so a keyboard or screen-reader user keeps their place (WCAG 2.4.3).
 */
export function keepFocus(from: HTMLElement): void {
  const li = from.closest('li');
  const sibling = li?.nextElementSibling ?? li?.previousElementSibling ?? null;
  const target =
    sibling?.querySelector<HTMLElement>('a[href], button') ??
    from.closest('[data-notice-root]')?.querySelector<HTMLElement>('[data-notice-heading]') ??
    null;
  target?.focus();
}

/** The words one notification row needs; the bell gets them as props, the centre page from next-intl. */
export interface NoticeItemCopy {
  unread: string;
  /** Visible text label of each priority ("Urgent", "Needs you", "Update", "Good news"). */
  priority: Record<NoticePriority, string>;
  /** "Remove notification: {title}" (the `{title}` is filled in here). */
  removeNamed: string;
}

/**
 * One notification, used by the bell dropdown and the notification centre (spec 10). A link to the page it is about,
 * with a Remove button beside it (a sibling, never nested). Priority shows as a left bar, a tile with its own icon and
 * a text label, so it never depends on colour. Unread ones have a bolder title, a dot and a "New" tag; read ones are
 * quieter. Long titles wrap, never clip (long Hindi titles, state audit).
 */
export function NoticeItem({
  notice,
  locale,
  copy,
  onOpen,
  onRemove,
}: {
  notice: Notice;
  locale: string;
  copy: NoticeItemCopy;
  onOpen: (n: Notice) => void;
  onRemove: (n: Notice) => void;
}) {
  const view = PRIORITY_VIEW[notice.priority];
  const Icon = ICONS[notice.priority];
  const unread = !notice.read;
  const content = (
    <>
      <span
        aria-hidden="true"
        className={`grid size-[34px] shrink-0 place-items-center rounded-[10px] ${view.tile}`}
      >
        <Icon className="size-[17px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          <span className={`font-bold ${view.label}`}>{copy.priority[notice.priority]}</span>
          <span aria-hidden="true">·</span>
          <span>{noticeTime(notice.createdAt, locale)}</span>
        </span>
        <span className="flex items-start gap-2">
          {unread ? (
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-button" />
          ) : null}
          <span
            className={`min-w-0 text-[14px] leading-snug break-words text-ink ${
              unread ? 'font-extrabold' : 'font-medium'
            }`}
          >
            {notice.title}
          </span>
          {unread ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-accent-soft-text uppercase">
              {copy.unread}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug break-words text-muted">{notice.body}</span>
      </span>
    </>
  );
  const rowClass = `flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-xl py-2.5 pr-1 pl-3.5 hover:bg-pill focus-visible:bg-pill ${
    unread ? '' : 'opacity-90'
  }`;
  return (
    <div className="relative flex items-start gap-0.5 rounded-xl">
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 left-0 w-1 rounded-full ${view.bar} ${unread ? '' : 'opacity-70'}`}
      />
      {notice.link ? (
        <Link
          href={notice.link}
          className={rowClass}
          onClick={() => {
            onOpen(notice);
          }}
        >
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      <button
        type="button"
        aria-label={copy.removeNamed.replace('{title}', notice.title)}
        onClick={(e) => {
          keepFocus(e.currentTarget);
          onRemove(notice);
        }}
        className="press inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-pill hover:text-ink"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
