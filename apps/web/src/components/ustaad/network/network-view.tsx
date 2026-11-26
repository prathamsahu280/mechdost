'use client';

import { Check, MessageCircle, Search, UserMinus, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { localePath } from '@/lib/locale-path';
import type { ConnectionView, MemberCard } from '@/lib/ustaad/messages-api';
import { LoadFailed, LoadingBlock, SampleNote, btnPrimary, btnQuiet } from '../common';
import {
  Avatar,
  LiveNote,
  MemberLine,
  MoreButton,
  TabLinks,
  Who,
  useAct,
  useDmErrorText,
  useMemberName,
  usePaged,
  useSocial,
} from '../messages/shared';
import { NETWORK_TABS, type NetworkTab } from '../messages/view';

const small = 'min-h-12 px-3.5 text-[14px]';
const h2Class =
  'rounded-sm font-heading text-lg font-extrabold text-ink focus-visible:outline-3 focus-visible:outline-focus';

/**
 * My network (spec 23 § 5 `/ustaad/network`; § 4 flow 7): Followers, Following, Connections, Requests (to me: accept
 * or decline; mine: withdraw) and Blocked (unblock, unmute). The address keeps the tab; every list pages by the API's
 * keyset cursor ("Show more", no totals: the API serves none). Limits come back as words: the daily cap on new requests
 * and the wait after a withdrawn or declined request (`USTAAD_DAILY_CAP`, `USTAAD_CONNECT_COOLDOWN`). Each row's
 * buttons carry the member's name for screen readers, and when an action removes the row, focus goes to the list's
 * heading (accessibility review 2026-11-26).
 */
export function NetworkView({ tab }: { tab: NetworkTab }) {
  const t = useTranslations('ustaad.network');
  const locale = useLocale();
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header className="grid gap-1">
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('intro')}</p>
      </header>
      <TabLinks
        label={t('tabsLabel')}
        tabs={NETWORK_TABS}
        current={tab}
        hrefFor={(k) =>
          localePath(k === 'followers' ? '/ustaad/network' : `/ustaad/network?tab=${k}`, locale)
        }
        textFor={(k) => t(`tab_${k}`)}
        track="ustaad_network_tab"
      />
      {tab === 'followers' || tab === 'following' ? <FollowList kind={tab} /> : null}
      {tab === 'connections' ? <ConnectionList box="connected" title={t('tab_connections')} hidden /> : null}
      {tab === 'requests' ? (
        <>
          <p role="note" className="rounded-xl bg-info-bg p-4 text-[15px] leading-relaxed text-ink">
            {t('requestsRule')}
          </p>
          <ConnectionList box="incoming" title={t('incoming')} />
          <ConnectionList box="outgoing" title={t('outgoing')} />
        </>
      ) : null}
      {tab === 'blocked' ? <BlockedList /> : null}
    </div>
  );
}

