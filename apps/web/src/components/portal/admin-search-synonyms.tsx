'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  SearchSynonymListSchema,
  SearchSynonymSchema,
  SynonymActiveResultSchema,
  type SearchSynonymDto,
} from '@mechdost/shared/search-api';
import { SEARCH_VOCAB_KINDS, SEARCH_VOCAB_LOCALES } from '@mechdost/shared/search';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { ApiListState } from './api-list-state';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

const BASE = '/admin/catalogue/search-synonyms';
const OWN_ERROR: Record<string, 'syn_err_exists' | 'syn_err_category'> = {
  SYNONYM_EXISTS: 'syn_err_exists',
  SYNONYM_CATEGORY: 'syn_err_category',
};
const SHOWN = 60;

/**
 * Admin → Catalogue → Search words (spec 02 "Smart search", hard rule 8): Hinglish and Hindi synonyms, category
 * words and vehicle words the search understands. Add a word, switch one off (history kept); each change is audited
 * and reaches every instance within 30 seconds. A closable panel (no stacked modals): one list, one add form.
 */
export function AdminSearchSynonyms() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchSynonymDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ term: '', locale: 'hinglish', kind: 'synonym', expandsTo: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminApi(locale, BASE, SearchSynonymListSchema);
    setLoading(false);
    if (res.ok) setItems(res.data.items);
    else setError(res.code);
  }, [locale]);

  useEffect(() => {
    if (open && items.length === 0) void load();
  }, [open, items.length, load]);

  const say = (ok: boolean, text: string) => {
    setMessage({ ok, text });
  };
  const errText = (code: string) => t(OWN_ERROR[code] ?? commonErrorKey(code));

  async function add(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const expandsTo = form.expandsTo
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const res = await adminApi(locale, BASE, SearchSynonymSchema, {
      method: 'POST',
      body: { term: form.term, locale: form.locale, kind: form.kind, expandsTo },
    });
    setBusy(false);
    if (!res.ok) {
      say(false, errText(res.code));
      return;
    }
    track('admin_site_change', { area: 'search_synonyms', action: 'save', fields: 1 });
    setItems((list) => [res.data, ...list]);
    setForm({ ...form, term: '', expandsTo: '' });
    say(true, t('syn_saved'));
  }

  async function toggle(row: SearchSynonymDto) {
    const res = await adminApi(locale, `${BASE}/${row.id}`, SynonymActiveResultSchema, {
      method: 'PATCH',
      body: { version: row.version, active: !row.active },
    });
    if (!res.ok) {
      say(false, errText(res.code));
      if (res.code === 'STALE_SYNONYM') void load();
      return;
    }
    setItems((list) =>
      list.map((r) => (r.id === row.id ? { ...r, active: res.data.active, version: res.data.version } : r)),
    );
    say(true, t('syn_saved'));
  }

  const q = filter.trim().toLowerCase();
  const shown = items.filter(
    (r) => q === '' || r.term.includes(q) || r.expandsTo.some((x) => x.toLowerCase().includes(q)),
  );

  return (
    <section aria-labelledby="syn-title" className={`${portalCard} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="syn-title" className="font-heading text-lg font-extrabold text-ink">
            {t('syn_title')}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('syn_intro')}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="syn-panel"
          onClick={() => {
            setOpen(!open);
          }}
          className={portalQuiet}
        >
          {open ? t('syn_close') : t('syn_open')}
        </button>
      </div>
      {open ? (
        <div id="syn-panel" className="space-y-4">
          <form onSubmit={(e) => void add(e)} className="grid gap-3 tab:grid-cols-4">
            <div>
              <label htmlFor="syn-term" className="text-xs font-bold text-muted">
                {t('syn_term')}
              </label>
              <input
                id="syn-term"
                required
                maxLength={60}
                value={form.term}
                onChange={(e) => {
                  setForm({ ...form, term: e.target.value });
                }}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor="syn-lang" className="text-xs font-bold text-muted">
                {t('syn_language')}
              </label>
              <select
                id="syn-lang"
                value={form.locale}
                onChange={(e) => {
                  setForm({ ...form, locale: e.target.value });
                }}
                className={portalField}
              >
                {SEARCH_VOCAB_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`syn_lang_${l}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="syn-kind" className="text-xs font-bold text-muted">
                {t('syn_kind')}
              </label>
              <select
                id="syn-kind"
                value={form.kind}
                onChange={(e) => {
                  setForm({ ...form, kind: e.target.value });
                }}
                className={portalField}
              >
                {SEARCH_VOCAB_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`syn_kind_${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="syn-means" className="text-xs font-bold text-muted">
                {t('syn_means')}
              </label>
              <input
                id="syn-means"
                required
                maxLength={300}
                value={form.expandsTo}
                aria-describedby="syn-means-help"
                onChange={(e) => {
                  setForm({ ...form, expandsTo: e.target.value });
                }}
                className={portalField}
              />
            </div>
            <p id="syn-means-help" className="text-xs text-muted tab:col-span-3">
              {t('syn_means_help')}
            </p>
            <button type="submit" disabled={busy} className={portalPrimary}>
              {t('syn_add')}
            </button>
          </form>

          <p
            role="status"
            className={`min-h-5 text-sm font-bold ${message?.ok === false ? 'text-error' : 'text-ink'}`}
          >
            {message?.text ?? ''}
          </p>

          <div>
            <label htmlFor="syn-filter" className="text-xs font-bold text-muted">
              {t('syn_filter')}
            </label>
            <input
              id="syn-filter"
              type="search"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
              className={`${portalField} max-w-sm`}
            />
          </div>
          <ApiListState
            loading={loading}
            error={error}
            count={items.length}
            empty={t('syn_empty')}
            onRetry={() => void load()}
          />
          <ul className="divide-y divide-line-card">
            {shown.slice(0, SHOWN).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-28 font-bold text-ink">{r.term}</span>
                <span className="text-muted">{t(`syn_kind_${r.kind}`)}</span>
                <span className="min-w-0 flex-1 text-ink">{r.expandsTo.join(', ')}</span>
                <span className="text-xs text-muted">{t(`syn_lang_${r.locale}`)}</span>
                <button
                  type="button"
                  aria-pressed={r.active}
                  onClick={() => void toggle(r)}
                  className={portalQuiet}
                >
                  {r.active ? t('syn_on') : t('syn_off')}
                  <span className="sr-only"> {r.term}</span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length > SHOWN ? (
            <p className="text-xs text-muted">{t('syn_more', { count: shown.length - SHOWN })}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
