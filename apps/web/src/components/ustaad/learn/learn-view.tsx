'use client';

import { CheckCircle2, ExternalLink, GraduationCap, Play } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { LearnResourceView } from '@mechdost/shared/ustaad/dto/qa';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { ustaadClient } from '@/lib/ustaad/client';
import { learnTowardsNaya } from '@/lib/ustaad/card';
import { createWatchMeter, HEARTBEAT_MS } from '@/lib/ustaad/learn-meter';
import { progressBar } from '../card/styles';
import { Switch } from '../../ui/switch';
import {
  btnPrimary,
  btnQuiet,
  card,
  LoadFailed,
  LoadingBlock,
  SampleNote,
  useCodeLabel,
  useErrorText,
  useUstaad,
} from '../common';

const SAVER_KEY = 'mechdost-ustaad-data-saver';

/**
 * E15 (UI upgrade § 3.5): for Chhotu, "To become Naya Ustaad: 7/10 videos watched" — the reason to watch. Reads the
 * existing `GET /ustaad/me/card` (videos + the ladder's `minVideos`); nothing for Ustaads or when the card fails.
 */
function LearnProgress() {
  const t = useTranslations('ustaad.learn');
  const locale = useLocale();
  const labelId = useId();
  const [p, setP] = useState<{ done: number; need: number } | null>(null);
  useEffect(() => {
    let live = true;
    void import('@/lib/ustaad/identity-api')
      .then((api) => api.fetchMyCard(locale))
      .then((res) => {
        if (live && res.ok) setP(learnTowardsNaya(res.data));
      });
    return () => {
      live = false;
    };
  }, [locale]);
  if (!p) return null;
  return (
    <section aria-labelledby={labelId} className={`${card} grid gap-2`}>
      <p id={labelId} className="font-heading text-base font-extrabold text-ink">
        {t('towardsNaya', p)}
      </p>
      <progress aria-labelledby={labelId} value={p.done} max={p.need} className={progressBar}>
        {p.done}/{p.need}
      </progress>
    </section>
  );
}