/** A list heading that can take focus (where focus goes when the acted-on row leaves). */
function ListHeading({
  text,
  hidden = false,
  innerRef,
}: {
  text: string;
  hidden?: boolean;
  innerRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <h2 ref={innerRef} tabIndex={-1} className={hidden ? 'sr-only' : h2Class}>
      {text}
    </h2>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return (
    <ul className="grid divide-y divide-line-card overflow-hidden rounded-2xl border border-line-card bg-surface shadow-card">
      {children}
    </ul>
  );
}

function Row({ m, children }: { m: MemberCard; children: ReactNode }) {
  const name = useMemberName()(m);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <MemberLine m={m} />
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  const t = useTranslations('ustaad.network');
  const locale = useLocale();
  return (
    <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
      <p className="text-[15px] leading-relaxed text-ink">{text}</p>
      <Link
        href={localePath('/ustaad/discover', locale)}
        className={btnPrimary}
        data-track="ustaad_network_empty_discover"
      >
        <Search aria-hidden="true" className="size-5" />
        {t('findPeople')}
      </Link>
    </div>
  );
}

function MessageLink({ m }: { m: MemberCard }) {
  const t = useTranslations('ustaad.network');
  const locale = useLocale();
  const name = useMemberName()(m);
  return (
    <Link
      href={localePath(`/ustaad/messages?to=${encodeURIComponent(m.handle)}`, locale)}
      className={`${btnQuiet} ${small}`}
      data-track="ustaad_network_message"
    >
      <MessageCircle aria-hidden="true" className="size-5" />
      {t('message')}
      <Who name={name} />
    </Link>
  );
}

/** After a write that removes the row: the silent refresh redraws the list, then focus lands on the heading. */
function useAfterRemove(heading: RefObject<HTMLHeadingElement | null>, refresh: () => void) {
  return () => {
    refresh();
    requestAnimationFrame(() => heading.current?.focus());
  };
}

function FollowList({ kind }: { kind: 'followers' | 'following' }) {
  const t = useTranslations('ustaad.network');
  const errorText = useDmErrorText();
  const name = useMemberName();
  const list = usePaged((c, cursor) => c.follows(kind, cursor), kind);
  const { act, busy, error } = useAct();
  const { loaded, items, next, loadMore, reload, sample, refresh, moreError } = list;
  const [note, setNote] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const removed = useAfterRemove(heading, refresh);

  async function remove(m: MemberCard) {
    const r =
      kind === 'followers'
        ? await act(m.id, (c) => c.removeFollower(m.id))
        : await act(m.id, (c) => c.follow(m.id, false));
    if (!r) return;
    setNote(
      kind === 'followers' ? t('removedNote', { name: name(m) }) : t('unfollowedNote', { name: name(m) }),
    );
    removed();
  }

  return (
    <>
      <ListHeading text={t(`tab_${kind}`)} hidden innerRef={heading} />
      <SampleNote show={sample} />
      <LiveNote text={note} />
      <LiveNote tone="error" text={error ? errorText(error) : null} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && items.length === 0 ? <Empty text={t(`empty_${kind}`)} /> : null}
      {items.length > 0 ? (
        <Rows>
          {items.map((m) => (
            <Row key={m.id} m={m}>
              <MessageLink m={m} />
              <button
                type="button"
                className={`${btnQuiet} ${small}`}
                onClick={() => void remove(m)}
                aria-disabled={busy !== null}
                data-track={
                  kind === 'followers' ? 'ustaad_network_remove_follower' : 'ustaad_network_unfollow'
                }
              >
                <UserMinus aria-hidden="true" className="size-5" />
                {busy === m.id ? t('working') : kind === 'followers' ? t('removeFollower') : t('unfollow')}
                <Who name={name(m)} />
              </button>
            </Row>
          ))}
        </Rows>
      ) : null}
      <MoreButton
        next={next}
        busy={list.busy}
        moreError={moreError}
        loadMore={loadMore}
        endFocus={heading}
        label={t('loadMore')}
        track="ustaad_network_more"
      />
    </>
  );
}

function ConnectionList({
  box,
  title,
  hidden = false,
}: {
  box: 'connected' | 'incoming' | 'outgoing';
  title: string;
  hidden?: boolean;
}) {
  const t = useTranslations('ustaad.network');
  const errorText = useDmErrorText();
  const name = useMemberName();
  const list = usePaged((c, cursor) => c.connections(box, cursor), box);
  const { act, busy, error } = useAct();
  const { loaded, items, next, loadMore, reload, sample, refresh, moreError } = list;
  const [note, setNote] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const removed = useAfterRemove(heading, refresh);

  async function move(c: ConnectionView, action: 'accept' | 'decline' | 'withdraw' | 'remove') {
    const r = await act(`${c.id}-${action}`, (s) => s.moveConnection(c.id, action));
    if (!r) return;
    setNote(t(`moved_${action}`, { name: name(c.other) }));
    removed();
  }

  const button = (c: ConnectionView, action: 'accept' | 'decline' | 'withdraw' | 'remove', label: string) => (
    <button
      type="button"
      className={`${action === 'accept' ? btnPrimary : btnQuiet} ${small}`}
      onClick={() => void move(c, action)}
      aria-disabled={busy !== null}
      data-track={`ustaad_network_${action === 'remove' ? 'remove_connection' : action}`}
    >
      {action === 'accept' ? <Check aria-hidden="true" className="size-5" /> : null}
      {action === 'withdraw' ? <X aria-hidden="true" className="size-5" /> : null}
      {action === 'remove' ? <UserMinus aria-hidden="true" className="size-5" /> : null}
      {busy === `${c.id}-${action}` ? t('working') : label}
      <Who name={name(c.other)} />
    </button>
  );

  return (
    <section className="grid gap-3">
      <ListHeading text={title} hidden={hidden} innerRef={heading} />
      {box === 'outgoing' ? null : <SampleNote show={sample} />}
      <LiveNote text={note} />
      <LiveNote tone="error" text={error ? errorText(error) : null} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && items.length === 0 ? (
        box === 'connected' ? (
          <Empty text={t('empty_connections')} />
        ) : (
          <p className="rounded-xl bg-pill p-4 text-[15px] text-ink">{t(`empty_${box}`)}</p>
        )
      ) : null}
      {items.length > 0 ? (
        <Rows>
          {items.map((c) => (
            <Row key={c.id} m={c.other}>
              {box === 'incoming' ? (
                <>
                  {button(c, 'accept', t('accept'))}
                  {button(c, 'decline', t('decline'))}
                </>
              ) : null}
              {box === 'outgoing' ? button(c, 'withdraw', t('withdraw')) : null}
              {box === 'connected' ? (
                <>
                  <MessageLink m={c.other} />
                  {button(c, 'remove', t('removeConnection'))}
                </>
              ) : null}
            </Row>
          ))}
        </Rows>
      ) : null}
      <MoreButton
        next={next}
        busy={list.busy}
        moreError={moreError}
        loadMore={loadMore}
        endFocus={heading}
        label={t('loadMore')}
        track="ustaad_network_more"
      />
    </section>
  );
}

