'use client';

import { LocateFixed, MapPin, Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import type { Location } from '@mechdost/shared/partners';
import { track } from '@/lib/analytics';
import type { PickPoint } from './location-map';

// MapLibre loads only when the dialog opens (JS budget, spec 16).
const LocationMap = dynamic(() => import('./location-map').then((m) => m.LocationMap), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-card bg-surface-alt tab:h-96" />,
});

interface Result {
  label: string;
  lat: number;
  lng: number;
}

/**
 * "Where is your shop?" (design 2026-11-13): use my location, search for the area (on Search, never as you type:
 * Nominatim policy), or tap / drag the pin; then confirm. Search and "use my location" work without the map, so a
 * seller can finish even if the map does not load.
 */
export function LocationPicker({
  value,
  onChange,
  invalid,
  describedBy,
}: {
  value: Location | null;
  onChange: (location: Location) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('apply');
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Location | null>(value);
  const [center, setCenter] = useState<PickPoint | null>(value ? { lat: value.lat, lng: value.lng } : null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<'gps' | 'search' | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  function open() {
    setDraft(value);
    setCenter(value ? { lat: value.lat, lng: value.lng } : null);
    setResults(null);
    setNote(null);
    dialog.current?.showModal();
  }

  function useMine() {
    if (!('geolocation' in navigator)) {
      setNote(t('locationDenied'));
      return;
    }
    setBusy('gps');
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(point);
        setDraft({ ...point, accuracyM: Math.round(pos.coords.accuracy), source: 'gps' });
        track('click', { id: 'partner_location_gps', path: window.location.pathname });
      },
      () => {
        setBusy(null);
        setNote(t('locationDenied'));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function search(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    const q = query.trim();
    if (q.length < 3) return;
    setBusy('search');
    setNote(null);
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { results: Result[] };
      setResults(body.results);
      if (body.results.length === 0) setNote(t('locationNoResults'));
      track('click', { id: 'partner_location_search', path: window.location.pathname });
    } catch {
      setResults(null);
      setNote(t('locationSearchFailed'));
    } finally {
      setBusy(null);
    }
  }

  function choose(r: Result) {
    const point = { lat: r.lat, lng: r.lng };
    setCenter(point);
    setDraft({ ...point, accuracyM: 100, source: 'search' });
    setResults(null);
  }

  function confirm() {
    if (!draft) return;
    onChange(draft);
    track('click', { id: `partner_location_${draft.source}`, path: window.location.pathname });
    dialog.current?.close();
  }

  const field =
    'min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted';

  return (
    <div>
      <button
        type="button"
        onClick={open}
        aria-invalid={invalid === true ? true : undefined}
        aria-describedby={describedBy}
        className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:bg-pill"
      >
        <MapPin aria-hidden="true" className="size-4" />
        {value ? t('locationChange') : t('locationButton')}
      </button>
      {value ? (
        <p className="mt-2 text-sm text-ink" role="status">
          {t('locationSet', { source: t(`locationSource_${value.source}`) })}
        </p>
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby="location-dialog-title"
        className="m-auto w-[min(100%-2rem,42rem)] rounded-dialog border border-line-card bg-surface p-0 text-ink shadow-dialog"
      >
        <div className="space-y-4 p-5">
          <h2 id="location-dialog-title" className="font-heading text-lg font-extrabold">
            {t('locationDialogTitle')}
          </h2>
          <button
            type="button"
            onClick={useMine}
            disabled={busy !== null}
            className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold"
          >
            <LocateFixed aria-hidden="true" className="size-4" />
            {busy === 'gps' ? t('locationLocating') : t('locationUseMine')}
          </button>
          <form onSubmit={(e) => void search(e)} role="search" className="flex gap-2">
            <label htmlFor="location-search" className="sr-only">
              {t('locationSearchLabel')}
            </label>
            <input
              id="location-search"
              type="search"
              value={query}
              minLength={3}
              maxLength={120}
              placeholder={t('locationSearchLabel')}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className={field}
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold"
            >
              <Search aria-hidden="true" className="size-4" />
              {t('locationSearchButton')}
            </button>
          </form>
          {results && results.length > 0 ? (
            <ul className="divide-y divide-line-card rounded-card border border-line-card">
              {results.map((r) => (
                <li key={`${String(r.lat)},${String(r.lng)}`}>
                  <button
                    type="button"
                    onClick={() => {
                      choose(r);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-pill"
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {note ? (
            <p role="status" className="text-sm text-muted">
              {note}
            </p>
          ) : null}
          {mapFailed ? (
            <p role="status" className="text-sm text-muted">
              {t('locationMapFailed')}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">{t('locationMapHint')}</p>
              <LocationMap
                center={center}
                locale={locale}
                label={t('locationPin')}
                onPick={(p) => {
                  setDraft({ ...p, accuracyM: 10, source: 'pin' });
                }}
                onFail={() => {
                  setMapFailed(true);
                }}
              />
            </>
          )}
          {draft ? (
            <p className="text-sm text-muted">{t('locationAccuracy', { meters: draft.accuracyM })}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="min-h-11 px-4 text-sm font-bold text-accent-soft-text"
            >
              {t('locationCancel')}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!draft}
              className="press min-h-11 rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60"
            >
              {t('locationConfirm')}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
