'use client';

import { Lock, MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localePath } from '@/lib/locale-path';
import type { Zone } from '@/lib/ustaad/client';
import { projectZones, zoneShade, zoneText, type Banded } from '@/lib/ustaad/local-view';
import {
  btnPrimary,
  card,
  LoadFailed,
  LoadingBlock,
  SampleNote,
  useCodeLabel,
  useErrorText,
  useUstaad,
} from '../common';

/** Fill per shade step: accent tints from the design tokens (no new colour). */
const SHADE = [
  'fill-surface-alt stroke-line-card',
  'fill-accent-soft stroke-accent/40',
  'fill-accent/55 stroke-accent',
  'fill-accent stroke-accent-button-hover',
] as const;
const W = 340;
const H = 220;
const R = 30;

function hexPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${String(Math.round(cx + r * Math.cos(a)))},${String(Math.round(cy + r * Math.sin(a)))}`;
  });
  return `M${pts.join('L')}Z`;
}

/**
 * Area map (spec 23 § 4 flow 10, § 9.6; verified members only): a stylised map of the city's zones — hexagons
 * shaded by the server's band — and the same zones as a list (the accessible equivalent, and the only view of the
 * per-work cells). Every number is the server's: "Few mechanics nearby", "5+" or an exact count from 20; nothing is
 * added up here. Not verified → a lock with one next action. Counts are rebuilt every night.
 */
export function AreaZones() {
  const t = useTranslations('ustaad.local');
  const locale = useLocale();
  const errorText = useErrorText('local');
  const label = useCodeLabel();
  const { loaded, reload, sample } = useUstaad((c) => c.zones(), 'zones');
  const [selected, setSelected] = useState<string | null>(null);

  const say = (b: Banded) => {
    const z = zoneText(b);
    return z.key === 'few' ? t('few') : t(z.key, { n: z.n });
  };

  const header = (
    <header>
      <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
        {t('areaTitle')}
      </h1>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{t('areaSub')}</p>
    </header>
  );

  if (loaded.state === 'loading')
    return (
      <div className="mx-auto grid max-w-2xl gap-5">
        {header}
        <LoadingBlock />
      </div>
    );
  if (loaded.state === 'error')
    return (
      <div className="mx-auto grid max-w-2xl gap-5">
        {header}
        {loaded.code === 'USTAAD_VERIFIED_ONLY' ? (
          <div className={`${card} grid justify-items-center gap-3 text-center`}>
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text">
              <Lock aria-hidden="true" className="size-7" />
            </span>
            <h2 className="font-heading text-lg font-extrabold text-ink">{t('lockH')}</h2>
            <p className="text-[15px] text-muted">{t('lockS')}</p>
            <Link
              href={localePath('/ustaad/me/location', locale)}
              className={btnPrimary}
              data-track="ustaad_area_lock_pin"
            >
              {t('lockCta')}
            </Link>
          </div>
        ) : (
          <LoadFailed message={errorText(loaded.code)} onRetry={reload} />
        )}
      </div>
    );

  const zones: Zone[] = loaded.data;
  const pts = projectZones(
    zones.map((z) => z.center),
    W,
    H,
    R + 4,
  );
  const names = new Map(zones.map((z, i) => [z.zoneCell, t('zoneName', { n: i + 1 })]));

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      {header}
      <SampleNote show={sample} />

      {zones.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
          <p className="text-[15px] text-ink">{t('noZones')}</p>
          <Link href={localePath('/ustaad/me/location', locale)} className={`${btnPrimary} mt-4`}>
            {t('title')}
          </Link>
        </div>
      ) : (
        <>
          <figure className={`${card} grid gap-3`}>
            <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="h-auto w-full" aria-hidden="true">
              {zones.map((z, i) => {
                const p = pts[i] ?? { x: W / 2, y: H / 2 };
                const shade = zoneShade(z.total);
                const isSel = z.zoneCell === selected;
                return (
                  <g key={z.zoneCell} aria-hidden="true">
                    <path
                      d={hexPath(p.x, p.y, R)}
                      className={`${SHADE[shade]} ${isSel ? 'stroke-navy' : ''}`}
                      strokeWidth={isSel ? 3 : 1.5}
                    />
                    <text
                      x={p.x}
                      y={p.y + 4}
                      textAnchor="middle"
                      className={`text-[11px] font-bold ${shade >= 2 ? 'fill-white' : 'fill-ink'}`}
                    >
                      {i + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
            <figcaption className="grid gap-1 text-sm text-muted">
              <span className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="flex gap-1">
                  {SHADE.map((s, i) => (
                    <svg key={i} width="18" height="14" viewBox="0 0 18 14">
                      <rect width="18" height="14" rx="3" className={s} />
                    </svg>
                  ))}
                </span>
                {t('legend')}
              </span>
              <span>{t('zoneSmall')}</span>
            </figcaption>
          </figure>

          <section aria-labelledby="ustaad-zones-list" className="grid gap-2">
            <h2 id="ustaad-zones-list" className="font-heading text-lg font-extrabold text-ink">
              {t('listH')}
            </h2>
            <ul className="grid gap-2">
              {zones.map((z) => {
                const name = names.get(z.zoneCell) ?? '';
                const open = z.zoneCell === selected;
                const cells = Object.entries(z.segments);
                return (
                  <li key={z.zoneCell}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => {
                        setSelected(open ? null : z.zoneCell);
                      }}
                      data-track="ustaad_area_zone"
                      className={`press flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left focus-visible:outline-3 focus-visible:outline-focus ${
                        open ? 'border-navy bg-surface' : 'border-line-card bg-surface hover:border-accent'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <MapPinned aria-hidden="true" className="size-5 text-accent-soft-text" />
                        <span className="text-[15px] font-bold text-ink">{name}</span>
                      </span>
                      <span className="text-[15px] font-bold text-ink">{say(z.total)}</span>
                    </button>
                    {open ? (
                      <div id={`zone-${z.zoneCell}`} className="mt-1 rounded-2xl bg-surface-alt p-4">
                        {cells.length > 0 ? (
                          <>
                            <p className="text-sm font-extrabold text-ink">{t('whoHere')}</p>
                            <ul className="mt-2 grid gap-1.5">
                              {cells.map(([code, b]) => (
                                <li key={code} className="flex justify-between gap-3 text-[15px] text-ink">
                                  <span>{label(code) ?? code}</span>
                                  <span className="font-bold">{say(b)}</span>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-sm text-muted">{t('zoneSmall')}</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-sm leading-relaxed text-muted">{t('zonePrivacy')}</p>
        </>
      )}
    </div>
  );
}
