'use client';

import {
  RecoCategoryListDto,
  RecoRuleDto,
  RecoRuleListDto,
  type RecoRule,
} from '@mechdost/shared/recommendations';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

interface Category {
  id: string;
  slug: string;
  name: string;
  nameHi: string | null;
}
interface Form {
  id: string | null;
  version: number;
  trigger: string;
  suggest: string;
  label: string;
  labelHi: string;
  priority: string;
  active: boolean;
}
type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; rules: RecoRule[] };
type Said = { tone: 'ok' | 'error'; text: string } | null;

const DEVANAGARI = /[ऀ-ॿ]/;
const EMPTY: Form = {
  id: null,
  version: 1,
  trigger: '',
  suggest: '',
  label: '',
  labelHi: '',
  priority: '10',
  active: true,
};
const KNOWN_ERRORS = ['DUPLICATE_RULE', 'STALE_RULE', 'RULE_INVALID'] as const;

/**
 * Admin -> Catalogue -> "Goes well with" rules (spec 11, design 2026-11-15 item 4; real sign-in builds). Needs
 * `categories:write`; the API checks it again. A rule says "a product of this category suggests products of that
 * one", with the reason in English and Hindi. Edits carry the version shown, so two people never overwrite each other.
 * Created inline (no modal); one primary action.
 */
