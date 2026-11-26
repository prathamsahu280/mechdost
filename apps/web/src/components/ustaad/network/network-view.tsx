'use client';

import { Check, MessageCircle, Search, UserMinus, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { localePath } from '@/lib/locale-path';
import type { ConnectionView, MemberCard } from '@/lib/ustaad/messages-api';
import { LoadFailed, LoadingBlock, SampleNote, btnPrimary, btnQuiet } from '../common';
import {
  Avatar,
  LiveNote,
  MemberLine,
  TabLinks,
  useAct,
  useDmErrorText,
  useMemberName,
  usePaged,
  useSocial,
} from '../messages/shared';
import { NETWORK_TABS, type NetworkTab } from '../messages/view';

const small = 'min-h-12 px-3.5 text-[14px]';

/**
 * My network (spec 23 § 5 `/ustaad/network`; § 4 flow 7): Followers, Following, Connections, Requests (to me: accept
 * or decline; mine: withdraw) and Blocked (unblock, unmute). The address keeps the tab; every list pages by the API's
 * keyset cursor ("Show more", no totals: the API serves none). Limits come back as words: the daily cap on new requests
 * and the wait after a withdrawn or declined request (`USTAAD_DAILY_CAP`, `USTAAD_CONNECT_COOLDOWN`).
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
      {tab === 'connections' ? <ConnectionList box="connected" /> : null}
      {tab === 'requests' ? (
        <>
          <p role="note" className="rounded-xl bg-info-bg p-4 text-[15px] leading-relaxed text-ink">
            {t('requestsRule')}
          </p>
          <section className="grid gap-3" aria-labelledby="net-incoming">
            <h2 id="net-incoming" className="font-heading text-lg font-extrabold text-ink">
              {t('incoming')}
            </h2>
            <ConnectionList box="incoming" />
          </section>
          <section className="grid gap-3" aria-labelledby="net-outgoing">
            <h2 id="net-outgoing" className="font-heading text-lg font-extrabold text-ink">
              {t('outgoing')}
            </h2>
            <ConnectionList box="outgoing" />
          </section>
        </>
      ) : null}
      {tab === 'blocked' ? <BlockedList /> : null}
    </div>
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
      <span className="min-w-0 flex-1">
        <MemberLine m={m} />
      </span>
      <span className="flex flex-wrap gap-2">{children}</span>
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

function More({ next, busy, onMore }: { next: string | null; busy: boolean; onMore: () => void }) {
  const t = useTranslations('ustaad.network');
  if (!next) return null;
  return (
    <button
      type="button"
      className={`${btnQuiet} justify-self-center`}
      onClick={onMore}
      aria-disabled={busy}
      aria-busy={busy}
      data-track="ustaad_network_more"
    >
      {t('loadMore')}
    </button>
  );
}

function MessageLink({ m }: { m: MemberCard }) {
  const t = useTranslations('ustaad.network');
  const locale = useLocale();
  return (
    <Link
      href={localePath(`/ustaad/messages?to=${encodeURIComponent(m.handle)}`, locale)}
      className={`${btnQuiet} ${small}`}
      data-track="ustaad_network_message"
    >
      <MessageCircle aria-hidden="true" className="size-5" />
      {t('message')}
    </Link>
  );
}

function FollowList({ kind }: { kind: 'followers' | 'following' }) {
  const t = useTranslations('ustaad.network');
  const errorText = useDmErrorText();
  const name = useMemberName();
  const list = usePaged((c, cursor) => c.follows(kind, cursor), kind);
  const { act, busy, error } = useAct();
  const { loaded, items, next, loadMore, reload, sample, refresh } = list;
  const [note, setNote] = useNote();

  async function remove(m: MemberCard) {
    const r =
      kind === 'followers'
        ? await act(m.id, (c) => c.removeFollower(m.id))
        : await act(m.id, (c) => c.follow(m.id, false));
    if (!r) return;
    setNote(
      kind === 'followers' ? t('removedNote', { name: name(m) }) : t('unfollowedNote', { name: name(m) }),
    );
    refresh();
  }

  return (
    <>
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
                aria-busy={busy === m.id}
                data-track={
                  kind === 'followers' ? 'ustaad_network_remove_follower' : 'ustaad_network_unfollow'
                }
              >
                <UserMinus aria-hidden="true" className="size-5" />
                {kind === 'followers' ? t('removeFollower') : t('unfollow')}
              </button>
            </Row>
          ))}
        </Rows>
      ) : null}
      <More next={next} busy={list.busy} onMore={() => void loadMore()} />
    </>
  );
}

function ConnectionList({ box }: { box: 'connected' | 'incoming' | 'outgoing' }) {
  const t = useTranslations('ustaad.network');
  const errorText = useDmErrorText();
  const name = useMemberName();
  const list = usePaged((c, cursor) => c.connections(box, cursor), box);
  const { act, busy, error } = useAct();
  const { loaded, items, next, loadMore, reload, sample, refresh } = list;
  const [note, setNote] = useNote();

  async function move(c: ConnectionView, action: 'accept' | 'decline' | 'withdraw' | 'remove') {
    const r = await act(`${c.id}-${action}`, (s) => s.moveConnection(c.id, action));
    if (!r) return;
    setNote(t(`moved_${action}`, { name: name(c.other) }));
    refresh();
  }

  return (
    <>
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
                  <button
                    type="button"
                    className={`${btnPrimary} ${small}`}
                    onClick={() => void move(c, 'accept')}
                    aria-disabled={busy !== null}
                    aria-busy={busy === `${c.id}-accept`}
                    data-track="ustaad_network_accept"
                  >
                    <Check aria-hidden="true" className="size-5" />
                    {t('accept')}
                  </button>
                  <button
                    type="button"
                    className={`${btnQuiet} ${small}`}
                    onClick={() => void move(c, 'decline')}
                    aria-disabled={busy !== null}
                    aria-busy={busy === `${c.id}-decline`}
                    data-track="ustaad_network_decline"
                  >
                    {t('decline')}
                  </button>
                </>
              ) : null}
              {box === 'outgoing' ? (
                <button
                  type="button"
                  className={`${btnQuiet} ${small}`}
                  onClick={() => void move(c, 'withdraw')}
                  aria-disabled={busy !== null}
                  aria-busy={busy === `${c.id}-withdraw`}
                  data-track="ustaad_network_withdraw"
                >
                  <X aria-hidden="true" className="size-5" />
                  {t('withdraw')}
                </button>
              ) : null}
              {box === 'connected' ? (
                <>
                  <MessageLink m={c.other} />
                  <button
                    type="button"
                    className={`${btnQuiet} ${small}`}
                    onClick={() => void move(c, 'remove')}
                    aria-disabled={busy !== null}
                    aria-busy={busy === `${c.id}-remove`}
                    data-track="ustaad_network_remove_connection"
                  >
                    <UserMinus aria-hidden="true" className="size-5" />
                    {t('removeConnection')}
                  </button>
                </>
              ) : null}
            </Row>
          ))}
        </Rows>
      ) : null}
      <More next={next} busy={list.busy} onMore={() => void loadMore()} />
    </>
  );
}

function BlockedList() {
  const t = useTranslations('ustaad.network');
  const errorText = useDmErrorText();
  const name = useMemberName();
  const { loaded, reload, refresh, sample } = useSocial((c) => c.blocks(), 'blocks');
  const { act, busy, error } = useAct();
  const [note, setNote] = useNote();

  async function undo(m: MemberCard, what: 'block' | 'mute') {
    const r =
      what === 'block'
        ? await act(`${m.id}-block`, (c) => c.block(m.id, false))
        : await act(`${m.id}-mute`, (c) => c.muteMember(m.id, false));
    if (!r) return;
    setNote(what === 'block' ? t('unblockedNote', { name: name(m) }) : t('unmutedNote', { name: name(m) }));
    refresh();
  }

  const section = (key: 'blocked' | 'muted', items: MemberCard[]) => (
    <section className="grid gap-3" aria-labelledby={`net-${key}`}>
      <h2 id={`net-${key}`} className="font-heading text-lg font-extrabold text-ink">
        {t(`h_${key}`)}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl bg-pill p-4 text-[15px] text-ink">{t(`empty_${key}`)}</p>
      ) : (
        <Rows>
          {items.map((m) => (
            <Row key={m.id} m={m}>
              <button
                type="button"
                className={`${btnQuiet} ${small}`}
                onClick={() => void undo(m, key === 'blocked' ? 'block' : 'mute')}
                aria-disabled={busy !== null}
                aria-busy={busy === `${m.id}-${key === 'blocked' ? 'block' : 'mute'}`}
                data-track={key === 'blocked' ? 'ustaad_network_unblock' : 'ustaad_network_unmute'}
              >
                {key === 'blocked' ? t('unblock') : t('unmute')}
              </button>
            </Row>
          ))}
        </Rows>
      )}
    </section>
  );

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

function useNote() {
  return useState<string | null>(null);
}
