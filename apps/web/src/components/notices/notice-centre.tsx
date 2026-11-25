'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { track } from '@/lib/analytics';
import { useHydrated } from '@/demo/store';
import { useSession } from '@/demo/session-state';
import { emptyActionFor } from '@/lib/notices-view';
import { FeedToast } from './feed-toast';
import { NoticeItem, type NoticeItemCopy } from './notice-item';
import { NoticeSettings } from './notice-prefs';
import { PushPrompt } from './push-card';
import { useNoticeFeed } from './use-notice-feed';

const card = 'rounded-card border border-line-card bg-surface shadow-card';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60';

/**
 * The notification centre (spec 10, design 2026-11-15): every notification newest first, "Show older" for more,
 * "Mark all as read", then this device's push card and the choices. For every signed-in role; real sign-in only.
 */
export function NoticeCentre() {
  const hydrated = useHydrated();
  const session = useSession();
  const t = useTranslations('bell');
  const account = useTranslations('account');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const role = session?.role ?? 'customer';
  const feed = useNoticeFeed({ locale, role, limit: 20, enabled: hydrated && session !== null });
  // Once per visit, when the first page arrives (the count is read from a ref-like snapshot of that moment).
  const ready = feed.status === 'ready';
  const unreadAtOpen = useRef(0);
  unreadAtOpen.current = feed.unread;
  useEffect(() => {
    if (ready) track('bell_opened', { unread: Math.min(unreadAtOpen.current, 100) });
  }, [ready]);

  if (!hydrated) return <div className="skeleton h-96 rounded-card" aria-hidden="true" />;
  if (!session)
    return (
      <div className={`${card} flex flex-wrap items-center justify-between gap-4 p-6`}>
        <div className="max-w-xl">
          <h2 className="font-heading text-xl font-extrabold text-ink">{account('signedOutTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{account('signedOutBody')}</p>
        </div>
        <Link
          href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/notifications`)}`}
          className={primary}
        >
          {account('signIn')}
        </Link>
      </div>
    );

  const action = emptyActionFor(role);
  const itemCopy: NoticeItemCopy = {
    unread: t('unread'),
    priority: {
      urgent: t('priorityUrgent'),
      action: t('priorityAction'),
      info: t('priorityInfo'),
      success: t('prioritySuccess'),
    },
    removeNamed: t('removeNamed', { title: '{title}' }),
  };
  const hasRead = feed.notices.some((n) => n.read);
  const focusHeading = () => {
    document.getElementById('notice-list-title')?.focus();
  };
  const onClearRead = () => {
    track('notifications_cleared', { count: feed.notices.filter((n) => n.read).length, channel: 'centre' });
    feed.clearRead();
    focusHeading();
  };
  const onUndo = () => {
    track('notifications_restored', { count: feed.undo?.count ?? 0 });
    feed.undoLast();
  };
  return (
    <div className="space-y-8">
      <PushPrompt partner={role !== 'customer'} />
      <section aria-labelledby="notice-list-title" data-notice-root className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2
            id="notice-list-title"
            tabIndex={-1}
            data-notice-heading
            className="font-heading text-base font-extrabold text-ink"
          >
            {t('centreTitle')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasRead ? (
              <button type="button" className={quiet} onClick={onClearRead}>
                {t('clearRead')}
              </button>
            ) : null}
            {feed.unread > 0 ? (
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  feed.markAllRead();
                  focusHeading();
                }}
              >
                {t('markAllRead')}
              </button>
            ) : null}
          </div>
        </div>
        {feed.status === 'loading' ? (
          <p role="status" className="px-5 py-6 text-sm text-muted">
            {t('loading')}
          </p>
        ) : feed.status === 'error' ? (
          <div role="alert" className="space-y-3 px-5 py-6">
            <p className="text-sm font-bold text-error">{t('loadError')}</p>
            <button type="button" className={quiet} onClick={() => void feed.refresh()}>
              {t('retry')}
            </button>
          </div>
        ) : feed.notices.length === 0 ? (
          <div className="space-y-1 px-5 py-8">
            <p className="font-heading text-base font-extrabold text-ink">{t('emptyTitle')}</p>
            <p className="text-sm text-muted">{t('emptyBody')}</p>
            <Link href={`${prefix}${action.href}`} className={`${primary} mt-3`}>
              {action.shop ? t('emptyActionShop') : t('emptyActionPortal')}
            </Link>
          </div>
        ) : (
          <ul aria-labelledby="notice-list-title" className="divide-y divide-line">
            {feed.notices.map((n) => (
              <li key={n.id}>
                <NoticeItem
                  notice={n}
                  locale={locale}
                  copy={itemCopy}
                  onOpen={(x) => {
                    track('notification_opened', { kind: x.kind, channel: 'centre' });
                    feed.markRead(x);
                  }}
                  onRemove={(x) => {
                    track('notification_dismissed', {
                      kind: x.kind,
                      priority: x.priority,
                      channel: 'centre',
                    });
                    feed.remove(x);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {feed.hasMore ? (
          <div className="border-t border-line px-5 py-3">
            <button
              type="button"
              className={quiet}
              aria-disabled={feed.loadingMore}
              onClick={() => {
                if (!feed.loadingMore) void feed.loadMore();
              }}
            >
              {feed.loadingMore ? t('loading') : t('loadMore')}
            </button>
          </div>
        ) : null}
      </section>
      <NoticeSettings role={role} />
      <FeedToast
        feed={{ ...feed, undoLast: onUndo }}
        copy={{
          removedToast: t('removedToast'),
          clearedToast: t('clearedToast', { count: '{count}' }),
          undo: t('undo'),
          undoFailed: t('undoFailed'),
          removeFailed: t('removeFailed'),
          dismissToast: t('dismissToast'),
        }}
      />
    </div>
  );
}
