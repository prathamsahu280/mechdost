'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import {
  USAGE_METRICS,
  USAGE_PROVIDERS,
  UsageCheckResult,
  UsageSaved,
  UsageView,
  formatUsageValue,
  type UsageMetricViewDto,
  type UsageProvider,
  type UsageViewDto,
} from '@mechdost/shared/usage';
import { adminApi } from '@/lib/admin-api';
import { formatDate } from '@/lib/format';
import type { BadgeTone } from '@/lib/admin-status-tone';
import { ApiError } from './api-list-state';
import { AdminHeaderActions } from './admin-page-header';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { EmptyState, StatusBadge, adminCard } from './admin-ui';

type State = { kind: 'loading' } | { kind: 'failed'; code: string } | { kind: 'ready'; data: UsageViewDto };
type Notice = { kind: 'ok' | 'error'; text: string } | null;

const LEVEL_TONE: Record<UsageMetricViewDto['level'], BadgeTone> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
};
const LEVEL_FILL: Record<UsageMetricViewDto['level'], string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  critical: 'bg-error',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  ok: 'success',
  partial: 'warning',
  failed: 'danger',
  not_configured: 'muted',
};
/** Keeps a focused button focusable while busy (a disabled button drops focus; a11y review 2026-11-26). */
const busyClass = 'aria-disabled:cursor-wait aria-disabled:opacity-60';

const time = (iso: string, locale: string) =>
  `${formatDate(iso, locale)} ${new Date(iso).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })}`;

/**
 * Admin → Usage & limits (founder 2026-11-26; spec 08): storage and free-plan limits of R2, Supabase, the server and
 * email, from `GET /v1/admin/usage`. One primary action (Check now, in the page header). Each metric is a bullet
 * bar (value against its limit, with the warning and critical marks stated in text) and a 30-day sparkline with a
 * table of the daily values; numbers are always in text beside the picture. Super admins edit limits, thresholds and
 * recipients inline; operations managers read.
 */
