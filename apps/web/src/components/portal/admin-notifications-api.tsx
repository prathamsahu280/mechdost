'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import {
  NotificationTemplateList,
  SavedVersion,
  WhatsAppUsage,
  type NotificationTemplateDto,
  type WhatsAppUsageDto,
} from '@mechdost/shared/admin-config-api';
import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';
import {
  BUDGET_LIMITS,
  DEFAULT_BUDGET_PAISE,
  WHATSAPP_EVENTS,
  bodyProblem,
  preview,
} from '@/demo/notification-settings';
import { adminApi } from '@/lib/admin-api';
import {
  budgetPaiseFrom,
  eventView,
  metaStatusLabel,
  templateErrorProblem,
  templateSaves,
  type EventView,
  type NotifyLocale,
} from '@/lib/admin-notify-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import type { NotifyDefaults } from './admin-notifications';
import { EVENT_LABEL, PROBLEM_LABEL, SAMPLES } from './notify-labels';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

/** The Emails tab (spec 10, design 2026-11-15) is loaded on demand: its template catalogue and preview code stay out of the WhatsApp tab. */
const NoticesPanel = dynamic(() => import('./admin-notices-api').then((m) => m.NoticesPanel), { ssr: false });
const EmailsPanel = dynamic(() => import('./admin-emails-api').then((m) => m.EmailsPanel), { ssr: false });

interface Loaded {
  templates: NotificationTemplateDto[];
  /** Meta approval per catalogue key and language, from the template CLI's last sync. */
  metaStatus: Record<string, { en: string; hi: string } | undefined>;
  usage: WhatsAppUsageDto;
}

/**
 * Admin → Notifications on the API (spec 10; real sign-in builds, loaded by `admin-notifications.tsx`). Same cards
 * as the demo: per WhatsApp event an on/off switch and the English and Hindi text (checked like the API before
 * sending), saved per language with compare-and-set; the monthly budget alert with this month's real usage.
 */
