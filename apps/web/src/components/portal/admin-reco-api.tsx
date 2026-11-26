'use client';

import {
  RecoCategoryListDto,
  RecoProductListDto,
  RecoRuleDto,
  RecoRuleListDto,
  type RecoRule,
  type RecoSuggestKind,
} from '@mechdost/shared/recommendations';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

interface Category {
  id: string;
  slug: string;
  name: string;
  nameHi: string | null;
}
interface Picked {
  id: string;
  name: string;
  nameHi: string | null;
}
interface Form {
  id: string | null;
  version: number;
  /** Phase 3 (2026-11-26): the trigger is a category or one product; the suggestion a category, a product or the
   * workshop fitting link. */
  triggerKind: 'category' | 'product';
  suggestKind: RecoSuggestKind;
  trigger: string;
  suggest: string;
  triggerProduct: Picked | null;
  suggestProduct: Picked | null;
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
  triggerKind: 'category',
  suggestKind: 'category',
  trigger: '',
  suggest: '',
  triggerProduct: null,
  suggestProduct: null,
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
  const [invalid, setInvalid] = useState<string | null>(null);
  useDisclosureFocus(form ? (form.id ? `reco-${form.id}` : 'reco-new') : null, 'reco-new');

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
  /** What a rule's side is called in the list: the category or product name, or "workshop fitting". */
  const sideName = (r: RecoRule, side: 'trigger' | 'suggest'): string => {
    const ref =
      side === 'trigger' ? (r.triggerCategory ?? r.triggerProduct) : (r.suggestCategory ?? r.suggestProduct);
    return ref ? catName(ref) : t('fittingName');
  };

  function errorText(code: string): string {
    return (KNOWN_ERRORS as readonly string[]).includes(code)
      ? t(`err_${code}` as 'err_DUPLICATE_RULE')
      : t('err_other');
  }

  /** Shows a check error on its field: marked invalid, focused, and announced (cleared first so a repeat speaks). */
  function refuse(fieldId: string, text: string) {
    setSaid(null);
    setInvalid(fieldId);
    window.requestAnimationFrame(() => {
      setSaid({ tone: 'error', text });
      document.getElementById(fieldId)?.focus();
    });
  }

