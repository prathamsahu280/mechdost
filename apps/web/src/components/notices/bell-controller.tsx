'use client';

import Link from 'next/link';
import { Bell as BellIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { BELL_PAGE_SIZE, type Notice } from '@mechdost/shared/notice-api';
import { track } from '@/lib/analytics';
import { badgeText, emptyActionFor, liveText, withCount } from '@/lib/notices-view';
import type { BellCopy } from './bell-copy';
import { FeedToast } from './feed-toast';
import { NoticeItem, type NoticeItemCopy } from './notice-item';
import { useNoticeFeed } from './use-notice-feed';

/**
 * The bell in the header (spec 10, design 2026-11-15): unread badge, a polite live region that says "3 new
 * notifications" when the count changes, and a dropdown with the latest ten and a link to the whole list. Loaded as a
 * separate chunk only for a signed-in person (see `bell.tsx`). Non-modal: Escape or a tap outside closes it and gives
 * focus back to the bell.
 */
export default function BellController({
  copy,
  prefix,
  locale,
  role,
}: {
  copy: BellCopy;
  prefix: string;
  locale: string;
  role: string;
}) {
  const feed = useNoticeFeed({ locale, role, limit: BELL_PAGE_SIZE });
  const [open, setOpen] = useState(false);
  // Only an increase is announced ("3 new notifications"): reading or removing must not talk over the toast.
  const [announce, setAnnounce] = useState(0);
  const seenUnread = useRef(0);
  useEffect(() => {
    setAnnounce(feed.unread > seenUnread.current ? feed.unread : 0);
    seenUnread.current = feed.unread;
  }, [feed.unread]);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const badge = badgeText(feed.unread, copy.more);
  const label = feed.unread > 0 ? withCount(copy.labelUnread, badge) : copy.label;
  const action = emptyActionFor(role);

  const itemCopy: NoticeItemCopy = {
    unread: copy.unread,
    priority: {
      urgent: copy.priorityUrgent,
      action: copy.priorityAction,
      info: copy.priorityInfo,
      success: copy.prioritySuccess,
    },
    removeNamed: copy.removeNamed,
  };
  const hasRead = feed.notices.some((n) => n.read);

  /** The button that was pressed leaves the page: keep focus in the panel. */
  const focusHeading = () => {
    root.current?.querySelector<HTMLElement>('[data-notice-heading]')?.focus();
  };

  const onRemove = (n: Notice) => {
    track('notification_dismissed', { kind: n.kind, priority: n.priority, channel: 'bell' });
    feed.remove(n);
  };
  const onClearRead = () => {
    track('notifications_cleared', { count: feed.notices.filter((n) => n.read).length, channel: 'bell' });
    feed.clearRead();
    focusHeading();
  };
  const onUndo = () => {
    track('notifications_restored', { count: feed.undo?.count ?? 0 });
    feed.undoLast();
  };

  const onOpen = (n: Notice) => {
    track('notification_opened', { kind: n.kind, channel: 'bell' });
    feed.markRead(n);
    setOpen(false);
  };

  return (
    <div ref={root} className="sm:relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-track="bell"
        onClick={() => {
          if (!open) track('bell_opened', { unread: Math.min(feed.unread, 100) });
          setOpen((o) => !o);
        }}
        className="press relative inline-flex size-10 items-center justify-center rounded-xl text-ink hover:bg-pill"
      >
        <BellIcon aria-hidden="true" className="size-5" />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-0.5 grid min-w-5 place-items-center rounded-full bg-accent-button px-1 text-[11px] leading-5 font-extrabold text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>
      {/* Always in the page, so a screen reader announces the change when its text appears. */}
      <span role="status" aria-live="polite" className="sr-only">
        {liveText(announce, copy)}
      </span>
      {open ? (
        <div
          id={panelId}
          data-notice-root
          className="absolute z-[45] overflow-hidden rounded-2xl bg-surface shadow-float max-sm:inset-x-0 max-sm:top-full max-sm:mt-2.5 sm:top-full sm:right-0 sm:mt-2.5 sm:w-[360px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-line px-4 py-1.5">
            <h2
              tabIndex={-1}
              data-notice-heading
              className="font-heading text-[15px] font-extrabold text-ink"
            >
              {copy.label}
            </h2>
            <div className="flex flex-wrap items-center justify-end">
              {hasRead ? (
                <button
                  type="button"
                  onClick={onClearRead}
                  className="press min-h-11 rounded-lg px-2 text-[13px] font-bold text-muted hover:bg-pill hover:text-ink"
                >
                  {copy.clearRead}
                </button>
              ) : null}
              {feed.unread > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    feed.markAllRead();
                    focusHeading();
                  }}
                  className="press min-h-11 rounded-lg px-2 text-[13px] font-bold text-accent-soft-text hover:bg-pill"
                >
                  {copy.markAllRead}
                </button>
              ) : null}
            </div>
          </div>
          {feed.status === 'loading' ? (
            <p role="status" className="px-4 py-6 text-sm text-muted">
              {copy.loading}
            </p>
          ) : feed.status === 'error' ? (
            <div role="alert" className="space-y-3 px-4 py-5">
              <p className="text-sm font-bold text-error">{copy.loadError}</p>
              <button
                type="button"
                onClick={() => void feed.refresh()}
                className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {copy.retry}
              </button>
            </div>
          ) : feed.notices.length === 0 ? (
            <div className="space-y-1 px-4 py-6">
              <p className="font-heading text-[15px] font-extrabold text-ink">{copy.emptyTitle}</p>
              <p className="text-sm text-muted">{copy.emptyBody}</p>
              <Link
                href={`${prefix}${action.href}`}
                className="press mt-3 inline-flex min-h-11 items-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {action.shop ? copy.emptyActionShop : copy.emptyActionPortal}
              </Link>
            </div>
          ) : (
            <ul aria-label={copy.label} className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              {feed.notices.map((n) => (
                <li key={n.id}>
                  <NoticeItem
                    notice={n}
                    locale={locale}
                    copy={itemCopy}
                    onOpen={onOpen}
                    onRemove={onRemove}
                  />
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`${prefix}/notifications`}
            data-track="bell_see_all"
            onClick={() => {
              setOpen(false);
            }}
            className="press flex min-h-11 items-center justify-center border-t border-line px-4 text-[13px] font-bold text-accent-soft-text hover:bg-pill"
          >
            {copy.seeAll}
          </Link>
        </div>
      ) : null}
      <FeedToast
        feed={{ ...feed, undoLast: onUndo }}
        copy={{
          removedToast: copy.removedToast,
          clearedToast: copy.clearedToast,
          undo: copy.undo,
          undoFailed: copy.undoFailed,
          removeFailed: copy.removeFailed,
          dismissToast: copy.dismissToast,
        }}
      />
    </div>
  );
}
