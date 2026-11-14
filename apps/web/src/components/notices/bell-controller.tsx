'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { BELL_PAGE_SIZE, type Notice } from '@mechdost/shared/notice-api';
import { track } from '@/lib/analytics';
import { UI_EMOJI } from '@/lib/emoji';
import { badgeText, emptyActionFor, liveText, withCount } from '@/lib/notices-view';
import type { BellCopy } from './bell-copy';
import { NoticeItem } from './notice-item';
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

  const onOpen = (n: Notice) => {
    track('notification_opened', { kind: n.kind, channel: 'bell' });
    feed.markRead(n);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        data-track="bell"
        onClick={() => {
          if (!open) track('bell_opened', { unread: Math.min(feed.unread, 100) });
          setOpen((o) => !o);
        }}
        className="press relative inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-pill"
      >
        <span aria-hidden="true" className="text-[18px] leading-none">
          {UI_EMOJI.bell}
        </span>
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
        {liveText(feed.unread, copy)}
      </span>
      {open ? (
        <div
          id={panelId}
          className="absolute top-full right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-card border border-line-card bg-surface shadow-card"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2 className="font-heading text-[15px] font-extrabold text-ink">{copy.label}</h2>
            {feed.unread > 0 ? (
              <button
                type="button"
                onClick={feed.markAllRead}
                className="press min-h-11 rounded-lg px-2 text-[13px] font-bold text-accent-soft-text hover:bg-pill"
              >
                {copy.markAllRead}
              </button>
            ) : null}
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
            <ul className="max-h-[min(60vh,420px)] divide-y divide-line overflow-y-auto">
              {feed.notices.map((n) => (
                <li key={n.id}>
                  <NoticeItem notice={n} locale={locale} newLabel={copy.unread} onOpen={onOpen} />
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
    </div>
  );
}
