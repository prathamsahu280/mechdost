'use client';

import {
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  Flag,
  Lock,
  MoreVertical,
  Share2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { localePath } from '@/lib/locale-path';
import { socialClient, type MessageView, type ThreadView } from '@/lib/ustaad/messages-api';
import { LoadFailed, LoadingBlock, SampleNote, btnPrimary, btnQuiet } from '../common';
import { VoiceNote } from '../media/voice-note';
import { Composer } from './composer';
import { ReportDialog } from './report-dialog';
import {
  Avatar,
  LiveNote,
  MemberLine,
  backLink,
  useAct,
  useDmErrorText,
  useMemberName,
  useSocial,
} from './shared';
import {
  chronological,
  composerMode,
  countIncoming,
  dayWord,
  groupByDay,
  isClosedThread,
  tickState,
} from './view';

/**
 * One conversation (spec 23 § 5 `/ustaad/messages/[id]`; SR-33–35), WhatsApp habit: their messages on the left,
 * mine on the right in navy, oldest at the top, "Show older" above. Ticks are words as well as icons (Sent / Seen),
 * and my held message says "Being checked" (only I see it; the other member never does). Before acceptance the
 * receiver sees Accept / Decline and the sender a waiting note; the composer (text, hold-to-talk voice, photo) shows
 * only on an open conversation. "More" holds mute notices, report and block. Whenever an action replaces the focused
 * control, focus moves to the control that replaces it (accessibility review 2026-11-26).
 */
/** The thread's own header, sticky under the 56 px network header; the composer below sticks to the bottom edge. */
const STICKY_HEAD =
  'sticky top-14 z-20 -mx-4 grid gap-3 border-b border-line-card bg-surface-raised px-4 py-2 tab:-mx-6 tab:px-6';
const STICKY_FOOT =
  'sticky bottom-0 z-20 -mx-4 border-t border-line-card bg-surface-raised px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] tab:-mx-6 tab:px-6';

export function ThreadScreen({ id }: { id: string }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const errorText = useDmErrorText();
  const { loaded, reload, refresh, sample } = useSocial((c) => c.messages(id, null), id);
  const [older, setOlder] = useState<{ items: MessageView[]; next: string | null } | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderNote, setOlderNote] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // One polite line for new messages from the other member; the region is mounted empty first (L-UCE2).
  const [incomingCount, setIncomingCount] = useState(0);
  const knownIds = useRef<Set<string> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const scrolled = useRef(false);
  const readSent = useRef(false);

  const data = loaded.state === 'ok' ? loaded.data : null;
  const thread = data?.thread ?? null;
  const next = older ? older.next : (data?.nextCursor ?? null);
  const seen = new Set<string>();
  const merged = [...(data?.items ?? []), ...(older?.items ?? [])].filter((m) =>
    seen.has(m.id) ? false : (seen.add(m.id), true),
  );
  const messages = chronological(merged);
  const days = groupByDay(messages);
  const nowIso = new Date().toISOString();
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(`${day}T12:00:00+05:30`));

  // Read receipt once the conversation is on screen (the other member's ticks turn to "Seen").
  useEffect(() => {
    if (!thread || readSent.current || thread.status !== 'open') return;
    readSent.current = true;
    void socialClient(locale).then((c) => c.markRead(id));
  }, [thread, id, locale]);
  // A new message from the other member is announced once (never on first load, never for my own or older ones).
  const otherName = useMemberName()(thread?.other ?? { displayName: '', displayNameHi: null });
  const incoming = incomingCount > 0 ? t('newIncomingNote', { name: otherName }) : null;
  useEffect(() => {
    if (!data) return;
    const ids = [...data.items, ...(older?.items ?? [])];
    const fresh = countIncoming(knownIds.current, ids);
    knownIds.current = new Set(ids.map((m) => m.id));
    setIncomingCount(fresh);
  }, [data, older]);
  // Coming back to the tab brings in what arrived meanwhile (no polling; the thread list pings elsewhere).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  // Like a chat: the newest message is in view on first open.
  useEffect(() => {
    if (!data || scrolled.current) return;
    scrolled.current = true;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [data]);

  async function loadOlder() {
    if (!next || olderBusy) return;
    setOlderBusy(true);
    setOlderNote(null);
    setOlderError(null);
    const r = await (await socialClient(locale)).messages(id, next);
    setOlderBusy(false);
    if (!r.ok) {
      setOlderError(r.code);
      return;
    }
    setOlder({ items: [...(older?.items ?? []), ...r.data.items], next: r.data.nextCursor });
    setOlderNote(t('moreLoaded', { n: r.data.items.length }));
    // The button leaves when nothing older is left: focus the conversation instead of losing it.
    if (r.data.nextCursor === null) requestAnimationFrame(() => listRef.current?.focus());
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-3">
      {thread ? null : (
        <>
          <Link
            href={localePath('/ustaad/messages', locale)}
            className={backLink}
            data-track="ustaad_thread_back"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
            {t('backToMessages')}
          </Link>
          <h1 className="sr-only">{t('title')}</h1>
        </>
      )}
      <p role="status" className="sr-only">
        {incoming ?? ''}
      </p>
      <SampleNote show={sample} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {thread ? (
        <>
          <ThreadHeader
            thread={thread}
            lastTheirs={merged.find((m) => !m.mine)?.id ?? null}
            blocked={blocked}
            onBlocked={(b) => {
              setBlocked(b);
              if (!b) refresh();
            }}
            onNote={setNote}
            onChanged={refresh}
          />
          <LiveNote text={note} />
          {blocked ? null : (
            <>
              {next ? (
                <button
                  type="button"
                  className={`${btnQuiet} scroll-mt-32 justify-self-center`}
                  onClick={() => void loadOlder()}
                  aria-disabled={olderBusy}
                  data-track="ustaad_thread_older"
                >
                  {olderBusy ? t('loadingMore') : t('showOlder')}
                </button>
              ) : null}
              <p role="status" className="sr-only">
                {olderNote ?? ''}
              </p>
              <LiveNote tone="error" text={olderError ? errorText(olderError) : null} />
              <ol
                ref={listRef}
                tabIndex={-1}
                aria-label={t('conversationLabel')}
                className="grid gap-4 rounded-xl py-2 focus-visible:outline-3 focus-visible:outline-focus"
              >
                {days.map((d) => (
                  <li key={d.day} className="grid gap-2.5">
                    <h2 className="justify-self-center rounded-full bg-pill px-3 py-1 text-xs font-bold text-muted">
                      {dayWord(d.day, nowIso) ? t(dayWord(d.day, nowIso) ?? 'today') : dayLabel(d.day)}
                    </h2>
                    <ol className="grid gap-2.5">
                      {d.items.map((m) => (
                        <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                          <Bubble m={m} />
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
              <div ref={endRef} />
              <ThreadFooter thread={thread} onChanged={refresh} onNote={setNote} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function ThreadHeader({
  thread,
  lastTheirs,
  blocked,
  onBlocked,
  onNote,
  onChanged,
}: {
  thread: ThreadView;
  lastTheirs: string | null;
  blocked: boolean;
  onBlocked: (b: boolean) => void;
  onNote: (s: string | null) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const name = useMemberName()(thread.other);
  const errorText = useDmErrorText();
  const { act, busy, error } = useAct();
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const menuId = useId();
  const confirmId = useId();
  const moreRef = useRef<HTMLButtonElement>(null);
  const blockRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const unblockRef = useRef<HTMLButtonElement>(null);
  /** Set by a block / unblock the member just did, so focus follows the swapped header (never on first render). */
  const focusAfter = useRef<'unblock' | 'more' | null>(null);

  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    (target === 'unblock' ? unblockRef : moreRef).current?.focus();
  }, [blocked]);
  // The confirmation appears after the three buttons: put focus on its safe answer (Cancel).
  useEffect(() => {
    if (confirmBlock) cancelRef.current?.focus();
  }, [confirmBlock]);

  async function mute() {
    const r = await act('mute', (c) => c.muteThread(thread.id, !thread.muted));
    if (r) {
      onNote(r.muted ? t('mutedNote') : t('unmutedNote'));
      onChanged();
    }
  }
  async function block(on: boolean) {
    const r = await act('block', (c) => c.block(thread.other.id, on));
    if (!r) return;
    setConfirmBlock(false);
    setOpen(false);
    focusAfter.current = r.blocked ? 'unblock' : 'more';
    onBlocked(r.blocked);
    onNote(r.blocked ? t('blockedNote', { name }) : t('unblockedNote', { name }));
  }
  function closeMenu() {
    setOpen(false);
    setConfirmBlock(false);
    moreRef.current?.focus();
  }

  if (blocked)
    return (
      <div className={STICKY_HEAD}>
        <h1 className="font-heading text-[16px] font-extrabold text-ink">
          <span data-user-content>{name}</span>
        </h1>
        <p className="text-[15px] text-ink">
          {t.rich('youBlocked', { who: name, name: (chunks) => <span data-user-content>{chunks}</span> })}
        </p>
        <button
          ref={unblockRef}
          type="button"
          className={`${btnQuiet} justify-self-start`}
          onClick={() => void block(false)}
          aria-disabled={busy !== null}
          data-track="ustaad_thread_unblock"
        >
          {t('unblock')}
        </button>
        <LiveNote tone="error" text={error ? errorText(error) : null} />
      </div>
    );

  return (
    <div className={STICKY_HEAD}>
      <div className="flex items-center gap-2">
        <Link
          href={localePath('/ustaad/messages', locale)}
          aria-label={t('backToMessages')}
          className="press -ml-2 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-track="ustaad_thread_back"
        >
          <ArrowLeft aria-hidden="true" className="size-6" />
        </Link>
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <MemberLine m={thread.other} heading />
        </div>
        <button
          ref={moreRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            setOpen((o) => !o);
            setConfirmBlock(false);
          }}
          aria-label={t('more')}
          className="press inline-flex size-12 shrink-0 items-center justify-center rounded-full text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-track="ustaad_thread_more"
        >
          <MoreVertical aria-hidden="true" className="size-6" />
        </button>
      </div>
      {open ? (
        <div
          id={menuId}
          className="grid max-h-[40vh] gap-2 overflow-auto border-t border-line-card pt-3 sm:grid-cols-3"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !reporting) {
              e.stopPropagation();
              closeMenu();
            }
          }}
        >
          <button
            type="button"
            className={btnQuiet}
            onClick={() => void mute()}
            aria-disabled={busy !== null}
            data-track="ustaad_thread_mute"
          >
            {thread.muted ? (
              <Bell aria-hidden="true" className="size-5" />
            ) : (
              <BellOff aria-hidden="true" className="size-5" />
            )}
            {thread.muted ? t('unmuteThread') : t('muteThread')}
          </button>
          <button
            type="button"
            className={btnQuiet}
            onClick={() => {
              setReporting(true);
            }}
            data-track="ustaad_thread_report"
          >
            <Flag aria-hidden="true" className="size-5" />
            {t('report')}
          </button>
          <button
            ref={blockRef}
            type="button"
            className={`${btnQuiet} text-error`}
            onClick={() => {
              setConfirmBlock(true);
            }}
            data-track="ustaad_thread_block"
          >
            <Ban aria-hidden="true" className="size-5" />
            {t('block')}
          </button>
          {confirmBlock ? (
            <div
              role="group"
              aria-labelledby={confirmId}
              className="grid gap-2 rounded-xl bg-error-bg p-3 sm:col-span-3"
            >
              <p id={confirmId} className="text-[15px] text-ink">
                {t('blockConfirm')}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${btnQuiet} border-error text-error`}
                  onClick={() => void block(true)}
                  aria-disabled={busy !== null}
                  data-track="ustaad_thread_block_confirm"
                >
                  {busy === 'block' ? t('working') : t('blockYes')}
                </button>
                <button
                  ref={cancelRef}
                  type="button"
                  className={btnQuiet}
                  onClick={() => {
                    setConfirmBlock(false);
                    blockRef.current?.focus();
                  }}
                  data-track="ustaad_thread_block_cancel"
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <LiveNote tone="error" text={error ? errorText(error) : null} />
      {reporting ? (
        <ReportDialog
          target={lastTheirs ? { type: 'message', id: lastTheirs } : { type: 'member', id: thread.other.id }}
          onClose={(sent) => {
            // The dialog closes itself first, so the browser returns focus to the Report button.
            setReporting(false);
            if (sent) onNote(t('reportSent'));
          }}
        />
      ) : null}
    </div>
  );
}

function ThreadFooter(props: {
  thread: ThreadView;
  onChanged: () => void;
  onNote: (s: string | null) => void;
}) {
  return (
    <div className={STICKY_FOOT}>
      <FooterBody {...props} />
    </div>
  );
}

function FooterBody({
  thread,
  onChanged,
  onNote,
}: {
  thread: ThreadView;
  onChanged: () => void;
  onNote: (s: string | null) => void;
}) {
  const t = useTranslations('ustaad.messages');
  const name = useMemberName()(thread.other);
  const errorText = useDmErrorText();
  const { act, busy, error } = useAct();
  const mode = composerMode(thread);
  const [decided, setDecided] = useState<'accept' | 'decline' | null>(null);
  const closedRef = useRef<HTMLParagraphElement>(null);

  // After Decline the buttons leave: focus the closed note that replaces them.
  useEffect(() => {
    if (mode === 'closed' && decided === 'decline') closedRef.current?.focus();
  }, [mode, decided]);

  async function decide(action: 'accept' | 'decline') {
    const r = await act(action, (c) => c.threadAction(thread.id, action));
    if (!r) return;
    setDecided(action);
    onNote(action === 'accept' ? t('acceptedNote') : t('declinedNote'));
    onChanged();
  }

  // Closed (declined or blocked): one line of words and no composer, before a send is ever tried.
  if (isClosedThread(thread))
    return (
      <p
        ref={closedRef}
        tabIndex={-1}
        className="flex items-center gap-2 rounded-xl bg-pill p-4 text-[15px] text-ink focus-visible:outline-3 focus-visible:outline-focus"
      >
        <Lock aria-hidden="true" className="size-5 shrink-0 text-muted" />
        {t('closedNote')}
      </p>
    );
  if (mode === 'open')
    return (
      <Composer
        threadId={thread.id}
        onSent={onChanged}
        onNote={onNote}
        // After Accept the composer replaces the buttons: the message field takes focus.
        focusOnMount={decided === 'accept'}
      />
    );
  if (mode === 'waiting')
    return (
      <p
        role="note"
        className="flex items-start gap-2 rounded-xl bg-info-bg p-4 text-[15px] leading-relaxed text-ink"
      >
        <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
        <span>
          {t.rich('waitingNote', { who: name, name: (chunks) => <span data-user-content>{chunks}</span> })}
        </span>
      </p>
    );
  if (mode === 'decide')
    return (
      <div className="grid gap-3">
        <p className="text-[15px] leading-relaxed text-ink">
          {t.rich('decideNote', { who: name, name: (chunks) => <span data-user-content>{chunks}</span> })}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void decide('accept')}
            aria-disabled={busy !== null}
            data-track="ustaad_thread_accept"
          >
            <Check aria-hidden="true" className="size-5" />
            {busy === 'accept' ? t('working') : t('accept')}
          </button>
          <button
            type="button"
            className={btnQuiet}
            onClick={() => void decide('decline')}
            aria-disabled={busy !== null}
            data-track="ustaad_thread_decline"
          >
            {busy === 'decline' ? t('working') : t('decline')}
          </button>
        </div>
        <LiveNote tone="error" text={error ? errorText(error) : null} />
      </div>
    );
  return null;
}

function Bubble({ m }: { m: MessageView }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const tick = tickState(m);
  const time = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(m.createdAt));
  const mine = m.mine;
  return (
    <div
      className={`grid max-w-[85%] gap-2 rounded-[20px] px-4 py-3 shadow-card sm:max-w-[75%] ${
        mine
          ? `rounded-br-md border border-white/15 bg-navy-raised text-white ${m.pending ? 'outline-2 outline-offset-2 outline-warning outline-dashed' : ''}`
          : 'rounded-bl-md border border-line-card bg-surface text-ink'
      }`}
    >
      <span className="sr-only">{mine ? t('you') : t('them')}</span>
      {m.kind === 'voice' && m.mediaId ? (
        <VoiceNote mediaId={m.mediaId} tone={mine ? 'dark' : 'light'} info={{ ...m.voice, mine }} />
      ) : null}
      {m.kind === 'photo' && m.mediaId ? <PhotoBubble mediaId={m.mediaId} /> : null}
      {m.kind === 'post_share' && m.postId ? (
        <Link
          href={localePath(`/ustaad/p/${m.postId}`, locale)}
          className={`inline-flex min-h-12 scroll-mt-32 scroll-mb-28 items-center gap-2 rounded-xl px-3 font-bold underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            mine ? 'bg-white/12 text-white' : 'bg-pill text-ink'
          }`}
          data-track="ustaad_thread_post_open"
        >
          <Share2 aria-hidden="true" className="size-5" />
          {t('sharedPost')}
        </Link>
      ) : null}
      {m.text ? (
        <p data-user-content className="text-[16px] leading-relaxed break-words whitespace-pre-wrap">
          {m.text}
        </p>
      ) : null}
      <p className={`flex items-center justify-end gap-1.5 text-xs ${mine ? 'text-white/80' : 'text-muted'}`}>
        <time dateTime={m.createdAt}>{time}</time>
        {tick === 'pending' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 font-bold text-warning">
            <Clock aria-hidden="true" className="size-3.5" />
            {t('tick_pending')}
          </span>
        ) : null}
        {tick === 'seen' ? (
          <span className="inline-flex items-center gap-1 font-bold">
            <CheckCheck aria-hidden="true" className="size-4" />
            {t('tick_seen')}
          </span>
        ) : null}
        {tick === 'sent' ? (
          <span className="inline-flex items-center gap-1">
            <Check aria-hidden="true" className="size-4" />
            {t('tick_sent')}
          </span>
        ) : null}
      </p>
      {tick === 'pending' ? <p className="text-sm text-white/90">{t('pendingNote')}</p> : null}
    </div>
  );
}

/** A photo in a message: the short-lived URL is fetched only when the bubble scrolls into view (low data). */
function PhotoBubble({ mediaId }: { mediaId: string }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void socialClient(locale)
        .then((c) => c.mediaUrl(mediaId))
        .then((r) => {
          if (!live) return;
          if (r.ok) setUrl(r.data.url);
          else setFailed(true);
        });
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [mediaId, locale]);
  return (
    <div ref={box} className="relative aspect-[4/3] w-64 max-w-full overflow-hidden rounded-xl bg-white/10">
      {url ? (
        <Image src={url} alt={t('photoAlt')} fill unoptimized sizes="256px" className="object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center p-2 text-center text-sm">
          {failed ? t('photoFailed') : t('photoLoading')}
        </span>
      )}
    </div>
  );
}
