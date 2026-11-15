'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';
import {
  BUDGET_LIMITS,
  WHATSAPP_EVENTS,
  bodyProblem,
  preview,
  saveBudget,
  saveEvent,
  useNotifyConfig,
  type NotifyLocale,
  type TemplateProblem,
} from '@/demo/notification-settings';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { EVENT_LABEL, PROBLEM_LABEL, SAMPLES } from './notify-labels';
import { portalCard, portalField, portalPrimary } from './portal-styles';

/** The API editor (real sign-in builds only): loaded on demand so demo bundles stay the same size. */
const NotificationsApi = dynamic(() => import('./admin-notifications-api').then((m) => m.NotificationsApi), {
  ssr: false,
});

/** Default message text per event in both languages (from the locale files, read raw on the server). */
export type NotifyDefaults = Record<WhatsAppTemplateKey, Record<NotifyLocale, string>>;

const CHANGE_LABEL = {
  saved: 'notify_change_saved',
  enabled: 'notify_change_enabled',
  disabled: 'notify_change_disabled',
  budget: 'notify_change_budget',
} as const;

const isEvent = (v: string): v is WhatsAppTemplateKey => (WHATSAPP_EVENTS as readonly string[]).includes(v);

/**
 * Admin → Notifications (spec 10; hard rule 8; user 2026-11-02). One card per WhatsApp event: on/off switch,
 * English and Hindi text with a live preview and the same checks as the API (no offer wording, exact {{n}}
 * placeholders), saved with compare-and-set. Monthly budget alert and recent changes below.
 */
export function AdminNotifications({ actor, defaults }: { actor: string; defaults: NotifyDefaults }) {
  return AUTH_MODE === 'firebase' ? (
    <NotificationsApi defaults={defaults} />
  ) : (
    <DemoNotifications actor={actor} defaults={defaults} />
  );
}

