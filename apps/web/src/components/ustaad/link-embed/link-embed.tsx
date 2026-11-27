'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { youtubeThumbUrl, youtubeWatchUrl } from '@mechdost/shared/ustaad/video-links';
import { track } from '@/lib/analytics';
import { UstaadIcon } from '../shell/icons';
import { startClock, videoFrameProps, type EmbedVideo } from './model';

/** Fired when any player in the page starts, so the others stop (one player at a time). */
const PLAY_EVENT = 'mechdost:media-play';

export interface LinkEmbedVideo extends EmbedVideo {
  title: string | null;
  author: string | null;
}

/**
 * A video link in a post (spec 23 § 10b): a click-to-play facade (YouTube thumbnail via next/image, play button,
 * title, source label, start time, data note, "Open in YouTube"). Nothing from YouTube loads until the tap: then the
 * privacy-enhanced player replaces the thumbnail in the same 16:9 box (no layout shift). The player is removed again
 * when another video or voice note starts, when it scrolls out of view, or on "Close video" (the YouTube iframe
 * cannot be paused from outside without its JS API, so unmounting is the pause).
 */
export function LinkEmbed({ video, eager = false }: { video: LinkEmbedVideo; eager?: boolean }) {
  const t = useTranslations('ustaad.videoLink');
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const facade = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const me = useId();
  const startAt = startClock(video.startS);

  useEffect(() => {
    if (!playing) {
      if (returnFocus.current) facade.current?.focus();
      returnFocus.current = false;
      return;
    }
    frame.current?.focus();
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: me }));
    const stop = () => {
      setPlaying(false);
    };
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== me) stop();
    };
    // Native <video>/<audio> in the feed (voice notes, hosted videos) start with a bubbling-less `play`: capture it.
    const onNativePlay = () => {
      stop();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    document.addEventListener('play', onNativePlay, true);
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              if (entry && !entry.isIntersecting) stop();
            },
            { threshold: 0 },
          );
    if (box.current) io?.observe(box.current);
    return () => {
      window.removeEventListener(PLAY_EVENT, onOther);
      document.removeEventListener('play', onNativePlay, true);
      io?.disconnect();
    };
  }, [playing, me]);

  function start() {
    track('ustaad_video_link_played', { provider: video.provider });
    setPlaying(true);
  }

  const frameTitle = video.title ? t('playerTitle', { title: video.title }) : t('playerTitleUntitled');
  return (
    <figure className="mx-4 overflow-hidden rounded-2xl border border-line-card bg-surface-alt">
      <div ref={box} className="relative aspect-video w-full bg-navy">
        {playing ? (
          <iframe
            ref={frame}
            {...videoFrameProps(video, frameTitle)}
            className="absolute inset-0 size-full"
          />
        ) : (
          <>
            <Image
              src={youtubeThumbUrl(video.videoId)}
              alt=""
              fill
              sizes="(min-width: 768px) 600px, 100vw"
              className="object-cover"
              priority={eager}
            />
            <button
              ref={facade}
              type="button"
              onClick={start}
              aria-label={video.title ? t('play', { title: video.title }) : t('playUntitled')}
              className="press absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy/40 text-white focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-focus"
            >
              <span className="flex size-[72px] items-center justify-center rounded-full bg-accent-button shadow-float">
                <UstaadIcon name="play" size={34} filled />
              </span>
              <span lang="en" className="rounded-full bg-navy/80 px-3 py-1 text-sm font-bold">
                {t('source')}
                {startAt ? ` · ${t('startsAt', { time: startAt })}` : ''}
              </span>
            </button>
          </>
        )}
      </div>
      <figcaption className="grid gap-1 p-4 text-ink">
        {video.title ? (
          <span data-user-content className="font-bold break-words">
            {video.title}
          </span>
        ) : null}
        {video.author ? (
          <span data-user-content className="text-sm text-muted">
            {t('by', { author: video.author })}
          </span>
        ) : null}
        <span className="text-sm text-muted">{t('dataNote')}</span>
        <span className="flex flex-wrap items-center gap-3">
          <a
            href={youtubeWatchUrl(video.videoId)}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="inline-flex min-h-11 items-center font-bold text-ink underline focus-visible:outline-3 focus-visible:outline-focus"
          >
            {t('openInYouTube')}
          </a>
          {playing ? (
            <button
              type="button"
              onClick={() => {
                returnFocus.current = true;
                setPlaying(false);
              }}
              className="press inline-flex min-h-11 items-center rounded-full bg-pill px-4 font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus"
            >
              {t('close')}
            </button>
          ) : null}
        </span>
      </figcaption>
    </figure>
  );
}