export function NotificationsApi({ defaults }: { defaults: NotifyDefaults }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  const [tab, setTab] = useState<'whatsapp' | 'emails' | 'notices'>('whatsapp');
  const tabs = useTranslations('adminEmails');
  const notices = useTranslations('adminNotices');

  const load = useCallback(async () => {
    const [templates, usage] = await Promise.all([
      adminApi(locale, '/admin/notifications/templates', NotificationTemplateList),
      adminApi(locale, '/admin/notifications/whatsapp', WhatsAppUsage),
    ]);
    if (!templates.ok) {
      setError(commonErrorKey(templates.code));
      return;
    }
    if (!usage.ok) {
      setError(commonErrorKey(usage.code));
      return;
    }
    setError(null);
    setData({
      templates: templates.data.templates,
      metaStatus: Object.fromEntries(
        templates.data.whatsappCatalogue.map((entry) => [entry.key, entry.status]),
      ),
      usage: usage.data,
    });
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const views = data
    ? WHATSAPP_EVENTS.map((event) => [event, eventView(data.templates, event, defaults[event])] as const)
    : [];
  const onCount = views.filter(([, v]) => v.enabled).length;

  return (
    <section aria-labelledby="notify-title" className="space-y-5">
      <div>
        <h2 id="notify-title" className="font-heading text-xl font-extrabold text-ink">
          {t('notify_title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('notify_intro')}</p>
      </div>
      <div role="tablist" aria-label={tabs('tabs_label')} className="flex gap-2">
        {(['whatsapp', 'emails', 'notices'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`${portalQuiet} ${tab === id ? 'bg-pill' : ''}`}
            onClick={() => {
              setTab(id);
            }}
          >
            {id === 'notices'
              ? notices('tab_notices')
              : tabs(id === 'whatsapp' ? 'tab_whatsapp' : 'tab_emails')}
          </button>
        ))}
      </div>
      {tab === 'emails' ? <EmailsPanel /> : null}
      {tab === 'notices' ? <NoticesPanel /> : null}
      {tab !== 'whatsapp' ? null : error ? (
        <div role="alert" className={`${portalCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{t(error)}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            {t('api_common_retry')}
          </button>
        </div>
      ) : null}
      {tab !== 'whatsapp' ? null : !data && !error ? (
        <p role="status" className={`${portalCard} text-sm text-muted`}>
          {t('api_common_loading')}
        </p>
      ) : null}
      {tab !== 'whatsapp' ? null : data ? (
        <>
          <div
            role="status"
            className="rounded-card border border-line-card bg-private-bg p-4 text-sm text-private"
          >
            <p className="font-bold">
              {onCount === 0
                ? t('api_notify_all_off')
                : t('api_notify_some_on', { count: onCount, total: WHATSAPP_EVENTS.length })}
            </p>
            <p className="mt-1">{t('api_notify_meta_note')}</p>
          </div>
          <ul className="grid gap-4">
            {views.map(([event, view]) => (
              <li key={event}>
                <EventCard event={event} view={view} meta={data.metaStatus[event]} onReload={load} />
              </li>
            ))}
          </ul>
          <BudgetCard usage={data.usage} onReload={load} />
        </>
      ) : null}
    </section>
  );
}

function EventCard({
  event,
  view,
  meta,
  onReload,
}: {
  event: WhatsAppTemplateKey;
  view: EventView;
  meta: { en: string; hi: string } | undefined;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const id = useId();
  const template = WHATSAPP_TEMPLATES[event];
  const placeholders = template.params.map((_, i) => `{{${String(i + 1)}}}`).join(', ');
  const samples = template.params.map((p) => SAMPLES[p] ?? p);
  const [draft, setDraft] = useState<Record<NotifyLocale, string>>(view.body);
  const [on, setOn] = useState(view.enabled);
  const [problems, setProblems] = useState<Partial<Record<NotifyLocale, keyof typeof PROBLEM_LABEL>>>({});
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | 'stale' | CommonErrorKey>('idle');

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = { en: bodyProblem(event, draft.en), hi: bodyProblem(event, draft.hi) };
    if (local.en ?? local.hi) {
      setProblems({ ...(local.en ? { en: local.en } : {}), ...(local.hi ? { hi: local.hi } : {}) });
      setStatus('idle');
      document.getElementById(`${id}-${local.en ? 'en' : 'hi'}`)?.focus();
      return;
    }
    setProblems({});
    setStatus('busy');
    for (const save of templateSaves(event, view, { enabled: on, body: draft })) {
      const res = await adminApi(locale, '/admin/notifications/templates', SavedVersion, {
        method: 'PUT',
        body: { ...save, subject: null },
      });
      if (res.ok) continue;
      const problem = templateErrorProblem(res.code);
      if (problem === 'stale') {
        setStatus('stale');
        return;
      }
      if (problem) {
        setProblems({ [save.locale]: problem });
        setStatus('idle');
        document.getElementById(`${id}-${save.locale}`)?.focus();
        return;
      }
      setStatus(commonErrorKey(res.code));
      return;
    }
    setStatus('saved');
    track('admin_notifications_change', {
      target: event,
      action: on === view.enabled ? 'saved' : on ? 'enabled' : 'disabled',
    });
    await onReload();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={portalCard}
      noValidate
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-extrabold text-ink">{t(EVENT_LABEL[event])}</h3>
          <p className="mt-0.5 text-xs font-bold text-muted">
            {t(template.audience === 'partner' ? 'notify_audience_partner' : 'notify_audience_customer')} ·{' '}
            {t('notify_placeholders', { list: placeholders })}
          </p>
          {meta ? (
            <p className="mt-0.5 text-xs font-bold text-muted">
              {t('notify_meta_status', {
                en: t(metaStatusLabel(meta.en)),
                hi: t(metaStatusLabel(meta.hi)),
              })}
            </p>
          ) : null}
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold text-ink">
          {t('notify_switch')}
          <input
            type="checkbox"
            role="switch"
            checked={on}
            onChange={(e) => {
              setOn(e.target.checked);
              setStatus('idle');
            }}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-7 w-12 rounded-pill bg-line transition-colors peer-checked:bg-accent-button peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
          />
          <span className="w-10 text-xs text-muted">{on ? t('notify_on') : t('notify_off')}</span>
        </label>
      </div>
      <div className="mt-4 grid gap-4 tab:grid-cols-2">
        {(['en', 'hi'] as const).map((lang) => {
          const problem = problems[lang];
          const live = bodyProblem(event, draft[lang]);
          return (
            <div key={lang}>
              <label htmlFor={`${id}-${lang}`} className="text-xs font-bold text-muted">
                {t(lang === 'en' ? 'notify_text_en' : 'notify_text_hi')}
              </label>
              <textarea
                lang={lang}
                id={`${id}-${lang}`}
                rows={4}
                value={draft[lang]}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${id}-${lang}-err` : `${id}-${lang}-preview`}
                onChange={(e) => {
                  setDraft({ ...draft, [lang]: e.target.value });
                  setStatus('idle');
                }}
                className={`${portalField} py-2`}
              />
              {view.usesDefault[lang] ? (
                <p className="mt-1 text-xs text-muted">{t('api_notify_default_text')}</p>
              ) : null}
              {problem ? (
                <p id={`${id}-${lang}-err`} className="mt-1 text-sm font-bold text-error">
                  {t(PROBLEM_LABEL[problem], { list: placeholders })}
                </p>
              ) : null}
              <div
                id={`${id}-${lang}-preview`}
                className={`mt-2 rounded-lg border p-3 text-sm ${
                  live
                    ? 'border-line-card bg-surface-alt text-muted'
                    : 'border-success bg-success-bg text-ink'
                }`}
              >
                <p className="text-xs font-bold text-muted">{t('notify_preview')}</p>
                <p lang={lang} className="mt-1 whitespace-pre-line">
                  {preview(draft[lang], samples)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('notify_save')}
        </button>
        <p role="status" className="text-sm font-bold">
          {status === 'busy' ? <span className="text-muted">{t('api_common_saving')}</span> : null}
          {status === 'saved' ? <span className="text-success">{t('notify_saved')}</span> : null}
          {status === 'stale' ? <span className="text-error">{t('api_common_err_stale')}</span> : null}
          {status.startsWith('api_common_err_') && status !== 'api_common_err_stale' ? (
            <span className="text-error">{t(status as CommonErrorKey)}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}

function BudgetCard({ usage, onReload }: { usage: WhatsAppUsageDto; onReload: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const budgetPaise = usage.budgetPaise ?? DEFAULT_BUDGET_PAISE;
  const [draft, setDraft] = useState(String(Math.round(budgetPaise / 100)));
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | CommonErrorKey>('idle');
  const [min, max] = BUDGET_LIMITS.map((p) => p / 100) as [number, number];
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const paise = budgetPaiseFrom(draft, BUDGET_LIMITS);
    if (paise === null) {
      setError(true);
      document.getElementById('notify-budget')?.focus();
      return;
    }
    setError(false);
    setStatus('busy');
    const res = await adminApi(locale, '/admin/notifications/whatsapp/budget', SavedVersion, {
      method: 'PUT',
      body: { budgetPaise: paise, version: usage.budgetVersion },
    });
    if (!res.ok) {
      setStatus(commonErrorKey(res.code));
      return;
    }
    setStatus('saved');
    track('admin_notifications_change', { target: 'budget', action: 'budget' });
    await onReload();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={portalCard}
      noValidate
    >
      <h3 className="font-heading text-base font-extrabold text-ink">{t('notify_budget_title')}</h3>
      <p className="mt-1 text-sm text-muted">{t('notify_budget_help')}</p>
      <p className="mt-2 text-sm font-bold text-ink">
        {t('notify_budget_used', { used: formatPrice(usage.costPaise), budget: formatPrice(budgetPaise) })}
      </p>
      <p className="mt-1 text-sm text-muted">
        {t('api_notify_usage', {
          sent: num(usage.sent),
          delivered: num(usage.delivered),
          failed: num(usage.failed),
        })}
      </p>
      {usage.overBudget ? (
        <p role="alert" className="mt-1 text-sm font-bold text-error">
          {t('api_notify_over_budget')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="notify-budget" className="text-xs font-bold text-muted">
            {t('notify_budget_label')}
          </label>
          <input
            id="notify-budget"
            inputMode="numeric"
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'notify-budget-err' : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus('idle');
            }}
            className={`${portalField} w-40`}
          />
        </div>
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('notify_budget_save')}
        </button>
      </div>
      {error ? (
        <p id="notify-budget-err" className="mt-1 text-sm font-bold text-error">
          {t('notify_budget_err', { min: num(min), max: num(max) })}
        </p>
      ) : null}
      <p role="status" className="mt-2 text-sm font-bold">
        {status === 'busy' ? <span className="text-muted">{t('api_common_saving')}</span> : null}
        {status === 'saved' ? <span className="text-success">{t('notify_saved')}</span> : null}
        {status.startsWith('api_common_err_') ? (
          <span className="text-error">{t(status as CommonErrorKey)}</span>
        ) : null}
      </p>
    </form>
  );
}