function BlockedList() {
  const t = useTranslations('ustaad.network');
  const errorText = useDmErrorText();
  const name = useMemberName();
  const { loaded, reload, refresh, sample } = useSocial((c) => c.blocks(), 'blocks');
  const { act, busy, error } = useAct();
  const [note, setNote] = useState<string | null>(null);
  const blockedHeading = useRef<HTMLHeadingElement>(null);
  const mutedHeading = useRef<HTMLHeadingElement>(null);
  const afterBlocked = useAfterRemove(blockedHeading, refresh);
  const afterMuted = useAfterRemove(mutedHeading, refresh);

  async function undo(m: MemberCard, what: 'block' | 'mute') {
    const r =
      what === 'block'
        ? await act(`${m.id}-block`, (c) => c.block(m.id, false))
        : await act(`${m.id}-mute`, (c) => c.muteMember(m.id, false));
    if (!r) return;
    setNote(what === 'block' ? t('unblockedNote', { name: name(m) }) : t('unmutedNote', { name: name(m) }));
    if (what === 'block') afterBlocked();
    else afterMuted();
  }

  const section = (key: 'blocked' | 'muted', items: MemberCard[]) => {
    const what = key === 'blocked' ? 'block' : 'mute';
    return (
      <section className="grid gap-3">
        <ListHeading text={t(`h_${key}`)} innerRef={key === 'blocked' ? blockedHeading : mutedHeading} />
        {items.length === 0 ? (
          <p className="rounded-xl bg-pill p-4 text-[15px] text-ink">{t(`empty_${key}`)}</p>
        ) : (
          <Rows>
            {items.map((m) => (
              <Row key={m.id} m={m}>
                <button
                  type="button"
                  className={`${btnQuiet} ${small}`}
                  onClick={() => void undo(m, what)}
                  aria-disabled={busy !== null}
                  data-track={key === 'blocked' ? 'ustaad_network_unblock' : 'ustaad_network_unmute'}
                >
                  {busy === `${m.id}-${what}` ? t('working') : key === 'blocked' ? t('unblock') : t('unmute')}
                  <Who name={name(m)} />
                </button>
              </Row>
            ))}
          </Rows>
        )}
      </section>
    );
  };

  return (
    <>
      <SampleNote show={sample} />
      <p role="note" className="rounded-xl bg-info-bg p-4 text-[15px] leading-relaxed text-ink">
        {t('blockedRule')}
      </p>
      <LiveNote text={note} />
      <LiveNote tone="error" text={error ? errorText(error) : null} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' ? (
        <>
          {section('blocked', loaded.data.blocked)}
          {section('muted', loaded.data.muted)}
        </>
      ) : null}
    </>
  );
}
