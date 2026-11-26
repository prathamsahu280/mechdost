'use client';

import { isTrustKey, trustPlacementOf, TRUST_HIDDEN, type TrustKey } from '@mechdost/shared/content';
import { ArrowDown, ArrowUp } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { CATEGORY_KEYS, type CategoryKey } from '@/demo/catalogue';
import {
  contentMax,
  isEmoji,
  resetArea,
  saveCategories,
  saveContent,
  saveLayout,
  useSiteConfig,
  type AuditEntry,
  type ContentKey,
  type SiteConfig,
  saveMapDefault,
} from '@/demo/site-config';
import type { MapMode } from '@/lib/map-styles';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { CATEGORY_EMOJI } from '@/lib/emoji';
import {
  DEFAULT_FEATURED,
  FEATURED_MAX,
  FEATURED_MIN,
  HOME_SECTIONS,
  type HomeSection,
} from '@/lib/site-layout';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

/** The API editors (real sign-in builds only): loaded on demand so demo bundles stay the same size. */
const ContentApi = dynamic(() => import('./admin-site-api').then((m) => m.ContentApi), { ssr: false });

/** Default text per content key in both locales, resolved on the server from the locale files. */
export type ContentDefaults = Record<ContentKey, { en: string; hi: string }>;

type Status = 'idle' | 'saved' | 'reset' | 'stale' | 'invalid';

const fieldId = (key: string) => key.replace('.', '_');

/** Label message per content key (explicit literals keep next-intl's key checking). */
const FIELD_LABEL = {
  'announcement.orders': 'field_announcement_orders',
  'announcement.workshops': 'field_announcement_workshops',
  'hero.eyebrow': 'field_hero_eyebrow',
  'hero.titleLine1': 'field_hero_titleLine1',
  'hero.titleLine2': 'field_hero_titleLine2',
  'hero.lead': 'field_hero_lead',
  'savings.order': 'field_savings_order',
  'savings.account': 'field_savings_account',
  'savings.cart': 'field_savings_cart',
} as const satisfies Record<Exclude<ContentKey, TrustKey>, string>;

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

const CONTENT_GROUPS: { id: 'announcement' | 'hero' | 'trust' | 'savings'; keys: ContentKey[] }[] = [
  { id: 'announcement', keys: ['announcement.orders', 'announcement.workshops'] },
  { id: 'hero', keys: ['hero.eyebrow', 'hero.titleLine1', 'hero.titleLine2', 'hero.lead'] },
  {
    id: 'trust',
    keys: [
      'trust.homeGenuine',
      'trust.homeBill',
      'trust.homeEstimates',
      'trust.product',
      'trust.checkout',
      'trust.emailFooter',
      'trust.workshop',
      'trust.partner',
    ],
  },
  // "Your savings" wording (decision 2026-11-26); the on/off switch is in Settings → Store.
  { id: 'savings', keys: ['savings.order', 'savings.account', 'savings.cart'] },
];

export function ContentEditor({ actor, defaults }: { actor: string; defaults: ContentDefaults }) {
  return AUTH_MODE === 'firebase' ? (
    <ContentApi defaults={defaults} />
  ) : (
    <DemoContentEditor actor={actor} defaults={defaults} />
  );
}

function DemoContentEditor({ actor, defaults }: { actor: string; defaults: ContentDefaults }) {
  const t = useTranslations('portal');
  const tt = useTranslations('trust');
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
    <section aria-labelledby="admin-page-title" className="space-y-4">
      <DemoNote />
      <form onSubmit={onSubmit} className={adminCard} noValidate>
        {CONTENT_GROUPS.map((group) => (
          <fieldset key={group.id} className="mt-2 first:mt-0">
            <legend className="font-heading text-lg font-extrabold text-ink">
              {group.id === 'trust' ? tt('group') : t(`content_group_${group.id}`)}
            </legend>
            {group.id === 'trust' ? <p className="mt-1 text-xs text-muted">{tt('hideHint')}</p> : null}
            <div className="mt-3 space-y-5">
              {group.keys.map((key) => {
                const id = fieldId(key);
                const max = contentMax(key);
                const long = max > 120;
                return (
                  <div key={key} className="rounded-tile border border-line-card p-4">
                    <p className="text-sm font-bold text-ink">
                      {isTrustKey(key)
                        ? tt(`lineLabel_${trustPlacementOf(key) ?? 'product'}`, { brand: '{brand}' })
                        : t(FIELD_LABEL[key])}
                    </p>
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
                              {value.trim() === TRUST_HIDDEN && isTrustKey(key)
                                ? tt('hidden')
                                : value
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
    <form onSubmit={onSubmit} className={adminCard}>
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
    <section aria-labelledby="admin-page-title" className="space-y-4">
      <DemoNote />
      <form onSubmit={onSubmit} className={adminCard}>
        <p className="rounded-tile bg-pill px-4 py-3 text-sm font-bold text-ink">
          <span aria-hidden="true">📌 </span>
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
  const [emoji, setEmoji] = useState<Partial<Record<CategoryKey, string>>>(config.emoji);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (featured.length < FEATURED_MIN || featured.length > FEATURED_MAX) {
      setError(t('categories_errCount', { min: FEATURED_MIN, max: FEATURED_MAX }));
      setStatus('invalid');
      return;
    }
    const bad = CATEGORY_KEYS.find((k) => {
      const v = emoji[k]?.trim();
      return v ? !isEmoji(v) : false;
    });
    if (bad) {
      setError(t('categories_errEmoji', { name: cat(bad) }));
      setStatus('invalid');
      document.getElementById(`emoji-${bad}`)?.focus();
      return;
    }
    setError('');
    if (!saveCategories(version, actor, featured, emoji)) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setStatus('saved');
    track('admin_site_change', {
      area: 'categories',
      action: 'save',
      fields: Object.values(emoji).filter(Boolean).length,
    });
  }

  function onReset() {
    if (!resetArea(version, actor, 'categories')) {
      setStatus('stale');
      return;
    }
    setVersion(version + 1);
    setFeatured([...DEFAULT_FEATURED]);
    setEmoji({});
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
      <form onSubmit={onSubmit} className={adminCard} noValidate>
        <p className="text-sm font-bold text-ink" aria-live="polite">
          {t('categories_count', { count: featured.length, max: FEATURED_MAX })}
        </p>
        <ul className="mt-3 grid gap-2 tab:grid-cols-2 nav:grid-cols-3">
          {CATEGORY_KEYS.map((key) => {
            const on = featured.includes(key);
            const name = cat(key);
            return (
              <li
                key={key}
                className={`flex items-center gap-3 rounded-tile border px-3 py-2 ${
                  on ? 'border-accent-button bg-accent-soft' : 'border-line-card bg-surface'
                }`}
              >
                <label htmlFor={`emoji-${key}`} className="sr-only">
                  {t('categories_emoji', { name })}
                </label>
                <input
                  id={`emoji-${key}`}
                  value={emoji[key] ?? ''}
                  placeholder={CATEGORY_EMOJI[key]}
                  maxLength={16}
                  onChange={(e) => {
                    setStatus('idle');
                    setEmoji((m) => ({ ...m, [key]: e.target.value }));
                  }}
                  className="min-h-11 w-14 shrink-0 rounded-input border border-input-border bg-surface text-center text-[22px] text-ink placeholder:opacity-60"
                />
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

// ── Audit trail ───────────────────────────────────────────────────────────────────────────────────────────────

export function RecentChanges() {
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
    <section aria-labelledby="audit-title" className={adminCard}>
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
