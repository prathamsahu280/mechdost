'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryRing } from '@mechdost/shared/ustaad/dto/feed';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { nextStory, type StoryPos } from '@/lib/ustaad/feed-format';
import { STORY_PHOTO_MS, storyAdvance } from '@/lib/ustaad/story-advance';
import { useTimeAgo } from '../common';
import { VoiceNote } from '../media/voice-note';
import { UstaadIcon } from '../shell/icons';
import { VideoTile } from './post-media';
import { SignedImage, useMemberName, useSocialAction } from './social-common';

/** A photo story stays this long before the next one (paused while held, or with the Pause button). */
const PHOTO_MS = STORY_PHOTO_MS;

/** Visible control buttons (U1, design § 3.3): word + icon, 48 px; one constant for the visual-language pass. */
const STORY_BTN =
  'press inline-flex min-h-12 items-center justify-center gap-1.5 rounded-pill bg-white/15 px-3 text-[14px] font-bold text-white focus-visible:outline-3 focus-visible:outline-white';

/**
 * Full-screen story viewer (spec 23 § 4 flow 6): tap the right side for the next story, the left for the previous,
 * press and hold to pause, swipe down or Close to leave. Buttons do the same for keyboards and screen readers, and
 * Pause stops the timer for as long as needed (WCAG 2.2.2). Photo stories move on by themselves; voice and video play
 * only when tapped (no autoplay). "Seen by N" shows on one's own stories only. Each story viewed is reported once.
 */