export function AdminUsageApi() {
  const t = useTranslations('adminUsage');
  const tp = useTranslations('portal');
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/usage', UsageView);
    setState(res.ok ? { kind: 'ready', data: res.data } : { kind: 'failed', code: res.code });
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkNow = async () => {
    if (checking || state.kind === 'loading') return;
    setChecking(true);
    setNotice({ kind: 'ok', text: t('checking') });
    const res = await adminApi(locale, '/admin/usage/check', UsageCheckResult, { method: 'POST' });
    setChecking(false);
    if (res.ok) {
      setState({ kind: 'ready', data: res.data.usage });
      setNotice({ kind: 'ok', text: t('check_done', { count: res.data.stored }) });
    } else setNotice({ kind: 'error', text: res.status === 429 ? t('check_rate') : t('check_failed') });
  };

  const saved = useCallback(() => {
    setNotice({ kind: 'ok', text: t('saved') });
    void load();
  }, [load, t]);

  const data = state.kind === 'ready' ? state.data : null;

  return (
    <div className="space-y-4" aria-busy={state.kind === 'loading'}>
      {state.kind !== 'failed' ? (
        <AdminHeaderActions>
          <button
            type="button"
            data-track="admin_usage_check_now"
            aria-disabled={checking || state.kind === 'loading'}
            onClick={() => {
              void checkNow();
            }}
            className={`${portalPrimary} ${busyClass}`}
          >
            {t('check_now')}
          </button>
        </AdminHeaderActions>
      ) : null}

      {/* One polite region for progress and results; failures go to an alert (a11y review 2026-11-26). */}
      <p role="status" className="min-h-5 text-sm font-bold text-ink">
        {state.kind === 'loading' ? t('loading') : notice?.kind === 'ok' ? notice.text : ''}
      </p>
      {notice?.kind === 'error' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {notice.text}
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <div className={`${adminCard} flex flex-wrap items-center gap-3`}>
          <ApiError code={state.code} />
          <button
            type="button"
            aria-disabled={retrying}
            onClick={() => {
              if (retrying) return;
              setRetrying(true);
              void load().finally(() => {
                setRetrying(false);
              });
            }}
            className={`${portalQuiet} ${busyClass}`}
          >
            {tp('api_retry')}
          </button>
        </div>
      ) : null}

      {data && !data.lastCheckedAt ? <EmptyState title={t('empty_title')} hint={t('empty_body')} /> : null}

      {data?.lastCheckedAt ? (
        <>
          <p className="text-sm text-muted">
            {t('last_checked', { time: time(data.lastCheckedAt, locale) })} ·{' '}
            {t('thresholds_note', { warn: data.config.warnPct, critical: data.config.criticalPct })}
          </p>
          <div className="grid gap-4 desk:grid-cols-2">
            {USAGE_PROVIDERS.map((provider) => (
              <ProviderCard key={provider} provider={provider} data={data} onSaved={saved} />
            ))}
          </div>
        </>
      ) : null}

      {data ? (
        <AlertSettings
          data={data}
          onSaved={() => {
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function ProviderCard({
  provider,
  data,
  onSaved,
}: {
  provider: UsageProvider;
  data: UsageViewDto;
  onSaved: () => void;
}) {
  const t = useTranslations('adminUsage');
  const id = useId();
  const status = data.providers.find((p) => p.provider === provider)?.status ?? null;
  const metrics = data.metrics.filter((m) => m.provider === provider);
  const estimated = metrics.some((m) => m.source === 'estimated');
  return (
    <div className={`${adminCard} min-w-0`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-h`} className="font-heading text-base font-extrabold text-ink">
          {t(`provider_${provider}`)}
        </h3>
        <StatusBadge tone={status ? (STATUS_TONE[status] ?? 'neutral') : 'muted'}>
          {t(`status_${status ?? 'unknown'}`)}
        </StatusBadge>
      </div>
      {status === 'not_configured' ? (
        <p className="mt-1 text-sm text-muted">{t('status_not_configured_hint')}</p>
      ) : null}
      {status === 'failed' ? <p className="mt-1 text-sm text-muted">{t('status_failed_hint')}</p> : null}
      <ul className="mt-3 divide-y divide-line-card" aria-labelledby={`${id}-h`}>
        {metrics.map((m) => (
          <MetricRow
            key={m.code}
            metric={m}
            canEdit={data.canEdit}
            warnPct={data.config.warnPct}
            criticalPct={data.config.criticalPct}
            onSaved={onSaved}
          />
        ))}
      </ul>
      {estimated ? <p className="mt-2 text-xs text-muted">{t('estimated_hint')}</p> : null}
    </div>
  );
}

function MetricRow({
  metric: m,
  canEdit,
  warnPct,
  criticalPct,
  onSaved,
}: {
  metric: UsageMetricViewDto;
  canEdit: boolean;
  warnPct: number;
  criticalPct: number;
  onSaved: () => void;
}) {
  const t = useTranslations('adminUsage');
  const id = useId();
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const name = t(`metric_${m.code}`);
  const value = m.value === null ? null : formatUsageValue(m.value, m.unit);
  const limit = m.limit === null ? null : formatUsageValue(m.limit, m.unit);
  const fill = Math.min(100, Math.max(0, m.percent ?? 0));
  const levelText = t(`level_${m.level}`);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <span id={`${id}-name`} className="text-sm font-bold text-ink">
            {name}
          </span>
          {m.source === 'estimated' ? <StatusBadge tone="info">{t('estimated')}</StatusBadge> : null}
          {!m.alerts && m.limit !== null ? <StatusBadge tone="muted">{t('alerts_off')}</StatusBadge> : null}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink tabular-nums">
          {value === null ? (
            <span className="text-muted">{t('not_measured')}</span>
          ) : limit === null ? (
            <span>
              {value} · <span className="text-muted">{t('no_limit')}</span>
            </span>
          ) : (
            <span>{t('of_limit', { value, limit })}</span>
          )}
          {m.percent !== null && value !== null ? (
            <StatusBadge tone={LEVEL_TONE[m.level]}>
              {levelText} · {t('percent_used', { percent: m.percent })}
            </StatusBadge>
          ) : null}
        </p>
      </div>

      {m.percent !== null && value !== null && limit !== null ? (
        // Bullet bar: the ticks reach past the track so they stay visible over any fill (contrast review).
        <div className="relative mt-2 py-1">
          <div
            role="meter"
            aria-labelledby={`${id}-name`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fill}
            aria-valuetext={t('meter_text', { value, limit, percent: m.percent, level: levelText })}
            className="h-2.5 w-full overflow-hidden rounded-pill border border-input-border bg-pill"
          >
            <div
              className={`h-full rounded-pill ${LEVEL_FILL[m.level]}`}
              style={{ width: `${String(fill)}%` }}
            />
          </div>
          {[warnPct, criticalPct].map((p) => (
            <span
              key={p}
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-0.5 rounded-pill bg-ink ring-1 ring-surface"
              style={{ left: `calc(${String(p)}% - 1px)` }}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <Sparkline metric={m} name={name} />
        {canEdit ? (
          <button
            ref={editRef}
            type="button"
            data-track="admin_usage_limit_edit"
            aria-expanded={editing}
            aria-controls={editing ? `${id}-form` : undefined}
            onClick={() => {
              setEditing((v) => !v);
            }}
            className={`${portalQuiet} scroll-my-24`}
          >
            {t('edit')}
            <span className="sr-only"> {name}</span>
          </button>
        ) : null}
      </div>

      {editing ? (
        <LimitForm
          id={`${id}-form`}
          metric={m}
          name={name}
          onClose={(done) => {
            setEditing(false);
            editRef.current?.focus();
            if (done) onSaved();
          }}
        />
      ) : null}
    </li>
  );
}

/** Last value of each of the last 30 days; one series, so the metric name is its title (no legend). */
function Sparkline({ metric: m, name }: { metric: UsageMetricViewDto; name: string }) {
  const t = useTranslations('adminUsage');
  const locale = useLocale();
  const points = m.trend;
  const first = points[0];
  const last = points.at(-1);
  if (points.length < 2 || !first || !last) return <p className="text-xs text-muted">{t('trend_short')}</p>;
  const W = 120;
  const H = 28;
  const values = points.map((p) => p.value);
  const top = Math.max(...values, 1);
  const x = (i: number) => Math.round(((i / (points.length - 1)) * (W - 4) + 2) * 10) / 10;
  const y = (v: number) => Math.round((H - 3 - (v / top) * (H - 6)) * 10) / 10;
  const fmt = (v: number) => formatUsageValue(v, m.unit);
  const label = t('trend_label', {
    metric: name,
    from: formatDate(first.day, locale),
    to: formatDate(last.day, locale),
    first: fmt(first.value),
    last: fmt(last.value),
    min: fmt(Math.min(...values)),
    max: fmt(Math.max(...values)),
  });
  return (
    <div className="min-w-0">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        width={W}
        height={H}
        className="shrink-0 text-info"
      >
        <polyline
          points={points.map((p, i) => `${String(x(i))},${String(y(p.value))}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3" fill="currentColor" />
      </svg>
      <details className="mt-1 text-xs text-muted">
        <summary className="inline-flex min-h-6 cursor-pointer items-center rounded-button font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {t('daily_values')}
          <span className="sr-only"> {name}</span>
        </summary>
        <table className="mt-1 text-left tabular-nums">
          <caption className="sr-only">{name}</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-4 font-bold">
                {t('day_col')}
              </th>
              <th scope="col" className="font-bold">
                {t('value_col')}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td className="pr-4">{formatDate(p.day, locale)}</td>
                <td>{fmt(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function LimitForm({
  id,
  metric: m,
  name,
  onClose,
}: {
  id: string;
  metric: UsageMetricViewDto;
  name: string;
  onClose: (saved: boolean) => void;
}) {
  const t = useTranslations('adminUsage');
  const locale = useLocale();
  const bytes = m.unit === 'bytes';
  const toField = (v: number | null) => (v === null ? '' : String(bytes ? v / 1e9 : v));
  const [limit, setLimit] = useState(toField(m.limitOverride));
  const [alerts, setAlerts] = useState(m.alerts);
  const [fieldError, setFieldError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const def = USAGE_METRICS[m.code];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (saving) return;
    const raw = limit.trim();
    const parsed = raw === '' ? null : Number(raw.replace(',', '.'));
    const value = parsed === null ? null : Math.round(bytes ? parsed * 1e9 : parsed);
    if (parsed !== null && (!Number.isFinite(parsed) || value === null || value <= 0)) {
      setFieldError(t('err_limit'));
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setFormError('');
    const res = await adminApi(locale, `/admin/usage/limits/${m.code}`, UsageSaved, {
      method: 'PUT',
      body: { limit: value, alerts, expectedVersion: m.limitVersion },
    });
    setSaving(false);
    if (res.ok) onClose(true);
    else setFormError(res.status === 409 ? t('err_stale') : t('err_save'));
  };

  const hint = def.limitFromMeasurement
    ? t('limit_hint_measured')
    : t('limit_hint_default', {
        value: def.defaultLimit === null ? t('no_limit') : formatUsageValue(def.defaultLimit, def.unit),
      });

  return (
    <form
      id={id}
      noValidate
      onSubmit={(e) => {
        void submit(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.stopPropagation();
          onClose(false);
        }
      }}
      className="mt-3 space-y-3 rounded-card border border-line-card bg-bg p-3"
    >
      <div>
        <label htmlFor={`${id}-limit`} className="block text-sm font-bold text-ink">
          {t('limit_label')}
          {bytes ? ` (${t('limit_unit_gb')})` : null}
          <span className="sr-only"> {name}</span>
        </label>
        <input
          ref={inputRef}
          id={`${id}-limit`}
          name="limit"
          inputMode="decimal"
          autoComplete="off"
          value={limit}
          aria-describedby={`${id}-hint${fieldError ? ` ${id}-err` : ''}`}
          aria-invalid={fieldError ? true : undefined}
          onChange={(e) => {
            setLimit(e.target.value);
            setFieldError('');
          }}
          className={`${portalField} max-w-48 scroll-my-24`}
        />
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
        {fieldError ? (
          <p id={`${id}-err`} role="alert" className="mt-1 text-sm font-bold text-error">
            {fieldError}
          </p>
        ) : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="alerts"
          checked={alerts}
          onChange={(e) => {
            setAlerts(e.target.checked);
          }}
          className="size-5 accent-[var(--color-accent-button)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        {t('alerts_label')}
      </label>
      {formError ? (
        <p role="alert" className="text-sm font-bold text-error">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          data-track="admin_usage_limit_save"
          aria-disabled={saving}
          className={`${portalPrimary} ${busyClass}`}
        >
          {saving ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          onClick={() => {
            onClose(false);
          }}
          className={portalQuiet}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type ConfigError = { field: 'warn' | 'critical' | 'emails' | 'form'; text: string } | null;

function AlertSettings({ data, onSaved }: { data: UsageViewDto; onSaved: () => void }) {
  const t = useTranslations('adminUsage');
  const locale = useLocale();
  const id = useId();
  const c = data.config;
  const [warn, setWarn] = useState(String(c.warnPct));
  const [critical, setCritical] = useState(String(c.criticalPct));
  const [recipients, setRecipients] = useState(c.recipients.join('\n'));
  const [lang, setLang] = useState<'en' | 'hi'>(c.emailLocale);
  const [error, setError] = useState<ConfigError>(null);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const warnRef = useRef<HTMLInputElement>(null);
  const critRef = useRef<HTMLInputElement>(null);
  const mailRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(c);
  latest.current = c;

  // Reset the fields only when the stored settings change (a new version), never on an unrelated reload.
  useEffect(() => {
    const now = latest.current;
    setWarn(String(now.warnPct));
    setCritical(String(now.criticalPct));
    setRecipients(now.recipients.join('\n'));
    setLang(now.emailLocale);
  }, [c.version]);

  const edited = () => {
    setError(null);
    setSaved('');
  };

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaved('');
    const pct = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s) : NaN);
    const w = pct(warn);
    const cr = pct(critical);
    if (!(w >= 1 && w <= 100)) {
      setError({ field: 'warn', text: t('err_pct_range') });
      warnRef.current?.focus();
      return;
    }
    if (!(cr >= 1 && cr <= 100)) {
      setError({ field: 'critical', text: t('err_pct_range') });
      critRef.current?.focus();
      return;
    }
    if (w >= cr) {
      setError({ field: 'warn', text: t('err_order') });
      warnRef.current?.focus();
      return;
    }
    const list = recipients
      .split(/[\n,]+/)
      .map((r) => r.trim())
      .filter((r) => r !== '');
    const bad = list.find((r) => !EMAIL.test(r));
    if (list.length > 10 || bad) {
      setError({
        field: 'emails',
        text: bad ? t('err_email_bad', { address: bad }) : t('err_emails_count'),
      });
      mailRef.current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    const res = await adminApi(locale, '/admin/usage/alerts', UsageSaved, {
      method: 'PUT',
      body: { warnPct: w, criticalPct: cr, recipients: list, emailLocale: lang, expectedVersion: c.version },
    });
    setSaving(false);
    if (res.ok) {
      setSaved(t('saved'));
      onSaved();
    } else setError({ field: 'form', text: res.status === 409 ? t('err_stale') : t('err_save') });
  };

  if (!data.canEdit)
    return (
      <section aria-labelledby={`${id}-h`} className={adminCard}>
        <h3 id={`${id}-h`} className="font-heading text-base font-extrabold text-ink">
          {t('config_title')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('config_intro')}</p>
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm tab:grid-cols-[auto_1fr]">
          <dt className="font-bold text-ink">{t('warn_label')}</dt>
          <dd className="tabular-nums">{c.warnPct}</dd>
          <dt className="font-bold text-ink">{t('critical_label')}</dt>
          <dd className="tabular-nums">{c.criticalPct}</dd>
          <dt className="font-bold text-ink">{t('recipients_label')}</dt>
          <dd className="[overflow-wrap:anywhere]" data-user-content>
            {c.recipients.length > 0 ? c.recipients.join(', ') : t('default_recipients')}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-muted">{t('read_only')}</p>
      </section>
    );

  const errId = (f: 'warn' | 'critical' | 'emails') => (error?.field === f ? `${id}-${f}-err` : undefined);
  const pctError = error?.field === 'warn' || error?.field === 'critical' ? error : null;
  return (
    <form
      aria-labelledby={`${id}-h`}
      noValidate
      onSubmit={(e) => {
        void submit(e);
      }}
      className={`${adminCard} space-y-4`}
    >
      <div>
        <h3 id={`${id}-h`} className="font-heading text-base font-extrabold text-ink">
          {t('config_title')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('config_intro')}</p>
      </div>
      <fieldset aria-describedby={`${id}-pct-hint`}>
        <legend className="text-sm font-bold text-ink">{t('thresholds_legend')}</legend>
        <p id={`${id}-pct-hint`} className="mt-1 text-xs text-muted">
          {t('pct_hint')}
        </p>
        <div className="mt-2 grid gap-3 tab:grid-cols-2">
          {(
            [
              ['warn', warn, setWarn, warnRef, t('warn_label')],
              ['critical', critical, setCritical, critRef, t('critical_label')],
            ] as const
          ).map(([field, val, set, ref, label]) => (
            <div key={field}>
              <label htmlFor={`${id}-${field}`} className="block text-sm font-bold text-ink">
                {label}
              </label>
              <input
                ref={ref}
                id={`${id}-${field}`}
                name={field === 'warn' ? 'warnPct' : 'criticalPct'}
                inputMode="numeric"
                autoComplete="off"
                aria-required="true"
                value={val}
                aria-invalid={error?.field === field ? true : undefined}
                aria-describedby={errId(field)}
                onChange={(e) => {
                  set(e.target.value);
                  edited();
                }}
                className={`${portalField} max-w-32`}
              />
            </div>
          ))}
        </div>
        {pctError ? (
          <p id={`${id}-${pctError.field}-err`} role="alert" className="mt-2 text-sm font-bold text-error">
            {pctError.text}
          </p>
        ) : null}
      </fieldset>
      <div>
        <label htmlFor={`${id}-mail`} className="block text-sm font-bold text-ink">
          {t('recipients_label')}
        </label>
        <textarea
          ref={mailRef}
          id={`${id}-mail`}
          name="recipients"
          rows={3}
          value={recipients}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errId('emails') ? true : undefined}
          aria-describedby={`${id}-mail-hint${errId('emails') ? ` ${id}-emails-err` : ''}`}
          onChange={(e) => {
            setRecipients(e.target.value);
            edited();
          }}
          className={`${portalField} py-2`}
        />
        <p id={`${id}-mail-hint`} className="mt-1 text-xs text-muted">
          {t('recipients_hint')}
        </p>
        {error?.field === 'emails' ? (
          <p id={`${id}-emails-err`} role="alert" className="mt-1 text-sm font-bold text-error">
            {error.text}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor={`${id}-lang`} className="block text-sm font-bold text-ink">
          {t('email_lang_label')}
        </label>
        <select
          id={`${id}-lang`}
          name="emailLocale"
          value={lang}
          onChange={(e) => {
            setLang(e.target.value === 'hi' ? 'hi' : 'en');
            edited();
          }}
          className={`${portalField} max-w-48`}
        >
          <option value="en">{t('lang_en')}</option>
          <option value="hi">{t('lang_hi')}</option>
        </select>
      </div>
      {error?.field === 'form' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          data-track="admin_usage_alerts_save"
          aria-disabled={saving}
          className={`${portalQuiet} ${busyClass}`}
        >
          {saving ? t('saving') : t('save')}
        </button>
        <p role="status" className="text-sm font-bold text-success">
          {saved}
        </p>
      </div>
    </form>
  );
}