function readSaver(): boolean {
  try {
    return window.localStorage.getItem(SAVER_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Learn (Seekho, spec 23 § 4 flow 12): courses with "N of M lessons done", then short videos. Data saver (on by
 * default, kept on this phone only): nothing loads until Play is tapped; off loads the first picture. Hosted videos
 * report watched seconds every 15 s while playing (the server credits at most the real time); external links open in
 * a new tab and can be self-marked as watched (capped a day by the API). "MechDost training" is labelled.
 */
export function LearnView() {
  const t = useTranslations('ustaad.learn');
  const locale = useLocale();
  const errorText = useErrorText('learn');
  const { loaded, reload, sample, set } = useUstaad((c) => c.learn(), 'learn');
  const [saver, setSaver] = useState(true);
  const saverId = useId();

  useEffect(() => {
    setSaver(readSaver());
  }, []);

  function changeSaver(on: boolean) {
    setSaver(on);
    try {
      window.localStorage.setItem(SAVER_KEY, on ? 'on' : 'off');
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    track('ustaad_data_saver', { on });
  }

  function patch(id: string, p: { watchedSeconds: number; completed: boolean }) {
    if (loaded.state !== 'ok') return;
    const fix = (r: LearnResourceView) => (r.id === id ? { ...r, ...p } : r);
    set({
      courses: loaded.data.courses.map((c) => ({ ...c, resources: c.resources.map(fix) })),
      loose: loaded.data.loose.map(fix),
    });
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header>
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted">{t('intro')}</p>
      </header>

      <LearnProgress />

      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <label htmlFor={saverId} className="font-heading text-base font-extrabold text-ink">
            {t('saverLabel')}
          </label>
          <p id={`${saverId}-help`} className="mt-0.5 text-sm text-muted">
            {t('saverHelp')}
          </p>
        </div>
        <Switch
          id={saverId}
          checked={saver}
          onChange={changeSaver}
          onText={t('saverOn')}
          offText={t('saverOff')}
          describedBy={`${saverId}-help`}
        />
      </div>

      <SampleNote show={sample} />

      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && loaded.data.courses.length === 0 && loaded.data.loose.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
          <p className="text-[15px] text-ink">{t('empty')}</p>
          <Link href={localePath('/ustaad/ask/new', locale)} className={`${btnPrimary} mt-4`}>
            {t('emptyCta')}
          </Link>
        </div>
      ) : null}

      {loaded.state === 'ok' && loaded.data.courses.length > 0 ? (
        <section aria-labelledby="ustaad-courses" className="grid gap-4">
          <h2 id="ustaad-courses" className="font-heading text-lg font-extrabold text-ink">
            {t('coursesH')}
          </h2>
          {loaded.data.courses.map((c) => {
            const done = c.resources.filter((r) => r.completed).length;
            const title = locale === 'hi' ? c.titleHi : c.titleEn;
            return (
              <article key={c.id} aria-labelledby={`course-${c.id}`} className={`${card} grid gap-3`}>
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text">
                    <GraduationCap aria-hidden="true" className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 id={`course-${c.id}`} className="font-heading text-[17px] font-extrabold text-ink">
                      {title}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted">
                      {t('lessons', { a: done, b: c.resources.length })}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-pill" role="presentation">
                      <div
                        className="h-full rounded-full bg-success"
                        style={{
                          width: `${String(c.resources.length ? Math.round((done / c.resources.length) * 100) : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <ul className="grid gap-2">
                  {c.resources.map((r) => (
                    <li key={r.id}>
                      <Resource r={r} saver={saver} onProgress={patch} />
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      ) : null}

      {loaded.state === 'ok' && loaded.data.loose.length > 0 ? (
        <section aria-labelledby="ustaad-shorts" className="grid gap-3">
          <h2 id="ustaad-shorts" className="font-heading text-lg font-extrabold text-ink">
            {t('shortsH')}
          </h2>
          <ul className="grid gap-2">
            {loaded.data.loose.map((r) => (
              <li key={r.id} className={card}>
                <Resource r={r} saver={saver} onProgress={patch} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Resource({
  r,
  saver,
  onProgress,
}: {
  r: LearnResourceView;
  saver: boolean;
  onProgress: (id: string, p: { watchedSeconds: number; completed: boolean }) => void;
}) {
  const t = useTranslations('ustaad.learn');
  const locale = useLocale();
  const label = useCodeLabel();
  const errorText = useErrorText('learn');
  const [src, setSrc] = useState<{ url: string; tapped: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const title = locale === 'hi' ? r.titleHi : r.titleEn;
  const length =
    r.durationS === null
      ? null
      : r.durationS >= 60
        ? t('minutes', { m: Math.round(r.durationS / 60) })
        : t('seconds', { s: r.durationS });
  const pct = r.durationS ? Math.min(100, Math.round((r.watchedSeconds / r.durationS) * 100)) : 0;
  const tags = [label(r.segmentCode), label(r.workCode)].filter((x): x is string => x !== null);

  async function open(tapped: boolean) {
    if (!r.mediaId) return;
    setOpening(true);
    const res = await (await ustaadClient(locale)).mediaUrl(r.mediaId);
    setOpening(false);
    if (res.ok) setSrc({ url: res.data.url, tapped });
    else if (tapped) setMsg({ ok: false, text: t('videoUnavailable') });
  }

  // Data saver off: show the first picture without a tap (the video still never plays by itself).
  useEffect(() => {
    if (!saver && r.kind === 'hosted_video' && r.mediaId && !src) void open(false);
    // Runs when the saver choice changes; `open` is stable enough for this one-shot load.
  }, [saver]);

  async function selfMark() {
    const res = await (await ustaadClient(locale)).progress(r.id, { selfMark: true });
    if (!res.ok) {
      setMsg({ ok: false, text: errorText(res.code) });
      return;
    }
    onProgress(r.id, res.data);
    if (res.data.completed && !r.completed) track('ustaad_learn_completed', { resource: r.id });
    setMsg({ ok: true, text: t('markedWatched') });
  }

  return (
    <div className="grid gap-2.5 rounded-xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] leading-snug font-bold text-ink">{title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {length ? <span>{length}</span> : null}
            {tags.map((x) => (
              <span key={x} className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-bold text-ink">
                {x}
              </span>
            ))}
            {r.label === 'mechdost_training' ? (
              <span className="rounded-full bg-info-bg px-2 py-0.5 text-xs font-bold text-info">
                {t('mechdostTraining')}
              </span>
            ) : null}
          </p>
        </div>
        {r.completed ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-xs font-bold text-success">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {t('watched')}
          </span>
        ) : pct > 0 ? (
          <span className="shrink-0 text-xs font-bold text-muted">{t('progress', { pct })}</span>
        ) : null}
      </div>

      {r.kind === 'hosted_video' && r.mediaId ? (
        src ? (
          <HostedPlayer r={r} src={src.url} saver={saver} autoPlay={src.tapped} onProgress={onProgress} />
        ) : (
          <button
            type="button"
            className={`${btnQuiet} justify-self-start`}
            onClick={() => void open(true)}
            disabled={opening}
            data-track="ustaad_learn_play"
          >
            <Play aria-hidden="true" className="size-5 text-accent-soft-text" />
            {t('play')}
            <span className="sr-only">{title}</span>
            {length ? <span className="font-normal text-muted">· {length}</span> : null}
          </button>
        )
      ) : null}

      {r.kind === 'external_link' && r.url ? (
        <div className="flex flex-wrap gap-2">
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className={btnQuiet}
            data-track="ustaad_learn_external"
          >
            <ExternalLink aria-hidden="true" className="size-5" />
            {t('openLink')}
            <span className="sr-only">({t('external')})</span>
          </a>
          {r.completed ? null : (
            <button
              type="button"
              className={btnQuiet}
              onClick={() => void selfMark()}
              data-track="ustaad_learn_selfmark"
            >
              {t('markWatched')}
            </button>
          )}
        </div>
      ) : null}
      <p
        role="status"
        className={`text-sm font-bold empty:sr-only ${msg?.ok ? 'text-success' : 'text-error'}`}
      >
        {msg?.text ?? ''}
      </p>
    </div>
  );
}

/** `ustaad_video_played.secondsBand` (spec 23 § 16): how long this player actually played, never the number. */
function secondsBand(ms: number): 'lt15' | '15to60' | '60to180' | 'gt180' {
  const s = ms / 1000;
  if (s < 15) return 'lt15';
  if (s < 60) return '15to60';
  if (s <= 180) return '60to180';
  return 'gt180';
}

function HostedPlayer({
  r,
  src,
  saver,
  autoPlay,
  onProgress,
}: {
  r: LearnResourceView;
  src: string;
  saver: boolean;
  autoPlay: boolean;
  onProgress: (id: string, p: { watchedSeconds: number; completed: boolean }) => void;
}) {
  const locale = useLocale();
  const meter = useRef(createWatchMeter());
  const playedMs = useRef(0);
  const playingSince = useRef<number | null>(null);
  const wasCompleted = useRef(r.completed);
  const report = useRef(onProgress);
  report.current = onProgress;
  const video = useRef<HTMLVideoElement>(null);

  const startClock = () => {
    const now = Date.now();
    meter.current.play(now);
    playingSince.current ??= now;
  };
  const stopClock = () => {
    const now = Date.now();
    meter.current.pause(now);
    if (playingSince.current !== null) playedMs.current += now - playingSince.current;
    playingSince.current = null;
  };

  useEffect(() => {
    async function beat() {
      const delta = meter.current.take(Date.now());
      if (delta === null) return;
      const res = await (await ustaadClient(locale)).progress(r.id, { deltaSeconds: delta });
      if (!res.ok) return;
      report.current(r.id, res.data);
      if (res.data.completed && !wasCompleted.current) {
        wasCompleted.current = true;
        track('ustaad_learn_completed', { resource: r.id });
      }
    }
    const id = window.setInterval(() => void beat(), HEARTBEAT_MS);
    const v = video.current;
    return () => {
      window.clearInterval(id);
      v?.pause();
      stopClock();
      void beat();
      if (playedMs.current > 0) track('ustaad_video_played', { secondsBand: secondsBand(playedMs.current) });
    };
  }, [r.id, locale]);

  useEffect(() => {
    if (autoPlay) void video.current?.play().catch(() => undefined);
  }, [autoPlay]);

  return (
    <video
      ref={video}
      src={src}
      aria-label={locale === 'hi' ? r.titleHi : r.titleEn}
      controls
      playsInline
      preload={saver ? 'none' : 'metadata'}
      className="aspect-video w-full rounded-xl bg-navy"
      onPlay={startClock}
      onPause={stopClock}
      onEnded={stopClock}
      onSeeking={stopClock}
      onSeeked={(e) => {
        if (!e.currentTarget.paused) startClock();
      }}
    />
  );
}
