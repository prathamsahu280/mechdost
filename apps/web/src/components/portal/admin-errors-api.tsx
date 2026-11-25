'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { AdminErrors, type AdminErrorsDto, type ErrorProject } from '@mechdost/shared/admin-errors-api';
import { adminApi } from '@/lib/admin-api';
import { formatDate } from '@/lib/format';
import { ApiError } from './api-list-state';
import { AdminHeaderActions } from './admin-page-header';
import { portalQuiet } from './portal-styles';
import { StatusBadge, adminCard } from './admin-ui';

const PROJECT_LABEL: Record<ErrorProject, 'errors_api_projectWeb' | 'errors_api_projectApi'> = {
  web: 'errors_api_projectWeb',
  api: 'errors_api_projectApi',
};

type State = { kind: 'loading' } | { kind: 'failed'; code: string } | { kind: 'ready'; data: AdminErrorsDto };

/**
 * Admin → Errors (real sign-in builds; decision 2026-11-14, spec 08): the latest unresolved Sentry issues of the
 * website and the server, read through `GET /v1/admin/errors` (the Sentry token stays on the server). Counts,
 * dates and a link to Sentry only. One action: refresh. Not connected yet → one next step.
 */
export function AdminErrorsApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/errors', AdminErrors);
    setState(res.ok ? { kind: 'ready', data: res.data } : { kind: 'failed', code: res.code });
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

  return (
    <section aria-labelledby="admin-page-title" className="space-y-4">
      {state.kind === 'ready' && state.data.connected ? (
        <AdminHeaderActions>
          <button
            type="button"
            data-track="admin_errors_refresh"
            onClick={() => {
              void load();
            }}
            className={portalQuiet}
          >
            {t('errors_api_refresh')}
          </button>
        </AdminHeaderActions>
      ) : null}

      {state.kind === 'loading' ? (
        <p role="status" className="text-sm text-muted">
          {t('errors_api_loading')}
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <div className={`${adminCard} flex flex-wrap items-center gap-3`}>
          <ApiError code={state.code} />
          <button
            type="button"
            onClick={() => {
              setState({ kind: 'loading' });
              void load();
            }}
            className={portalQuiet}
          >
            {t('api_retry')}
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' && !state.data.connected ? (
        <div className={adminCard}>
          <h3 className="font-heading text-base font-extrabold text-ink">
            {t('errors_api_notConnectedTitle')}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('errors_api_notConnectedBody')}</p>
        </div>
      ) : null}

      {state.kind === 'ready' && state.data.connected ? (
        <>
          <p className="text-xs text-muted">
            {state.data.environment
              ? t('errors_api_environment', {
                  env:
                    state.data.environment === 'production'
                      ? t('errors_api_envProduction')
                      : state.data.environment,
                })
              : null}
            {state.data.fetchedAt
              ? ` · ${t('errors_api_updated', { time: time(state.data.fetchedAt) })}`
              : null}
          </p>
          {state.data.projects.map((p) => (
            <div key={p.project} className={adminCard}>
              <h3 className="font-heading text-base font-extrabold text-ink">
                {t(PROJECT_LABEL[p.project])}
              </h3>
              {!p.ok ? (
                <p role="alert" className="mt-2 text-sm font-bold text-error">
                  {t('errors_api_projectFailed')}
                </p>
              ) : p.issues.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{t('errors_api_none')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line-card">
                  {p.issues.map((i) => (
                    <li key={i.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 text-sm font-bold break-words text-ink" lang="en">
                          {i.title}
                        </p>
                        <StatusBadge code={i.level}>{t(`errors_api_level_${i.level}`)}</StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {t('errors_api_count24h', { count: i.count24h })} ·{' '}
                        {t('errors_api_countTotal', { count: i.countTotal })} ·{' '}
                        {t('errors_api_users', { count: i.usersAffected })}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {i.firstSeen
                          ? t('errors_api_firstSeen', { date: formatDate(i.firstSeen, locale) })
                          : null}
                        {i.firstSeen && i.lastSeen ? ' · ' : null}
                        {i.lastSeen
                          ? t('errors_api_lastSeen', {
                              date: `${formatDate(i.lastSeen, locale)} ${time(i.lastSeen)}`,
                            })
                          : null}
                      </p>
                      <a
                        href={i.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-track="admin_errors_open"
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
                      >
                        {t('errors_api_open')}
                        <span className="sr-only"> ({i.shortId})</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
