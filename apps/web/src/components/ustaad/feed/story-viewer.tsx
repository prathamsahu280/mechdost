'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryRing } from '@mechdost/shared/ustaad/dto/feed';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { nextStory, type StoryPos } from '@/lib/ustaad/feed-format';
import { storyAdvance } from '@/lib/ustaad/story-advance';
import { useTimeAgo } from '../common';
import { VoiceNote } from '../media/voice-note';
import { UstaadIcon } from '../shell/icons';
import { VideoTile } from './post-media';
import { SignedImage, useMemberName, useSocialAction } from './social-common';

/** Visible control buttons (U1, design § 3.3): word + icon, 48 px; one constant for the visual-language pass. */
const STORY_BTN =
  'press inline-flex min-h-12 items-center justify-center gap-1.5 rounded-pill bg-white/15 px-3 text-[14px] font-bold text-white focus-visible:outline-3 focus-visible:outline-white';

/**
 * Full-screen story viewer (spec 23 § 4 flow 6): tap the right side for the next story, the left for the previous,
 * swipe down or Close to leave. Buttons do the same for keyboards and screen readers. Nothing moves on by itself
 * except a voice note or video the member played, which moves to the next story when it ends (WCAG 2.2.2, lead ruling
 * 2026-11-28, spec 23 § 21i-L): a visible "Auto next" switch turns that off, and with reduced motion it never moves.
 * Photos always wait for Next; voice and video play only when tapped (no autoplay). "Seen by N" shows on one's own
 * stories only. Each story viewed is reported once.
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
  const [autoNext, setAutoNext] = useState(true);
  const touchY = useRef<number | null>(null);
  const reported = useRef(new Set<string>());
  const ring = rings[pos.ring];
  const story = ring?.stories[pos.story];
  const kind = story?.media[0]?.kind ?? 'image';
  const onEnd = storyAdvance(kind === 'image' ? 'photo' : kind === 'audio' ? 'voice' : 'video', reduced);
  // On: a played voice note or video moves on when it ends. Never under reduced motion; never for photos.
  const auto = autoNext && !reduced;
  const toggleAuto = () => {
    track('ustaad_story_autonext', { on: !autoNext });
    setAutoNext((on) => !on);
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
      if (!next) onClose();
      else setPos(next);
    },
    [rings, pos, onClose],
  );
  // The players call this through a stable function so the latest `auto` and position are used at the moment it ends.
  const endedRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    endedRef.current = () => {
      if (auto && onEnd === 'on_end') step(1);
    };
  }, [auto, onEnd, step]);
  const handleEnded = useCallback(() => {
    endedRef.current();
  }, []);

  useEffect(() => {
    if (!story || ring.mine || reported.current.has(story.id)) return;
    reported.current.add(story.id);
    track('ustaad_story_viewed', {});
    onSeen(pos.ring, pos.story);
    void client().then((c) => c.viewStory(story.id));
  }, [story, ring, pos, client, onSeen]);

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
              {/* Steps, not a countdown: done and current stories are full (transform only). */}
              <span
                className="block h-full origin-left bg-white motion-safe:transition-transform motion-safe:duration-100 motion-safe:ease-linear"
                style={{ transform: `scaleX(${i <= pos.story ? '1' : '0'})` }}
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

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
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
              <VideoTile key={media.mediaId} video={media} poster={poster} onEnded={handleEnded} />
            </div>
          ) : null}
          {media?.kind === 'audio' ? (
            <div className="relative z-10 px-6">
              <VoiceNote key={media.mediaId} mediaId={media.mediaId} tone="dark" onEnded={handleEnded} />
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

        <footer className="grid gap-2 bg-navy/90 px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))]">
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
            {/* Always mounted (focus never drops between stories); the words carry the state, not colour alone. */}
            <button
              type="button"
              onClick={reduced ? undefined : toggleAuto}
              aria-pressed={auto}
              aria-disabled={reduced ? true : undefined}
              aria-describedby="story-auto-help"
              className={`${STORY_BTN} aria-disabled:opacity-50`}
            >
              <UstaadIcon name={auto ? 'pause' : 'play'} size={20} />
              {st('autoNext')}
              {/* The state is spoken by aria-pressed; the word is for the eye (not colour alone). */}
              <span aria-hidden="true">{auto ? st('autoNextOn') : st('autoNextOff')}</span>
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
          <p id="story-auto-help" className="sr-only">
            {st('autoNextHelp')}
          </p>
          <p className="sr-only">{t('storyHint')}</p>
          <p role="status" className="sr-only">
            {`${who}, ${t('storyCount', { n: pos.story + 1, total: ring.stories.length })}`}
          </p>
        </footer>
      </div>
    </dialog>
  );
}
