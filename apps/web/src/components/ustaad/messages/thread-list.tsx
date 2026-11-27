'use client';

import { BellOff, MessageCircle, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';
import { localePath } from '@/lib/locale-path';
import type { ThreadView } from '@/lib/ustaad/messages-api';
import { LoadFailed, LoadingBlock, SampleNote, btnPrimary, useTimeAgo } from '../common';
import { PehchaanTag } from '../common/pehchaan-tag';
import { Avatar, MoreButton, TabLinks, useDmErrorText, useMemberName, usePaged } from './shared';
import { THREAD_BOXES, type ThreadBox } from './view';

/**
 * Messages (spec 23 § 5 `/ustaad/messages`, WhatsApp habit): Chats, Requests (to me: accept or decline inside) and
 * Sent (my requests waiting). One row per conversation: initials, the name as written, the time, and an unread dot
 * with the word "New" (the API gives no last-message text, so none is shown). The address keeps the tab.
 */
export function ThreadList({ box }: { box: ThreadBox }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const errorText = useDmErrorText();
  const list = usePaged((c, cursor) => c.threads(box, cursor), box);
  const { loaded, items, next, loadMore, busy, moreError, reload, sample } = list;
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header className="grid gap-1">
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink"
        >
          {t('title')}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('intro')}</p>
      </header>

      <TabLinks
        label={t('boxesLabel')}
        tabs={THREAD_BOXES}
        current={box}
        hrefFor={(k) => localePath(k === 'inbox' ? '/ustaad/messages' : `/ustaad/messages?box=${k}`, locale)}
        textFor={(k) => t(`box_${k}`)}
        track="ustaad_messages_box"
      />

      <SampleNote show={sample} />

      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && items.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
          <p className="text-[15px] leading-relaxed text-ink">{t(`empty_${box}`)}</p>
          <Link
            href={localePath('/ustaad/discover', locale)}
            className={btnPrimary}
            data-track="ustaad_messages_empty_discover"
          >
            <Users aria-hidden="true" className="size-5" />
            {t('findPeople')}
          </Link>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid divide-y divide-line-card overflow-hidden rounded-2xl border border-line-card bg-surface shadow-card">
          {items.map((th) => (
            <li key={th.id}>
              <ThreadRow th={th} box={box} />
            </li>
          ))}
        </ul>
      ) : null}

      <MoreButton
        next={next}
        busy={busy}
        moreError={moreError}
        loadMore={loadMore}
        endFocus={heading}
        label={t('loadMore')}
        track="ustaad_messages_more"
      />
    </div>
  );
}

function ThreadRow({ th, box }: { th: ThreadView; box: ThreadBox }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const name = useMemberName()(th.other);
  const ago = useTimeAgo();
  const status =
    box === 'requests'
      ? t('row_request')
      : box === 'sent'
        ? t('row_waiting')
        : th.unread
          ? t('row_new')
          : t('row_open');
  return (
    <Link
      href={localePath(`/ustaad/messages/${th.id}`, locale)}
      className="flex min-h-[72px] items-center gap-3 px-4 py-3 hover:bg-pill focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus"
      data-track="ustaad_thread_open"
    >
      <Avatar name={name} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2">
          <span
            data-user-content
            className={`truncate font-heading text-[16px] text-ink ${th.unread ? 'font-extrabold' : 'font-bold'}`}
          >
            {name}
          </span>
          <PehchaanTag level={th.other.level} interactive={false} />
          {th.muted ? (
            <BellOff aria-label={t('mutedIcon')} role="img" className="size-4 shrink-0 text-muted" />
          ) : null}
        </span>
        <span
          className={`flex items-center gap-1.5 text-sm ${th.unread ? 'font-bold text-ink' : 'text-muted'}`}
        >
          <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
          {status}
        </span>
      </span>
      <span className="grid justify-items-end gap-1 text-xs text-muted">
        {th.lastMessageAt ? <time dateTime={th.lastMessageAt}>{ago(th.lastMessageAt)}</time> : null}
        {th.unread ? (
          <span aria-hidden="true" className="rounded-full bg-accent-button px-2 py-0.5 font-bold text-white">
            {t('newBadge')}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
