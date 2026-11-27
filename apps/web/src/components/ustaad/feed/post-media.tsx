'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { PostMediaView, PostView } from '@mechdost/shared/ustaad/dto/feed';
import { track } from '@/lib/analytics';
import { durationLabel, pollShares, sizeLabel } from '@/lib/ustaad/feed-format';
import { isDoubleTap } from '@/lib/ustaad/reactions';
import { socialClient } from '@/lib/ustaad/social-client';
import { VoiceNote } from '../media/voice-note';
import { UstaadIcon } from '../shell/icons';
import { BeforeAfter } from './before-after';
import { SignedImage } from './social-common';
import { MediaTextNote } from '../media/media-text-note';
import { playback } from '@/lib/ustaad/voice-ui';

/**
 * What a post shows under its words (spec 23 § 4 flow 4, § 17 low data): a photo gallery that swipes like the apps
 * mechanics use (scroll-snap, plus Previous/Next buttons and "1 / 3" for keyboards and screen readers), a voice note
 * (tap to load), a video that loads nothing until tapped (duration and data size on the cover), a PDF chip, a link
 * card that says it opens outside MechDost, and a poll. Nothing plays by itself.
 */

export function PhotoGallery({ media, eager = false }: { media: PostMediaView[]; eager?: boolean }) {
  const t = useTranslations('ustaad.feed');
  const strip = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [said, setSaid] = useState('');
  const total = media.length;
  const go = (i: number) => {
    const next = Math.max(0, Math.min(total - 1, i));
    const el = strip.current?.children[next] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    setIndex(next);
    // Announce only when a button moved the strip (a swipe is seen, and scroll ticks would be noisy).
    setSaid(t('photoOf', { n: next + 1, total }));
  };
  const roleWord = (m: PostMediaView) =>
    m.role === 'before' ? t('before') : m.role === 'after' ? t('after') : null;
  return (
    <div data-post-photo className="relative">
      <ul
        ref={strip}
        tabIndex={0}
        aria-label={t('kind_photo')}
        onScroll={(e) => {
          const w = e.currentTarget.clientWidth;
          if (w > 0) setIndex(Math.round(e.currentTarget.scrollLeft / w));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-focus"
      >
        {media.map((m, i) => (
          <li key={m.mediaId} className="relative w-full shrink-0 snap-start">
            <SignedImage
              mediaId={m.mediaId}
              width={m.width}
              height={m.height}
              eager={eager && i === 0}
              alt={[roleWord(m), t('photoOf', { n: i + 1, total })].filter(Boolean).join(', ')}
            />
            {roleWord(m) ? (
              <span
                aria-hidden="true"
                className="absolute top-3 left-3 rounded-full bg-navy/85 px-3 py-1 text-sm font-bold text-white"
              >
                {roleWord(m)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {total > 1 ? (
        <div className="mt-2 flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => {
              go(index - 1);
            }}
            aria-disabled={index === 0}
            aria-label={t('prevPhoto')}
            className="press inline-flex size-11 items-center justify-center rounded-full bg-pill text-ink aria-disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-focus"
          >
            <UstaadIcon name="chevronLeft" />
          </button>
          <p aria-hidden="true" className="text-sm font-bold text-muted tabular-nums">
            {t('photoOf', { n: index + 1, total })}
          </p>
          <span role="status" className="sr-only">
            {said}
          </span>
          <button
            type="button"
            onClick={() => {
              go(index + 1);
            }}
            aria-disabled={index === total - 1}
            aria-label={t('nextPhoto')}
            className="press inline-flex size-11 items-center justify-center rounded-full bg-pill text-ink aria-disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-focus"
          >
            <UstaadIcon name="chevronRight" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function band(ms: number | null): 'lt15' | '15to60' | '60to180' | 'gt180' {
  const s = (ms ?? 0) / 1000;
  return s < 15 ? 'lt15' : s < 60 ? '15to60' : s < 180 ? '60to180' : 'gt180';
}

/**
 * Tap to play: the cover shows the duration and the data it will use; the file is asked for only on the tap. The
 * author's captions play as a `<track kind="captions">` (a blob URL from the WebVTT in the DTO, so no cross-origin
 * fetch), and the summary or a visible "No captions" note sits under the video (spec 23 § 10a, WCAG 1.2.2).
 */
export function VideoTile({ video, poster }: { video: PostMediaView; poster: PostMediaView | undefined }) {
  return (
    <div>
      <VideoPlayer video={video} poster={poster} />
      <MediaTextNote summary={video.summary ?? null} captioned={Boolean(video.captionsVtt)} video />
    </div>
  );
}

function useCaptionsUrl(vtt: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!vtt) return;
    const u = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [vtt]);
  return url;
}

function VideoPlayer({ video, poster }: { video: PostMediaView; poster: PostMediaView | undefined }) {
  const tm = useTranslations('ustaad.media');
  const captionsUrl = useCaptionsUrl(video.captionsVtt);
  const handle = useRef({
    pause: () => {
      player.current?.pause();
    },
  });
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    // The cover button is gone once the video is there: move focus to the player's own controls.
    if (url) player.current?.focus();
  }, [url]);
  const time = durationLabel(video.durationMs ?? 0);
  const size = sizeLabel(video.bytes);
  async function play() {
    if (state === 'loading') return;
    setState('loading');
    const r = await (await socialClient(locale)).mediaUrl(video.mediaId, 'video');
    if (!r.ok) {
      setState('failed');
      return;
    }
    track('ustaad_video_played', { secondsBand: band(video.durationMs) });
    setUrl(r.data.url);
    setState('idle');
  }
  if (url)
    return (
      <video
        ref={player}
        src={url}
        controls
        autoPlay
        playsInline
        preload="none"
        className="aspect-video w-full bg-navy"
        onPlay={() => {
          playback.claim(handle.current);
        }}
        onError={() => {
          setUrl(null);
          setState('failed');
        }}
      >
        {captionsUrl ? (
          <track
            kind="captions"
            src={captionsUrl}
            srcLang={video.captionsLang ?? 'hi'}
            label={tm(video.captionsLang === 'en' ? 'captionsLangEn' : 'captionsLangHi')}
            default
          />
        ) : null}
      </video>
    );
  return (
    <div className="relative">
      {poster ? (
        <SignedImage mediaId={poster.mediaId} width={poster.width} height={poster.height} alt="" />
      ) : (
        <div className="aspect-video w-full bg-navy" />
      )}
      <button
        type="button"
        onClick={() => void play()}
        aria-disabled={state === 'loading'}
        aria-label={t('playVideo', { time, size })}
        className="press absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy/40 text-white focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-focus"
      >
        <span className="flex size-[72px] items-center justify-center rounded-full bg-accent-button shadow-float">
          <UstaadIcon name="play" size={34} filled />
        </span>
        <span className="rounded-full bg-navy/80 px-3 py-1 text-sm font-bold">
          {time} · {size}
        </span>
      </button>
      {state === 'failed' ? (
        <p role="alert" className="bg-warning-bg px-3 py-2 text-sm text-warning">
          {t('videoFailed')}
        </p>
      ) : null}
    </div>
  );
}

function DocChip({ doc }: { doc: PostMediaView }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  async function open() {
    const r = await (await socialClient(locale)).mediaUrl(doc.mediaId, 'document');
    if (r.ok) window.open(r.data.url, '_blank', 'noopener,noreferrer');
  }
  return (
    <button
      type="button"
      onClick={() => void open()}
      className="press mx-4 flex min-h-14 items-center gap-3 rounded-2xl border border-line-card bg-surface-alt px-4 text-left text-[15px] font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-text">
        <UstaadIcon name="doc" />
      </span>
      <span>{t('docOpen', { size: sizeLabel(doc.bytes) })}</span>
    </button>
  );
}

function LinkCard({ link }: { link: NonNullable<PostView['link']> }) {
  const t = useTranslations('ustaad.feed');
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="press mx-4 flex items-start gap-3 rounded-2xl border border-line-card bg-surface-alt p-4 text-ink focus-visible:outline-3 focus-visible:outline-focus"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-text">
        <UstaadIcon name="link" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        {link.preview?.title ? (
          <span data-user-content className="font-bold break-words">
            {link.preview.title}
          </span>
        ) : null}
        {link.preview?.description ? (
          <span data-user-content className="text-sm break-words text-muted">
            {link.preview.description}
          </span>
        ) : null}
        <span className="text-sm text-muted">
          <span lang="en" data-user-content className="font-bold text-ink underline">
            {link.host ?? link.url}
          </span>{' '}
          · {t('linkOutside')}
        </span>
      </span>
    </a>
  );
}

function Poll({ poll, onVote }: { poll: NonNullable<PostView['poll']>; onVote: (optionId: string) => void }) {
  const t = useTranslations('ustaad.feed');
  const { percents, total } = pollShares(poll.options.map((o) => o.votes));
  const showResults = poll.closed || poll.myOptionId !== null;
  const box = useRef<HTMLFieldSetElement>(null);
  const voted = useRef(false);
  useEffect(() => {
    // The pressed option turns into a result row: keep focus inside the poll.
    if (voted.current && poll.myOptionId) box.current?.focus();
  }, [poll.myOptionId]);
  return (
    <fieldset
      ref={box}
      tabIndex={-1}
      className="mx-4 grid gap-2 rounded-xl focus-visible:outline-3 focus-visible:outline-focus"
    >
      <legend className="sr-only">{t('pollLabel')}</legend>
      {poll.options.map((o, i) =>
        showResults ? (
          <div
            key={o.id}
            className="relative flex min-h-12 items-center justify-between gap-3 overflow-hidden rounded-xl border border-line-card px-4"
          >
            <span
              aria-hidden="true"
              style={{ width: `${String(percents[i] ?? 0)}%` }}
              className={`absolute inset-y-0 left-0 ${poll.myOptionId === o.id ? 'bg-accent-soft' : 'bg-pill'}`}
            />
            <span className="relative flex items-center gap-2 font-bold text-ink">
              {poll.myOptionId === o.id ? <UstaadIcon name="check" size={18} /> : null}
              <span data-user-content>{o.label}</span>
              {poll.myOptionId === o.id ? <span className="sr-only">{t('pollYours')}</span> : null}
            </span>
            <span className="relative font-bold text-ink tabular-nums">{percents[i] ?? 0}%</span>
          </div>
        ) : (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              voted.current = true;
              onVote(o.id);
            }}
            className="press min-h-12 rounded-xl border-2 border-accent bg-surface px-4 text-left font-bold text-accent-soft-text hover:bg-accent-soft focus-visible:outline-3 focus-visible:outline-focus"
          >
            {/* The option is member text: no aria-label (it would carry it out of `data-user-content`). */}
            <span className="sr-only">{t('pollVote')} </span>
            <span data-user-content>{o.label}</span>
          </button>
        ),
      )}
      <p className="text-sm text-muted">
        {t('pollVotes', { count: total })}
        {poll.closed ? ` · ${t('pollClosed')}` : null}
      </p>
    </fieldset>
  );
}

export function PostMedia({
  post,
  onVote,
  onDoubleTap,
  eager = false,
}: {
  post: PostView;
  onVote: (optionId: string) => void;
  /** U2 (E12): two taps on a photo within 250 ms; the card decides (it only ever likes). */
  onDoubleTap?: () => void;
  eager?: boolean;
}) {
  const images = post.media.filter((m) => m.kind === 'image');
  const audio = post.media.find((m) => m.kind === 'audio');
  const video = post.media.find((m) => m.kind === 'video');
  const doc = post.media.find((m) => m.kind === 'document');
  const before = images.find((m) => m.role === 'before');
  const after = images.find((m) => m.role === 'after');
  const lastTap = useRef<number | null>(null);
  const photos =
    post.template === 'before_after' && before && after ? (
      <BeforeAfter before={before} after={after} eager={eager} />
    ) : (
      <PhotoGallery media={images} eager={eager} />
    );
  return (
    <>
      {video ? <VideoTile video={video} poster={images[0]} /> : null}
      {!video && images.length > 0 ? (
        // Double tap = like (button stays the equivalent, 2.5.7); taps still reach the strip and its buttons.
        <div
          className="touch-manipulation"
          onPointerUp={(e) => {
            if (
              !onDoubleTap ||
              e.pointerType === 'mouse' ||
              (e.target as HTMLElement).closest('button,input,label')
            )
              return;
            const now = e.timeStamp;
            if (isDoubleTap(lastTap.current, now)) {
              lastTap.current = null;
              onDoubleTap();
            } else lastTap.current = now;
          }}
          onDoubleClick={(e) => {
            if (onDoubleTap && !(e.target as HTMLElement).closest('button,input,label')) onDoubleTap();
          }}
        >
          {photos}
        </div>
      ) : null}
      {audio ? (
        <div className="px-4">
          <VoiceNote
            mediaId={audio.mediaId}
            info={{ durationMs: audio.durationMs, bytes: audio.bytes, summary: audio.summary ?? null }}
          />
        </div>
      ) : null}
      {doc ? <DocChip doc={doc} /> : null}
      {post.link ? <LinkCard link={post.link} /> : null}
      {post.poll ? <Poll poll={post.poll} onVote={onVote} /> : null}
    </>
  );
}
