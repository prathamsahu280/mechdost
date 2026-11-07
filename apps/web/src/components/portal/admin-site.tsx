'use client';

import { ArrowDown, ArrowUp, Pin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { CATEGORY_KEYS, type CategoryKey } from '@/demo/catalogue';
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  contentMax,
  resetArea,
  saveCategories,
  saveContent,
  saveLayout,
  saveSettings,
  useSiteConfig,
  type AuditEntry,
  type ContentKey,
  type SiteConfig,
  type SiteSettings,
  saveMapDefault,
} from '@/demo/site-config';
import type { MapMode } from '@/lib/map-styles';
import { track } from '@/lib/analytics';
import { CATEGORY_ICONS } from '@/lib/icons';
import {
  DEFAULT_FEATURED,
  FEATURED_MAX,
  FEATURED_MIN,
  HOME_SECTIONS,
  type HomeSection,
} from '@/lib/site-layout';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

/** Default text per content key in both locales, resolved on the server from the locale files. */
export type ContentDefaults = Record<ContentKey, { en: string; hi: string }>;

type Status = 'idle' | 'saved' | 'reset' | 'stale' | 'invalid';

const fieldId = (key: string) => key.replace('.', '_');

/** Label message per content key (explicit literals keep next-intl's key checking). */
const FIELD_LABEL = {
  'hero.eyebrow': 'field_hero_eyebrow',
  'hero.titleLine1': 'field_hero_titleLine1',
  'hero.titleLine2': 'field_hero_titleLine2',
  'hero.lead': 'field_hero_lead',
} as const satisfies Record<ContentKey, string>;

function usePrefix() {
  return useLocale() === 'hi' ? '/hi' : '';
}

/** Save / reset row with a live status message (one primary action per card). */
function Actions({ status, onReset, extra }: { status: Status; onReset: () => void; extra?: ReactNode }) {
  const t = useTranslations('portal');
  const message =
    status === 'saved'
      ? t('site_saved')
      : status === 'reset'
        ? t('site_resetDone')
        : status === 'stale'
          ? t('site_stale')
          : status === 'invalid'
            ? t('site_invalid')
            : '';
  const tone = status === 'stale' || status === 'invalid' ? 'text-error' : 'text-success';
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      <button type="submit" className={portalPrimary}>
        {t('site_save')}
      </button>
      <button type="button" onClick={onReset} className={portalQuiet}>
        {t('site_reset')}
      </button>
      {extra}
      <p role="status" className={`text-sm font-bold ${tone}`}>
        {message}
      </p>
    </div>
  );
}

function DemoNote() {
  const t = useTranslations('portal');
  return <p className="rounded-lg bg-private-bg p-3 text-sm text-private">{t('site_demoNote')}</p>;
}

function PreviewLink() {
  const t = useTranslations('portal');
  const prefix = usePrefix();
  return (
    <Link
      href={prefix || '/'}
      data-track="admin_site_preview"
      className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
    >
      {t('site_preview')}
      <span aria-hidden="true">&nbsp;↗</span>
    </Link>
  );
}

// ── Site content ──────────────────────────────────────────────────────────────────────────────────────────────

const CONTENT_GROUPS: { id: 'hero'; keys: ContentKey[] }[] = [
  { id: 'hero', keys: ['hero.eyebrow', 'hero.titleLine1', 'hero.titleLine2', 'hero.lead'] },
];