export function StoryViewer({
  rings,
  start,
  onClose,
  onSeen,
}: {
  rings: StoryRing[];
  start: number;
  onClose: () => void;
  onSeen: (ring: number, story: number) => void;
}) {
  const t = useTranslations('ustaad.feed');
  const st = useTranslations('ustaad.story');
  const locale = useLocale();
  const timeAgo = useTimeAgo();
  const name = useMemberName();
  const client = useSocialAction();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pos, setPos] = useState<StoryPos>({ ring: start, story: 0 });
  // Reduced motion: stories wait for Next instead of moving on by themselves (WCAG 2.2.2).
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const touchY = useRef<number | null>(null);
  const reported = useRef(new Set<string>());
  const ring = rings[pos.ring];
  const story = ring?.stories[pos.story];
  const kind = story?.media[0]?.kind ?? 'image';
  const timed =
    storyAdvance(kind === 'image' ? 'photo' : kind === 'audio' ? 'voice' : 'video', reduced) === 'timer';
  const togglePause = () => {
    if (!paused) track('ustaad_story_paused', {});
    setPaused((p) => !p);
  };

  useEffect(() => {
    const d = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const next = nextStory(
        rings.map((r) => ({ stories: r.stories.length })),
        pos,
        dir,
      );
      setElapsed(0);
      if (!next) onClose();
      else setPos(next);
    },
    [rings, pos, onClose],
  );

  useEffect(() => {
    if (!story || ring.mine || reported.current.has(story.id)) return;
    reported.current.add(story.id);
    track('ustaad_story_viewed', {});
    onSeen(pos.ring, pos.story);
    void client().then((c) => c.viewStory(story.id));
  }, [story, ring, pos, client, onSeen]);

  useEffect(() => {
    if (!timed || paused || held) return;
    const id = window.setInterval(() => {
      setElapsed((e) => e + 100);
    }, 100);
    return () => {
      window.clearInterval(id);
    };
  }, [timed, paused, held, pos]);
  useEffect(() => {
    if (timed && elapsed >= PHOTO_MS) step(1);
  }, [elapsed, timed, step]);

  if (!ring || !story) return null;
  const who = name(ring.author);
  const media = story.media[0];
  const poster = story.media.find((m, i) => i > 0 && m.kind === 'image');
  return (
    <dialog
      ref={dialog}
      aria-label={t('storyOf', { name: who })}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-navy p-0 text-white backdrop:bg-navy tab:m-auto tab:h-[min(92dvh,860px)] tab:max-w-md tab:rounded-[26px]"
    >
      <div
        className="relative flex h-full flex-col"
        onTouchStart={(e) => {
          touchY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(e) => {
          const y0 = touchY.current;
          const y1 = e.changedTouches[0]?.clientY;
          touchY.current = null;
          if (y0 !== null && y1 !== undefined && y1 - y0 > 90) onClose();
        }}
      >
        <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
          {ring.stories.map((s, i) => (
            <span key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              {/* transform only (no layout work per tick); reduced motion shows whole steps. */}
              <span
                className="block h-full origin-left bg-white"
                style={{
                  transform: `scaleX(${String(
                    i < pos.story ? 1 : i > pos.story ? 0 : timed ? Math.min(1, elapsed / PHOTO_MS) : 1,
                  )})`,
                }}
              />
            </span>
          ))}
        </div>
        <header className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p data-user-content className="font-bold">
              {who}
            </p>
            <p className="text-sm text-white/80">
              <time dateTime={story.createdAt}>{timeAgo(story.createdAt)}</time> ·{' '}
              {t('storyCount', { n: pos.story + 1, total: ring.stories.length })}
            </p>
          </div>
          <button type="button" onClick={onClose} className={STORY_BTN}>
            <UstaadIcon name="close" size={20} />
            {st('close')}
          </button>
        </header>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onPointerDown={() => {
            setHeld(true);
          }}
          onPointerUp={() => {
            setHeld(false);
          }}
          onPointerCancel={() => {
            setHeld(false);
          }}
          onPointerLeave={() => {
            setHeld(false);
          }}
        >
          {media?.kind === 'image' ? (
            <div className="w-full">
              <SignedImage
                key={media.mediaId}
                mediaId={media.mediaId}
                width={media.width}
                height={media.height}
                alt={t('storyOf', { name: who })}
                eager
              />
            </div>
          ) : null}
          {media?.kind === 'video' ? (
            <div className="relative z-10 w-full">
              <VideoTile key={media.mediaId} video={media} poster={poster} />
            </div>
          ) : null}
          {media?.kind === 'audio' ? (
            <div className="relative z-10 px-6">
              <VoiceNote key={media.mediaId} mediaId={media.mediaId} tone="dark" />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              step(-1);
            }}
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-1/3"
          />
          <button
            type="button"
            onClick={() => {
              step(1);
            }}
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-y-0 right-0 w-1/3"
          />
        </div>

        {/* The timer waits while a control or the caption has keyboard focus (WCAG 2.2.1). */}
        <footer
          onFocus={() => {
            setHeld(true);
          }}
          onBlur={() => {
            setHeld(false);
          }}
          className="grid gap-2 bg-navy/90 px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))]"
        >
          {story.body ? (
            <p data-user-content className="text-[16px] leading-relaxed">
              {story.body}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                step(-1);
              }}
              aria-label={t('storyPrev')}
              className={STORY_BTN}
            >
              <UstaadIcon name="prev" size={20} />
              {st('prev')}
            </button>
            {/* Always mounted (focus never drops when a voice/video story comes next); the label says the action. */}
            <button
              type="button"
              onClick={timed ? togglePause : undefined}
              aria-disabled={timed ? undefined : true}
              className={`${STORY_BTN} aria-disabled:opacity-50`}
            >
              <UstaadIcon name={paused ? 'play' : 'pause'} size={20} />
              {paused ? st('play') : st('pause')}
            </button>
            <button
              type="button"
              onClick={() => {
                step(1);
              }}
              aria-label={t('storyNext')}
              className={STORY_BTN}
            >
              {st('next')}
              <UstaadIcon name="next" size={20} />
            </button>
          </div>
          {ring.mine && story.seenBy !== null ? (
            <p className="text-sm font-bold text-white/85">{t('seenBy', { count: story.seenBy })}</p>
          ) : null}
          {!ring.mine ? (
            <Link
              href={localePath(`/ustaad/messages?to=${ring.author.handle}`, locale)}
              className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-button bg-white/15 px-4 font-bold focus-visible:outline-3 focus-visible:outline-white"
            >
              <UstaadIcon name="message" />
              {t('storyReply')}
            </Link>
          ) : null}
          <p className="sr-only">{t('storyHint')}</p>
          <p role="status" className="sr-only">
            {`${who}, ${t('storyCount', { n: pos.story + 1, total: ring.stories.length })}`}
          </p>
        </footer>
      </div>
    </dialog>
  );
}