export function AdminRecoApi() {
  const t = useTranslations('adminReco');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [said, setSaid] = useState<Said>(null);
  const [working, setWorking] = useState(false);
  const base = useId();

  const reload = useCallback(async () => {
    const res = await adminApi(locale, '/admin/recommendation-rules', RecoRuleListDto);
    setLoad(res.ok ? { kind: 'ok', rules: res.data.rules } : { kind: 'error' });
  }, [locale]);
  useEffect(() => {
    void reload();
    void adminApi(locale, '/admin/recommendation-categories', RecoCategoryListDto).then((res) => {
      if (res.ok) setCategories(res.data.categories);
    });
  }, [locale, reload]);

  const catName = (c: { name: string; nameHi: string | null }) =>
    locale === 'hi' && c.nameHi ? c.nameHi : c.name;

  function errorText(code: string): string {
    return (KNOWN_ERRORS as readonly string[]).includes(code)
      ? t(`err_${code}` as 'err_DUPLICATE_RULE')
      : t('err_other');
  }

  async function save(e: SyntheticEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.trigger === form.suggest) {
      setSaid({ tone: 'error', text: t('err_same') });
      return;
    }
    if (!DEVANAGARI.test(form.labelHi)) {
      setSaid({ tone: 'error', text: t('err_hindi') });
      return;
    }
    setWorking(true);
    setSaid(null);
    const rule = {
      triggerCategoryId: form.trigger,
      suggestCategoryId: form.suggest,
      label: form.label,
      labelHi: form.labelHi,
      priority: Number(form.priority),
      active: form.active,
    };
    const res = form.id
      ? await adminApi(locale, `/admin/recommendation-rules/${form.id}`, RecoRuleDto, {
          method: 'PUT',
          body: { version: form.version, rule },
        })
      : await adminApi(locale, '/admin/recommendation-rules', RecoRuleDto, { method: 'POST', body: rule });
    setWorking(false);
    if (!res.ok) {
      setSaid({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setForm(null);
    setSaid({ tone: 'ok', text: t('saved') });
    await reload();
  }

  async function remove(r: RecoRule) {
    setWorking(true);
    setSaid(null);
    const res = await adminApi(
      locale,
      `/admin/recommendation-rules/${r.id}?version=${String(r.version)}`,
      { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
      { method: 'DELETE' },
    );
    setWorking(false);
    if (!res.ok) {
      setSaid({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setSaid({ tone: 'ok', text: t('deleted') });
    await reload();
  }

  const edit = (r: RecoRule) => {
    setSaid(null);
    setForm({
      id: r.id,
      version: r.version,
      trigger: r.triggerCategory.id,
      suggest: r.suggestCategory.id,
      label: r.label,
      labelHi: r.labelHi,
      priority: String(r.priority),
      active: r.active,
    });
  };

  const field = (name: string) => `${base}-${name}`;
  const select = (value: string, onChange: (v: string) => void, id: string) => (
    <select
      id={id}
      required
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className={portalField}
    >
      <option value="">{t('choose')}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {catName(c)}
        </option>
      ))}
    </select>
  );

  return (
    <section aria-labelledby={field('title')} className={`${adminCard} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={field('title')} className="font-heading text-lg font-extrabold text-ink">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">{t('intro')}</p>
        </div>
        {!form ? (
          <button
            data-disclosure-trigger="reco-new"
            type="button"
            onClick={() => {
              setSaid(null);
              setForm(EMPTY);
            }}
            className={portalPrimary}
          >
            {t('new')}
          </button>
        ) : null}
      </div>

      {form ? (
        <form onSubmit={(e) => void save(e)} className="space-y-3 rounded-tile border border-line-card p-4">
          <div className="grid gap-3 tab:grid-cols-2">
            <div>
              <label htmlFor={field('trigger')} className="text-sm font-bold text-ink">
                {t('trigger')}
              </label>
              {select(
                form.trigger,
                (v) => {
                  setForm({ ...form, trigger: v });
                },
                field('trigger'),
              )}
            </div>
            <div>
              <label htmlFor={field('suggest')} className="text-sm font-bold text-ink">
                {t('suggest')}
              </label>
              {select(
                form.suggest,
                (v) => {
                  setForm({ ...form, suggest: v });
                },
                field('suggest'),
              )}
            </div>
            <div>
              <label htmlFor={field('label')} className="text-sm font-bold text-ink">
                {t('label')}
              </label>
              <input
                id={field('label')}
                required
                minLength={2}
                maxLength={80}
                lang="en"
                value={form.label}
                onChange={(e) => {
                  setForm({ ...form, label: e.target.value });
                }}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor={field('labelHi')} className="text-sm font-bold text-ink">
                {t('labelHi')}
              </label>
              <input
                id={field('labelHi')}
                required
                minLength={2}
                maxLength={80}
                lang="hi"
                value={form.labelHi}
                onChange={(e) => {
                  setForm({ ...form, labelHi: e.target.value });
                }}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor={field('priority')} className="text-sm font-bold text-ink">
                {t('priority')}
              </label>
              <input
                id={field('priority')}
                required
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={form.priority}
                onChange={(e) => {
                  setForm({ ...form, priority: e.target.value });
                }}
                className={portalField}
              />
            </div>
            <label className="flex min-h-11 items-center gap-3 self-end text-sm font-bold text-ink">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => {
                  setForm({ ...form, active: e.target.checked });
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {t('active')}
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={working} className={portalPrimary}>
              {t('save')}
            </button>
            <button
              data-panel-cancel={form.id ? `reco-${form.id}` : 'reco-new'}
              type="button"
              onClick={() => {
                setForm(null);
                setSaid(null);
              }}
              className={portalQuiet}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm ${said?.tone === 'error' ? 'font-bold text-error' : 'text-muted'}`}
      >
        {said?.text ?? ''}
      </p>

      {load.kind === 'loading' ? <div className="skeleton h-24 rounded-card" aria-hidden="true" /> : null}
      {load.kind === 'error' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('loadError')}
        </p>
      ) : null}
      {load.kind === 'ok' && load.rules.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : null}
      {load.kind === 'ok' && load.rules.length > 0 ? (
        <ul className="divide-y divide-line">
          {load.rules.map((r) => {
            const names = { trigger: catName(r.triggerCategory), suggest: catName(r.suggestCategory) };
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 py-3 tab:flex-row tab:items-center tab:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{t('pair', names)}</p>
                  <p data-user-content lang={locale} className="text-[13px] text-muted">
                    {locale === 'hi' ? r.labelHi : r.label}
                  </p>
                  <p className="text-[13px] font-bold text-ink">
                    {r.active ? t('statusActive') : t('statusPaused')} · {r.priority}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    data-disclosure-trigger={`reco-${r.id}`}
                    type="button"
                    aria-label={t('editNamed', names)}
                    onClick={() => {
                      edit(r);
                    }}
                    className={portalQuiet}
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('deleteNamed', names)}
                    disabled={working}
                    onClick={() => void remove(r)}
                    className={portalQuiet}
                  >
                    {t('delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