export function ContentEditor({ actor, defaults }: { actor: string; defaults: ContentDefaults }) {
  const t = useTranslations('portal');
  const config = useSiteConfig();
  const [version, setVersion] = useState(config.versions.content);
  const [draft, setDraft] = useState<SiteConfig['content']>(config.content);
  const [status, setStatus] = useState<Status>('idle');

  function set(key: ContentKey, locale: 'en' | 'hi', value: string) {
    setStatus('idle');
    setDraft((d) => ({ ...d, [key]: { ...d[key], [locale]: value } }));
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!saveContent(version, actor, draft)) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setStatus('saved');
    track('admin_site_change', { area: 'content', action: 'save', fields: Object.keys(draft).length });
  }

  function onReset() {
    if (!resetArea(version, actor, 'content')) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setDraft({});
    setStatus('reset');
    track('admin_site_change', { area: 'content', action: 'reset', fields: 0 });
  }

  return (
    <section aria-labelledby="content-title" className="space-y-4">
      <div>
        <h2 id="content-title" className="font-heading text-xl font-extrabold text-ink">
          {t('content_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('content_lead')}</p>
      </div>
      <DemoNote />
      <form onSubmit={onSubmit} className={portalCard} noValidate>
        {CONTENT_GROUPS.map((group) => (
          <fieldset key={group.id} className="mt-2 first:mt-0">
            <legend className="font-heading text-lg font-extrabold text-ink">
              {t(`content_group_${group.id}`)}
            </legend>
            <div className="mt-3 space-y-5">
              {group.keys.map((key) => {
                const id = fieldId(key);
                const max = contentMax(key);
                const long = max > 120;
                return (
                  <div key={key} className="rounded-tile border border-line-card p-4">
                    <p className="text-sm font-bold text-ink">{t(FIELD_LABEL[key])}</p>
                    <div className="mt-2 grid gap-3 tab:grid-cols-2">
                      {(['en', 'hi'] as const).map((locale) => {
                        const inputId = `content-${id}-${locale}`;
                        const value = draft[key]?.[locale] ?? '';
                        const common = {
                          id: inputId,
                          value,
                          maxLength: max,
                          lang: locale,
                          placeholder: defaults[key][locale],
                          'aria-describedby': `${inputId}-hint`,
                          className: `${portalField} ${long ? 'min-h-24 py-2' : ''}`,
                        };
                        return (
                          <div key={locale}>
                            <label htmlFor={inputId} className="text-xs font-bold text-muted">
                              {t(`content_${locale}`)}
                            </label>
                            {long ? (
                              <textarea
                                {...common}
                                rows={3}
                                onChange={(e) => {
                                  set(key, locale, e.target.value);
                                }}
                              />
                            ) : (
                              <input
                                {...common}
                                onChange={(e) => {
                                  set(key, locale, e.target.value);
                                }}
                              />
                            )}
                            <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
                              {value
                                ? t('content_count', { count: value.length, max })
                                : t('content_usingDefault')}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        <Actions status={status} onReset={onReset} extra={<PreviewLink />} />
      </form>
      <RecentChanges />
    </section>
  );
}

// ── Home layout + category shortcuts ──────────────────────────────────────────────────────────────────────────

export function LayoutEditor({ actor }: { actor: string }) {
  return (
    <div className="space-y-6">
      <SectionsEditor actor={actor} />
      <CategoriesEditor actor={actor} />
      <MapDefaultEditor actor={actor} />
      <RecentChanges />
    </div>
  );
}

/** Workshop map default view (user 2026-11-02: satellite by default, admin can change it). */
function MapDefaultEditor({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const config = useSiteConfig();
  const [version, setVersion] = useState(config.versions.layout);
  const [mode, setMode] = useState<MapMode>(config.layout.mapDefault);
  const [status, setStatus] = useState<'idle' | 'saved' | 'stale'>('idle');

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!saveMapDefault(version, actor, mode)) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setStatus('saved');
    track('admin_site_change', { area: 'layout', action: 'save', fields: 1 });
  }

  return (
    <form onSubmit={onSubmit} className={portalCard}>
      <fieldset>
        <legend className="font-heading text-base font-extrabold text-ink">{t('mapDefault_title')}</legend>
        <p className="mt-1 text-sm text-muted">{t('mapDefault_help')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {(['satellite', 'map'] as const).map((value) => (
            <label
              key={value}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-3 text-sm font-bold text-ink has-[:checked]:border-accent-button has-[:checked]:bg-accent-soft"
            >
              <input
                type="radio"
                name="map-default"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setStatus('idle');
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              <span aria-hidden="true">{value === 'satellite' ? '🛰️' : '🗺️'}</span>
              {t(value === 'satellite' ? 'mapDefault_satellite' : 'mapDefault_map')}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={portalPrimary}>
          {t('mapDefault_save')}
        </button>
        <p role="status" className="text-sm font-bold">
          {status === 'saved' ? <span className="text-success">{t('notify_saved')}</span> : null}
          {status === 'stale' ? <span className="text-error">{t('notify_stale')}</span> : null}
        </p>
      </div>
    </form>
  );
}

function SectionsEditor({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const config = useSiteConfig();
  const [version, setVersion] = useState(config.versions.layout);
  const [order, setOrder] = useState<HomeSection[]>(config.layout.order);
  const [hidden, setHidden] = useState<HomeSection[]>(config.layout.hidden);
  const [status, setStatus] = useState<Status>('idle');

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    setStatus('idle');
    setOrder((o) => {
      const next = [...o];
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!saveLayout(version, actor, { order, hidden })) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setStatus('saved');
    track('admin_site_change', { area: 'layout', action: 'save', fields: hidden.length });
  }

  function onReset() {
    if (!resetArea(version, actor, 'layout')) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setOrder([...HOME_SECTIONS]);
    setHidden([]);
    setStatus('reset');
    track('admin_site_change', { area: 'layout', action: 'reset', fields: 0 });
  }

  return (
    <section aria-labelledby="layout-title" className="space-y-4">
      <div>
        <h2 id="layout-title" className="font-heading text-xl font-extrabold text-ink">
          {t('layout_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('layout_lead')}</p>
      </div>
      <DemoNote />
      <form onSubmit={onSubmit} className={portalCard}>
        <p className="rounded-tile bg-pill px-4 py-3 text-sm font-bold text-ink">
          <Pin aria-hidden="true" className="mr-1.5 inline size-4 -translate-y-px text-accent-soft-text" />
          {t('layout_heroFirst')}
        </p>
        <ol className="mt-3 space-y-2">
          {order.map((key, i) => {
            const name = t(`section_${key}`);
            const isHidden = hidden.includes(key);
            return (
              <li
                key={key}
                className={`flex flex-wrap items-center gap-3 rounded-tile border border-line-card px-4 py-2 ${
                  isHidden ? 'bg-pill' : 'bg-surface'
                }`}
              >
                <span className="w-6 text-sm font-bold text-muted">{i + 1}</span>
                {/* min width lets the controls drop to their own line on phones instead of squeezing the name */}
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
                        setStatus('idle');
                        setHidden((h) => (e.target.checked ? h.filter((x) => x !== key) : [...h, key]));
                      }}
                      className="size-5 accent-[var(--color-accent-button)]"
                    />
                    {t('layout_show')}
                    <span className="sr-only"> {name}</span>
                  </label>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        move(i, -1);
                      }}
                      disabled={i === 0}
                      aria-label={t('layout_up', { name })}
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
                      aria-label={t('layout_down', { name })}
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
        <Actions status={status} onReset={onReset} extra={<PreviewLink />} />
      </form>
    </section>
  );
}

function CategoriesEditor({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const cat = useTranslations('categories');
  const config = useSiteConfig();
  const [version, setVersion] = useState(config.versions.categories);
  const [featured, setFeatured] = useState<CategoryKey[]>(config.featured ?? [...DEFAULT_FEATURED]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (featured.length < FEATURED_MIN || featured.length > FEATURED_MAX) {
      setError(t('categories_errCount', { min: FEATURED_MIN, max: FEATURED_MAX }));
      setStatus('invalid');
      return;
    }
    setError('');
    if (!saveCategories(version, actor, featured)) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setStatus('saved');
    track('admin_site_change', {
      area: 'categories',
      action: 'save',
      fields: featured.length,
    });
  }

  function onReset() {
    if (!resetArea(version, actor, 'categories')) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setFeatured([...DEFAULT_FEATURED]);
    setError('');
    setStatus('reset');
    track('admin_site_change', { area: 'categories', action: 'reset', fields: 0 });
  }

  return (
    <section aria-labelledby="categories-editor-title" className="space-y-4">
      <div>
        <h2 id="categories-editor-title" className="font-heading text-xl font-extrabold text-ink">
          {t('categories_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {t('categories_lead', { min: FEATURED_MIN, max: FEATURED_MAX })}
        </p>
      </div>
      <form onSubmit={onSubmit} className={portalCard} noValidate>
        <p className="text-sm font-bold text-ink" aria-live="polite">
          {t('categories_count', { count: featured.length, max: FEATURED_MAX })}
        </p>
        <ul className="mt-3 grid gap-2 tab:grid-cols-2 nav:grid-cols-3">
          {CATEGORY_KEYS.map((key) => {
            const on = featured.includes(key);
            const name = cat(key);
            const Icon = CATEGORY_ICONS[key];
            return (
              <li
                key={key}
                className={`flex items-center gap-3 rounded-tile border px-3 py-2 ${
                  on ? 'border-accent-button bg-accent-soft' : 'border-line-card bg-surface'
                }`}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0 text-accent-soft-text" strokeWidth={2} />
                <label className="inline-flex min-h-11 flex-1 items-center gap-2 text-sm font-bold text-ink">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      setStatus('idle');
                      setFeatured((f) => (e.target.checked ? [...f, key] : f.filter((x) => x !== key)));
                    }}
                    className="size-5 accent-[var(--color-accent-button)]"
                  />
                  {name}
                  <span className="sr-only">{t('categories_onHome')}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-bold text-error">
            {error}
          </p>
        ) : null}
        <Actions status={status === 'invalid' ? 'idle' : status} onReset={onReset} extra={<PreviewLink />} />
      </form>
    </section>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────

/** `money`: stored in paise, edited in rupees. `percent`: stored in basis points, edited in %. */
const SETTING_FIELDS: {
  key: keyof SiteSettings;
  unit: 'minutes' | 'units' | 'rupees' | 'paise' | 'percent';
  money: boolean;
  percent?: boolean;
}[] = [
  { key: 'acceptMinutes', unit: 'minutes', money: false },
  { key: 'bulkMinUnits', unit: 'units', money: false },
  { key: 'deliveryFeePaise', unit: 'rupees', money: true },
  { key: 'freeDeliveryFromPaise', unit: 'rupees', money: true },
  { key: 'coinValuePaise', unit: 'paise', money: false },
  { key: 'coinMaxRedeemBp', unit: 'percent', money: false, percent: true },
];
const scaled = (f: { money: boolean; percent?: boolean }) => f.money || f.percent === true;

export function SettingsEditor({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);
  const config = useSiteConfig();
  const [version, setVersion] = useState(config.versions.settings);
  const toDraft = (s: SiteSettings) =>
    Object.fromEntries(
      SETTING_FIELDS.map((f) => [f.key, String(scaled(f) ? s[f.key] / 100 : s[f.key])]),
    ) as Record<keyof SiteSettings, string>;
  const [draft, setDraft] = useState(() => toDraft(config.settings));
  const [errors, setErrors] = useState<Partial<Record<keyof SiteSettings, string>>>({});
  const [status, setStatus] = useState<Status>('idle');

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Partial<Record<keyof SiteSettings, string>> = {};
    const values = { ...DEFAULT_SETTINGS };
    for (const f of SETTING_FIELDS) {
      const { key } = f;
      const [min, max] = SETTING_LIMITS[key].map((v) => (scaled(f) ? v / 100 : v)) as [number, number];
      const raw = draft[key].trim();
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n < min || n > max) {
        next[key] = t('settings_err', { min: num(min), max: num(max) });
        continue;
      }
      values[key] = scaled(f) ? n * 100 : n;
    }
    setErrors(next);
    const first = SETTING_FIELDS.find(({ key }) => next[key]);
    if (first) {
      setStatus('invalid');
      document.getElementById(`setting-${first.key}`)?.focus();
      return;
    }
    if (!saveSettings(version, actor, values)) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setStatus('saved');
    track('admin_site_change', { area: 'settings', action: 'save', fields: SETTING_FIELDS.length });
  }

  function onReset() {
    if (!resetArea(version, actor, 'settings')) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setDraft(toDraft(DEFAULT_SETTINGS));
    setErrors({});
    setStatus('reset');
    track('admin_site_change', { area: 'settings', action: 'reset', fields: 0 });
  }

  return (
    <section aria-labelledby="settings-title" className="space-y-4">
      <div>
        <h2 id="settings-title" className="font-heading text-xl font-extrabold text-ink">
          {t('settings_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('settings_lead')}</p>
      </div>
      <DemoNote />
      <form onSubmit={onSubmit} className={portalCard} noValidate>
        <div className="grid gap-5 tab:grid-cols-2">
          {SETTING_FIELDS.map((f) => {
            const { key, unit, money } = f;
            const [min, max] = SETTING_LIMITS[key].map((v) => (scaled(f) ? v / 100 : v)) as [number, number];
            const id = `setting-${key}`;
            return (
              <div key={key}>
                <label htmlFor={id} className="text-sm font-bold text-ink">
                  {t(`setting_${key}`)}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  {money ? (
                    <span aria-hidden="true" className="text-sm font-bold text-muted">
                      ₹
                    </span>
                  ) : null}
                  <input
                    id={id}
                    inputMode="numeric"
                    value={draft[key]}
                    aria-invalid={errors[key] ? true : undefined}
                    aria-describedby={`${id}-hint${errors[key] ? ` ${id}-error` : ''}`}
                    onChange={(e) => {
                      setStatus('idle');
                      setDraft((d) => ({ ...d, [key]: e.target.value.replace(/\D/g, '') }));
                    }}
                    className="min-h-11 w-28 rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
                  />
                  {money ? null : <span className="text-sm text-muted">{t(`unit_${unit}`)}</span>}
                </div>
                <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
                  {t(`setting_${key}_hint`, { min: num(min), max: num(max) })}
                </p>
                {errors[key] ? (
                  <p id={`${id}-error`} className="mt-1 text-xs font-bold text-error">
                    {errors[key]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <Actions status={status} onReset={onReset} />
      </form>
      <RecentChanges />
    </section>
  );
}

// ── Audit trail ───────────────────────────────────────────────────────────────────────────────────────────────

function RecentChanges() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const audit = useSiteConfig().audit.slice(0, 8);
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));
  const area = (a: AuditEntry['area']) => t(`area_${a}`);
  return (
    <section aria-labelledby="audit-title" className={portalCard}>
      <h2 id="audit-title" className="font-heading text-lg font-extrabold text-ink">
        {t('audit_title')}
      </h2>
      {audit.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('audit_empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {audit.map((a) => (
            <li
              key={`${a.at}-${a.area}`}
              className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm"
            >
              <span className="text-ink">
                <span className="font-bold">{area(a.area)}</span> · {t(`audit_${a.action}`)} ·{' '}
                <span data-user-content>{a.actor}</span>
              </span>
              <time dateTime={a.at} className="text-muted">
                {time(a.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