  async function save(e: SyntheticEvent) {
    e.preventDefault();
    if (!form) return;
    setInvalid(null);
    const pickerOf = (side: 'trigger' | 'suggest') =>
      field(side === 'trigger' ? 'triggerProduct' : 'suggestProduct');
    const triggerId = form.triggerKind === 'product' ? form.triggerProduct?.id : form.trigger;
    const suggestId =
      form.suggestKind === 'product'
        ? form.suggestProduct?.id
        : form.suggestKind === 'category'
          ? form.suggest
          : null;
    if (!triggerId || suggestId === undefined || suggestId === '') {
      refuse(
        !triggerId
          ? form.triggerKind === 'product'
            ? pickerOf('trigger')
            : field('trigger')
          : form.suggestKind === 'product'
            ? pickerOf('suggest')
            : field('suggest'),
        t('err_product'),
      );
      return;
    }
    if (form.triggerKind === form.suggestKind && triggerId === suggestId) {
      refuse(form.suggestKind === 'product' ? pickerOf('suggest') : field('suggest'), t('err_same'));
      return;
    }
    if (!DEVANAGARI.test(form.labelHi)) {
      refuse(field('labelHi'), t('err_hindi'));
      return;
    }
    setWorking(true);
    setSaid(null);
    const rule = {
      ...(form.triggerKind === 'product'
        ? { triggerProductId: triggerId }
        : { triggerCategoryId: triggerId }),
      suggestKind: form.suggestKind,
      ...(form.suggestKind === 'product' && suggestId ? { suggestProductId: suggestId } : {}),
      ...(form.suggestKind === 'category' && suggestId ? { suggestCategoryId: suggestId } : {}),
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
    document.getElementById(field('title'))?.focus();
  }

  const edit = (r: RecoRule) => {
    setSaid(null);
    setForm({
      id: r.id,
      version: r.version,
      triggerKind: r.triggerProduct ? 'product' : 'category',
      suggestKind: r.suggestKind,
      trigger: r.triggerCategory?.id ?? '',
      suggest: r.suggestCategory?.id ?? '',
      triggerProduct: r.triggerProduct,
      suggestProduct: r.suggestProduct,
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
      aria-invalid={invalid === id || undefined}
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
          <h2 id={field('title')} tabIndex={-1} className="font-heading text-lg font-extrabold text-ink">
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
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold text-ink">{t('triggerKind')}</legend>
              <KindChoice
                name={field('triggerKind')}
                firstField={form.id ? `reco-${form.id}` : 'reco-new'}
                value={form.triggerKind}
                options={[
                  ['category', t('kindCategory')],
                  ['product', t('kindProduct')],
                ]}
                onChange={(v) => {
                  setForm({ ...form, triggerKind: v });
                }}
              />
            </fieldset>
            <div>
              {form.triggerKind === 'category' ? (
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
              ) : (
                <ProductPicker
                  id={field('triggerProduct')}
                  invalid={invalid === field('triggerProduct')}
                  picked={form.triggerProduct}
                  onPick={(v) => {
                    setForm({ ...form, triggerProduct: v });
                  }}
                />
              )}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold text-ink">{t('suggestKind')}</legend>
              <KindChoice
                name={field('suggestKind')}
                value={form.suggestKind}
                options={[
                  ['category', t('kindCategory')],
                  ['product', t('kindProduct')],
                  ['workshop_fitting', t('suggestFitting')],
                ]}
                onChange={(v) => {
                  setForm({ ...form, suggestKind: v });
                }}
              />
            </fieldset>
            <div>
              {form.suggestKind === 'category' ? (
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
              ) : form.suggestKind === 'product' ? (
                <ProductPicker
                  id={field('suggestProduct')}
                  invalid={invalid === field('suggestProduct')}
                  picked={form.suggestProduct}
                  onPick={(v) => {
                    setForm({ ...form, suggestProduct: v });
                  }}
                />
              ) : null}
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
                aria-invalid={invalid === field('labelHi') || undefined}
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
            const names = { trigger: sideName(r, 'trigger'), suggest: sideName(r, 'suggest') };
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

/** A small radio group (no ARIA widget needed: native radios in a fieldset). */
function KindChoice<K extends string>({
  name,
  value,
  options,
  onChange,
  firstField,
}: {
  name: string;
  value: K;
  options: readonly (readonly [K, string])[];
  onChange: (v: K) => void;
  /** `data-disclosure-field` key for the checked radio (focus target when the form opens). */
  firstField?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map(([k, label]) => (
        <label key={k} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name={name}
            value={k}
            checked={value === k}
            data-disclosure-field={value === k ? firstField : undefined}
            onChange={() => {
              onChange(k);
            }}
            className="size-5 accent-[var(--color-accent-button)]"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/**
 * The product picker of the rule form: a search box and a Find button (no combobox), then the results as buttons;
 * the chosen product is named under the box. Searches `GET /admin/recommendation-products?q=` (catalogue staff only).
 */
function ProductPicker({
  id,
  picked,
  onPick,
  invalid,
}: {
  id: string;
  picked: Picked | null;
  onPick: (p: Picked) => void;
  invalid: boolean;
}) {
  const t = useTranslations('adminReco');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Picked[] | null>(null);
  // One status line, always present: the search result, a short-query hint, or a failure (a11y review 2026-11-26).
  const [note, setNote] = useState('');
  const name = (p: Picked) => (locale === 'hi' && p.nameHi ? p.nameHi : p.name);

  async function find() {
    setNote('');
    if (q.trim().length < 2) {
      window.requestAnimationFrame(() => {
        setNote(t('tooShort'));
      });
      return;
    }
    setFound(null);
    const res = await adminApi(
      locale,
      `/admin/recommendation-products?q=${encodeURIComponent(q.trim())}`,
      RecoProductListDto,
    );
    const list = res.ok ? res.data.products : [];
    setFound(list);
    setNote(
      !res.ok
        ? t('searchFailed')
        : list.length === 0
          ? t('noProducts')
          : t('foundCount', { count: list.length }),
    );
  }

  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {t('productSearch')}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          name="reco-product-search"
          autoComplete="off"
          spellCheck={false}
          value={q}
          minLength={2}
          maxLength={60}
          aria-describedby={`${id}-help`}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void find();
            }
          }}
          className={portalField}
        />
        <button type="button" onClick={() => void find()} className={portalQuiet}>
          {t('find')}
        </button>
      </div>
      <p id={`${id}-help`} className="mt-1 text-[13px] text-muted">
        {t('productSearchHelp')}
      </p>
      <p role="status" className="mt-2 text-sm text-muted">
        {note}
      </p>
      {found && found.length > 0 ? (
        <fieldset className="mt-2 max-w-full space-y-1">
          <legend className="sr-only">{t('chooseProduct')}</legend>
          {found.map((p) => (
            <label
              key={p.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-tile border border-line-card px-3 text-sm text-ink hover:bg-pill has-[:checked]:border-accent has-[:checked]:font-bold"
            >
              <input
                type="radio"
                name={`${id}-pick`}
                checked={picked?.id === p.id}
                onChange={() => {
                  onPick(p);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {name(p)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p className="mt-2 text-sm font-bold text-ink">{picked ? t('chosen', { name: name(picked) }) : ''}</p>
    </div>
  );
}
