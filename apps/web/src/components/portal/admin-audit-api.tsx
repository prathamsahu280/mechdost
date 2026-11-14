'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { AuditRowDto } from '@mechdost/shared/admin-people-api';
import { fetchAudit, filledFilters, type AuditQuery } from '@/lib/admin-people-api';
import { formatDateTimeIst, peopleErrorKey } from '@/lib/admin-people-view';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { diffJson } from '@/lib/audit-diff';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

const EMPTY: AuditQuery = { entity: '', entityId: '', code: '', actor: '', action: '', from: '', to: '' };
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * Admin → Audit log (real sign-in builds; design 2026-11-15, spec 13): who changed what and when, newest first.
 * Filters: entity, entity id or order/request/ticket code, actor, action and an IST date range. Read-only; each
 * row opens to its reason and a before/after list (contact details inside are masked by the API, always). The
 * latest entries load at once; "Load more" follows the cursor.
 */
export function AdminAuditApi() {
  const t = useTranslations('adminPeople');
  const tc = useTranslations('portal');
  const locale = useLocale();
  const [query, setQuery] = useState<AuditQuery>(EMPTY);
  const [rows, setRows] = useState<AuditRowDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  const run = useCallback(
    async (q: AuditQuery, after?: string) => {
      setLoading(true);
      const res = await fetchAudit(locale, q, after);
      setLoading(false);
      if (!res.ok) {
        setError(res.code);
        return;
      }
      setError(null);
      setRows((prev) => (after ? [...prev, ...res.data.rows] : res.data.rows));
      setCursor(res.data.nextCursor);
      if (!after)
        track('admin_audit_search', {
          filters: filledFilters(q),
          results: res.data.rows.length,
        });
    },
    [locale],
  );

  useEffect(() => {
    void run(EMPTY);
  }, [run]);

  function onSearch(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const q: AuditQuery = {
      entity: text(f.get('entity')),
      entityId: text(f.get('entityId')),
      code: text(f.get('code')),
      actor: text(f.get('actor')),
      action: text(f.get('action')),
      from: text(f.get('from')),
      to: text(f.get('to')),
    };
    setQuery(q);
    void run(q);
  }

  function onlyActor(actor: string) {
    const q = { ...query, actor };
    setQuery(q);
    const input = formRef.current?.elements.namedItem('actor');
    if (input instanceof HTMLInputElement) input.value = actor;
    void run(q);
  }

  const own = error ? peopleErrorKey(error) : null;
  const field = (name: keyof AuditQuery, label: string, extra: { type?: string; max?: number } = {}) => (
    <div>
      <label htmlFor={`audit-${name}`} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={`audit-${name}`}
        name={name}
        type={extra.type ?? 'text'}
        autoComplete="off"
        spellCheck={false}
        maxLength={extra.max ?? 80}
        className={portalField}
        defaultValue={query[name]}
      />
    </div>
  );

  return (
    <section aria-labelledby="audit-title" className="space-y-4">
      <div>
        <h2 id="audit-title" className="font-heading text-xl font-extrabold text-ink">
          {t('audit_title')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t('audit_lead')}</p>
      </div>

      <form
        ref={formRef}
        onSubmit={onSearch}
        noValidate
        role="search"
        className={`${portalCard} grid gap-3 min-[600px]:grid-cols-2 min-[1000px]:grid-cols-3`}
      >
        {field('entity', t('audit_entity'))}
        {field('entityId', t('audit_entityId'))}
        {field('code', t('audit_code'), { max: 40 })}
        {field('actor', t('audit_actor'), { max: 40 })}
        {field('action', t('audit_action'))}
        <div className="grid grid-cols-2 gap-2">
          {field('from', t('audit_from'), { type: 'date', max: 10 })}
          {field('to', t('audit_to'), { type: 'date', max: 10 })}
        </div>
        <div className="flex flex-wrap items-end gap-2 min-[600px]:col-span-2 min-[1000px]:col-span-3">
          <button type="submit" disabled={loading} className={portalPrimary}>
            {t('audit_search')}
          </button>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              formRef.current?.reset();
              setQuery(EMPTY);
              void run(EMPTY);
            }}
          >
            {t('audit_reset')}
          </button>
        </div>
      </form>
      <p className="text-xs text-muted">{t('audit_maskedNote')}</p>

      {error ? (
        <div role="alert" className={`${portalCard} flex flex-wrap items-center gap-3`}>
          <p className="text-sm font-bold text-error">{own ? t(own) : tc(commonErrorKey(error))}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              void run(query);
            }}
          >
            {tc('api_common_retry')}
          </button>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <p role="status" className="text-sm text-muted">
          {tc('api_common_loading')}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <div className={portalCard}>
          <p className="text-sm text-muted">{t('audit_none')}</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <AuditRow key={r.id} row={r} onOnlyActor={onlyActor} />
          ))}
        </ul>
      ) : null}
      {cursor ? (
        <button
          type="button"
          disabled={loading}
          className={portalQuiet}
          onClick={() => {
            void run(query, cursor);
          }}
        >
          {t('audit_more')}
        </button>
      ) : null}
    </section>
  );
}

function AuditRow({ row: r, onOnlyActor }: { row: AuditRowDto; onOnlyActor: (actor: string) => void }) {
  const t = useTranslations('adminPeople');
  const locale = useLocale();
  const lines = diffJson(r.before, r.after);
  return (
    <li className={`${portalCard} !p-0`}>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
          <span className="min-w-0 text-sm font-bold break-all text-ink" lang="en">
            {r.action}
          </span>
          <span className="text-xs text-muted">{formatDateTimeIst(r.at, locale)}</span>
          <span className="w-full text-xs break-all text-muted">
            <span lang="en">
              {r.entity}
              {r.entityId ? ` · ${r.entityId}` : ''}
            </span>
            {' · '}
            {r.actorUserId ? (
              <span data-user-content>{r.actorName ?? t('audit_actorUnknown')}</span>
            ) : (
              t('audit_system')
            )}
          </span>
        </summary>
        <div className="space-y-2 border-t border-line-card px-4 py-3 text-sm">
          {r.reason ? (
            <p className="text-ink">
              <span className="font-bold">{t('audit_reasonLabel')}</span>{' '}
              <span data-user-content>{r.reason}</span>
            </p>
          ) : null}
          {lines.length === 0 ? (
            <p className="text-muted">{t('audit_noChanges')}</p>
          ) : (
            <ul className="space-y-1">
              {lines.map((l) => (
                <li key={l.path} className="rounded-lg bg-surface-alt px-3 py-2">
                  <p className="text-xs font-bold text-ink">
                    <span className="mr-2 rounded-pill bg-pill px-2 py-0.5 text-muted">
                      {t(`audit_${l.kind}`)}
                    </span>
                    <span lang="en">{l.path === '' ? t('audit_wholeValue') : l.path}</span>
                  </p>
                  <p className="mt-1 font-mono text-xs break-all text-ink" lang="en">
                    {l.before !== null ? <span className="text-muted">{l.before}</span> : null}
                    {l.before !== null && l.after !== null ? ' → ' : null}
                    {l.after !== null ? <span>{l.after}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {r.actorUserId ? (
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                if (r.actorUserId) onOnlyActor(r.actorUserId);
              }}
            >
              {t('audit_onlyActor')}
            </button>
          ) : null}
        </div>
      </details>
    </li>
  );
}
