'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  AdminHomeLayout,
  AdminLayoutSaved,
  OkTrue,
  type AdminHomeLayoutDto,
} from '@mechdost/shared/admin-config-api';
import {
  cleanHomeLayout,
  DEFAULT_FEATURED,
  FEATURED_MAX,
  FEATURED_MIN,
  HOME_CATEGORY_KEYS,
  HOME_SECTIONS,
  type HomeCategory,
  type HomeSection,
  type MapMode,
} from '@mechdost/shared/site-layout';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { CATEGORY_EMOJI } from '@/lib/emoji';
import { CityPicker } from './admin-city-picker';
import { LoadState } from './admin-site-api';
import { portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

/**
 * Admin -> Home layout on the API (design 2026-11-15 item 6; spec 08). The same choices as the demo editor: the order
 * and visibility of the home sections, which 3 to 6 category tiles show (with their emoji), and the workshop map's
 * default view. One save publishes it; the home page is rendered with it on the server and refreshed at once. A city
 * can have its own layout; until it does it shows the all-cities one.
 */
type Status = 'idle' | 'busy' | 'saved' | 'reset' | 'invalid' | CommonErrorKey;

export function LayoutApi() {
  const locale = useLocale();
  const [city, setCity] = useState('');
  const [view, setView] = useState<AdminHomeLayoutDto | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/site/layout${city ? `?city=${city}` : ''}`, AdminHomeLayout);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setView(res.data);
  }, [locale, city]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  return (
    <section aria-labelledby="admin-page-title" className="space-y-4">
      <CityPicker id="layout-city" value={city} onChange={setCity} />
      {view ? (
        <LayoutForm key={`${city}|${String(view.version)}`} city={city} view={view} onChanged={load} />
      ) : (
        <LoadState
          error={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

const isSection = (v: string): v is HomeSection => HOME_SECTIONS.some((s) => s === v);
const isCategory = (v: string): v is HomeCategory => HOME_CATEGORY_KEYS.some((k) => k === v);

function LayoutForm({
  city,
  view,
  onChanged,
}: {
  city: string;
  view: AdminHomeLayoutDto;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('adminTier2');
  const p = useTranslations('portal');
  const cat = useTranslations('categories');
  const locale = useLocale();
  const [order, setOrder] = useState<HomeSection[]>(view.layout.order.filter(isSection));
  const [hidden, setHidden] = useState<HomeSection[]>(view.layout.hidden.filter(isSection));
  const [featured, setFeatured] = useState<HomeCategory[]>(
    view.layout.featured?.filter(isCategory) ?? [...DEFAULT_FEATURED],
  );
  const [emoji, setEmoji] = useState<Partial<Record<HomeCategory, string>>>(
    Object.fromEntries(Object.entries(view.layout.emoji).filter(([k]) => isCategory(k))),
  );
  const [mapDefault, setMapDefault] = useState<MapMode>(view.layout.mapDefault);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const touch = () => {
    setStatus('idle');
    setMessage('');
  };

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    touch();
    setOrder((o) => {
      const next = [...o];
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const layout = { order, hidden, featured, emoji, mapDefault };
    const checked = cleanHomeLayout(layout);
    if (!checked.ok) {
      setMessage(
        checked.problem === 'featured_count'
          ? p('categories_errCount', { min: FEATURED_MIN, max: FEATURED_MAX })
          : checked.problem === 'emoji'
            ? t('lay_errEmoji')
            : t('lay_errGeneric'),
      );
      setStatus('invalid');
      return;
    }
    setStatus('busy');
    const res = await adminApi(locale, '/admin/site/layout', AdminLayoutSaved, {
      method: 'PUT',
      body: { city: city || null, layout: checked.layout, version: view.version },
    });
    if (!res.ok) {
      setStatus(commonErrorKey(res.code));
      await onChanged();
      return;
    }
    setStatus('saved');
    track('admin_site_change', { area: 'layout', action: 'publish', fields: hidden.length });
    await onChanged();
  }

  async function onReset() {
    if (view.version === null) return;
    setStatus('busy');
    const res = await adminApi(locale, '/admin/site/layout/reset', OkTrue, {
      method: 'POST',
      body: { city: city || null, version: view.version },
    });
    if (!res.ok) {
      setStatus(commonErrorKey(res.code));
      await onChanged();
      return;
    }
    setStatus('reset');
    track('admin_site_change', { area: 'layout', action: 'reset', fields: 0 });
    await onChanged();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={`${adminCard} space-y-6`}
      noValidate
    >
      {city && view.inherited ? (
        <p role="note" className="rounded-tile bg-pill px-4 py-3 text-sm text-ink">
          {t('lay_inherited')}
        </p>
      ) : null}

      <fieldset>
        <legend className="font-heading text-base font-extrabold text-ink">{p('layout_title')}</legend>
        <p className="mt-2 rounded-tile bg-pill px-4 py-3 text-sm font-bold text-ink">
          <span aria-hidden="true">📌 </span>
          {p('layout_heroFirst')}
        </p>
        <ol className="mt-3 space-y-2">
          {order.map((key, i) => {
            const name = p(`section_${key}`);
            const isHidden = hidden.includes(key);
            return (
              <li
                key={key}
                className={`flex flex-wrap items-center gap-3 rounded-tile border border-line-card px-4 py-2 ${isHidden ? 'bg-pill' : 'bg-surface'}`}
              >
                <span className="w-6 text-sm font-bold text-muted">{i + 1}</span>
                <span
                  className={`min-w-[9rem] flex-1 text-sm font-bold ${isHidden ? 'text-muted' : 'text-ink'}`}
                >
                  {name}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={(e) => {
                        touch();
                        setHidden((h) => (e.target.checked ? h.filter((x) => x !== key) : [...h, key]));
                      }}
                      className="size-5 accent-[var(--color-accent-button)]"
                    />
                    {p('layout_show')}
                    <span className="sr-only"> {name}</span>
                  </label>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        move(i, -1);
                      }}
                      disabled={i === 0}
                      aria-label={p('layout_up', { name })}
                      className={`${portalQuiet} min-w-11 px-0 disabled:opacity-40`}
                    >
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        move(i, 1);
                      }}
                      disabled={i === order.length - 1}
                      aria-label={p('layout_down', { name })}
                      className={`${portalQuiet} min-w-11 px-0 disabled:opacity-40`}
                    >
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </button>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </fieldset>

      <fieldset>
        <legend className="font-heading text-base font-extrabold text-ink">{p('categories_title')}</legend>
        <p className="mt-1 text-sm text-muted">
          {p('categories_lead', { min: FEATURED_MIN, max: FEATURED_MAX })}
        </p>
        <p className="mt-2 text-sm font-bold text-ink" aria-live="polite">
          {p('categories_count', { count: featured.length, max: FEATURED_MAX })}
        </p>
        <ul className="mt-3 grid gap-2 tab:grid-cols-2 nav:grid-cols-3">
          {HOME_CATEGORY_KEYS.map((key) => {
            const on = featured.includes(key);
            const name = cat(key);
            return (
              <li
                key={key}
                className={`flex items-center gap-3 rounded-tile border px-3 py-2 ${on ? 'border-accent-button bg-accent-soft' : 'border-line-card bg-surface'}`}
              >
                <label htmlFor={`lay-emoji-${key}`} className="sr-only">
                  {p('categories_emoji', { name })}
                </label>
                <input
                  id={`lay-emoji-${key}`}
                  value={emoji[key] ?? ''}
                  placeholder={CATEGORY_EMOJI[key]}
                  maxLength={16}
                  onChange={(e) => {
                    touch();
                    setEmoji((m) => ({ ...m, [key]: e.target.value }));
                  }}
                  className="min-h-11 w-14 shrink-0 rounded-input border border-input-border bg-surface text-center text-[22px] text-ink placeholder:opacity-60"
                />
                <label className="inline-flex min-h-11 flex-1 items-center gap-2 text-sm font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      touch();
                      setFeatured((f) => (e.target.checked ? [...f, key] : f.filter((x) => x !== key)));
                    }}
                    className="size-5 accent-[var(--color-accent-button)]"
                  />
                  {name}
                  <span className="sr-only">{p('categories_onHome')}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="font-heading text-base font-extrabold text-ink">{p('mapDefault_title')}</legend>
        <p className="mt-1 text-sm text-muted">{p('mapDefault_help')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {(['satellite', 'map'] as const).map((value) => (
            <label
              key={value}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-3 text-sm font-bold text-ink has-[:checked]:border-accent-button has-[:checked]:bg-accent-soft"
            >
              <input
                type="radio"
                name="lay-map-default"
                value={value}
                checked={mapDefault === value}
                onChange={() => {
                  touch();
                  setMapDefault(value);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              <span aria-hidden="true">{value === 'satellite' ? '🛰️' : '🗺️'}</span>
              {p(value === 'satellite' ? 'mapDefault_satellite' : 'mapDefault_map')}
            </label>
          ))}
        </div>
      </fieldset>

      {status === 'invalid' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('lay_save')}
        </button>
        {view.version !== null ? (
          <button
            type="button"
            disabled={status === 'busy'}
            onClick={() => {
              void onReset();
            }}
            className={portalQuiet}
          >
            {city ? t('lay_resetCity') : t('lay_resetDefault')}
          </button>
        ) : null}
        <a
          href={locale === 'hi' ? '/hi' : '/'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold text-ink underline-offset-4 hover:underline"
        >
          {t('lay_openHome')}
        </a>
        <LayoutStatus status={status} />
      </div>
    </form>
  );
}

function LayoutStatus({ status }: { status: Status }) {
  const t = useTranslations('adminTier2');
  const p = useTranslations('portal');
  if (status === 'idle' || status === 'invalid') return <p role="status" className="text-sm font-bold" />;
  const text =
    status === 'busy'
      ? p('api_common_saving')
      : status === 'saved'
        ? t('lay_saved')
        : status === 'reset'
          ? t('lay_reset')
          : p(status);
  const tone =
    status === 'busy'
      ? 'text-muted'
      : status === 'saved' || status === 'reset'
        ? 'text-success'
        : 'text-error';
  return (
    <p role="status" className={`text-sm font-bold ${tone}`}>
      {text}
    </p>
  );
}