function DemoNotifications({ actor, defaults }: { actor: string; defaults: NotifyDefaults }) {
  const t = useTranslations('portal');
  const config = useNotifyConfig();
  return (
    <section aria-labelledby="notify-title" className="space-y-5">
      <div>
        <h2 id="notify-title" className="font-heading text-xl font-extrabold text-ink">
          {t('notify_title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('notify_intro')}</p>
      </div>
      <div
        role="status"
        className="rounded-card border border-line-card bg-private-bg p-4 text-sm text-private"
      >
        <p className="font-bold">
          <span aria-hidden="true">📴 </span>
          {t('notify_status_off')}
        </p>
        <p className="mt-1">{t('notify_status_body')}</p>
      </div>
      <ul className="grid gap-4">
        {WHATSAPP_EVENTS.map((event) => (
          <li key={event}>
            <EventCard
              event={event}
              actor={actor}
              defaults={defaults[event]}
              enabled={config.events[event]?.enabled ?? false}
              body={config.events[event]?.body ?? {}}
              version={config.events[event]?.version ?? 0}
            />
          </li>
        ))}
      </ul>
      <BudgetCard actor={actor} budgetPaise={config.budgetPaise} version={config.budgetVersion} />
      <div className={portalCard}>
        <h3 className="font-heading text-base font-extrabold text-ink">{t('notify_history')}</h3>
        {config.history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('notify_history_empty')}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {config.history.slice(0, 8).map((h) => (
              <li key={`${h.at}-${h.target}`}>
                {t(CHANGE_LABEL[h.change], {
                  actor: h.actor,
                  target: isEvent(h.target) ? t(EVENT_LABEL[h.target]) : h.target,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EventCard({
  event,
  actor,
  defaults,
  enabled,
  body,
  version,
}: {
  event: WhatsAppTemplateKey;
  actor: string;
  defaults: Record<NotifyLocale, string>;
  enabled: boolean;
  body: Partial<Record<NotifyLocale, string>>;
  version: number;
}) {
  const t = useTranslations('portal');
  const id = useId();
  const template = WHATSAPP_TEMPLATES[event];
  const placeholders = template.params.map((_, i) => `{{${String(i + 1)}}}`).join(', ');
  const samples = template.params.map((p) => SAMPLES[p] ?? p);
  const [draft, setDraft] = useState<Record<NotifyLocale, string>>({
    en: body.en ?? defaults.en,
    hi: body.hi ?? defaults.hi,
  });
  const [on, setOn] = useState(enabled);
  const [base, setBase] = useState(version);
  const [problems, setProblems] = useState<Partial<Record<NotifyLocale, TemplateProblem>>>({});
  const [status, setStatus] = useState<'idle' | 'saved' | 'stale'>('idle');

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = saveEvent(event, base, actor, { enabled: on, body: draft });
    if (!result.ok) {
      if (result.reason === 'stale') setStatus('stale');
      else {
        setProblems(result.problems);
        setStatus('idle');
        document.getElementById(`${id}-${result.problems.en ? 'en' : 'hi'}`)?.focus();
      }
      return;
    }
    setProblems({});
    setBase(base + 1);
    setStatus('saved');
    track('admin_notifications_change', {
      target: event,
      action: on === enabled ? 'saved' : on ? 'enabled' : 'disabled',
    });
  }

  return (
    <form onSubmit={onSubmit} className={portalCard} noValidate>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-extrabold text-ink">{t(EVENT_LABEL[event])}</h3>
          <p className="mt-0.5 text-xs font-bold text-muted">
            {t(template.audience === 'partner' ? 'notify_audience_partner' : 'notify_audience_customer')} ·{' '}
            {t('notify_placeholders', { list: placeholders })}
          </p>
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
        {(['en', 'hi'] as const).map((locale) => {
          const problem = problems[locale];
          const live = bodyProblem(event, draft[locale]);
          return (
            <div key={locale}>
              <label htmlFor={`${id}-${locale}`} className="text-xs font-bold text-muted">
                {t(locale === 'en' ? 'notify_text_en' : 'notify_text_hi')}
              </label>
              <textarea
                lang={locale}
                id={`${id}-${locale}`}
                rows={4}
                value={draft[locale]}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `${id}-${locale}-err` : `${id}-${locale}-preview`}
                onChange={(e) => {
                  setDraft({ ...draft, [locale]: e.target.value });
                  setStatus('idle');
                }}
                className={`${portalField} py-2`}
              />
              {problem ? (
                <p id={`${id}-${locale}-err`} className="mt-1 text-sm font-bold text-error">
                  {t(PROBLEM_LABEL[problem], { list: placeholders })}
                </p>
              ) : null}
              <div
                id={`${id}-${locale}-preview`}
                className={`mt-2 rounded-lg border p-3 text-sm ${
                  live
                    ? 'border-line-card bg-surface-alt text-muted'
                    : 'border-success bg-success-bg text-ink'
                }`}
              >
                <p className="text-xs font-bold text-muted">{t('notify_preview')}</p>
                <p lang={locale} className="mt-1 whitespace-pre-line">
                  {preview(draft[locale], samples)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={portalPrimary}>
          {t('notify_save')}
        </button>
        <p role="status" className="text-sm font-bold">
          {status === 'saved' ? <span className="text-success">{t('notify_saved')}</span> : null}
          {status === 'stale' ? <span className="text-error">{t('notify_stale')}</span> : null}
        </p>
      </div>
    </form>
  );
}

function BudgetCard({
  actor,
  budgetPaise,
  version,
}: {
  actor: string;
  budgetPaise: number;
  version: number;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [draft, setDraft] = useState(String(Math.round(budgetPaise / 100)));
  const [base, setBase] = useState(version);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'stale'>('idle');
  const usedPaise = 0; // Demo: nothing is sent while WhatsApp is off; production reads GET /admin/notifications/whatsapp.
  const [min, max] = BUDGET_LIMITS.map((p) => p / 100) as [number, number];
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = draft.trim();
    const rupees = Number(raw);
    if (!/^\d+$/.test(raw) || rupees < min || rupees > max) {
      setError(true);
      document.getElementById('notify-budget')?.focus();
      return;
    }
    setError(false);
    const result = saveBudget(base, actor, rupees * 100);
    if (result === 'stale') {
      setStatus('stale');
      return;
    }
    setBase(base + 1);
    setStatus('saved');
    track('admin_notifications_change', { target: 'budget', action: 'budget' });
  }

  return (
    <form onSubmit={onSubmit} className={portalCard} noValidate>
      <h3 className="font-heading text-base font-extrabold text-ink">{t('notify_budget_title')}</h3>
      <p className="mt-1 text-sm text-muted">{t('notify_budget_help')}</p>
      <p className="mt-2 text-sm font-bold text-ink">
        {t('notify_budget_used', {
          used: formatPrice(usedPaise),
          budget: formatPrice(budgetPaise),
        })}
      </p>
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
        <button type="submit" className={portalPrimary}>
          {t('notify_budget_save')}
        </button>
      </div>
      {error ? (
        <p id="notify-budget-err" className="mt-1 text-sm font-bold text-error">
          {t('notify_budget_err', { min: num(min), max: num(max) })}
        </p>
      ) : null}
      <p role="status" className="mt-2 text-sm font-bold">
        {status === 'saved' ? <span className="text-success">{t('notify_saved')}</span> : null}
        {status === 'stale' ? <span className="text-error">{t('notify_stale')}</span> : null}
      </p>
    </form>
  );
}
