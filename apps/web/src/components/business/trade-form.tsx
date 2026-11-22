'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { TRADE_BUSINESS_TYPES, TRADE_SPEND_BANDS } from '@mechdost/shared/business-codes';
import { track } from '@/lib/analytics';
import {
  businessErrorView,
  TRADE_FIELD_ORDER,
  tradeBody,
  validateTrade,
  type TradeField,
  type TradeValues,
} from '@/lib/business-apply-view';
import type { CategoryOption } from '@/lib/business-api';
import {
  ChoiceGroup,
  ConsentField,
  ErrorSummary,
  FormError,
  SubmitButton,
  TextField,
  fieldId,
} from './form-parts';

const EMPTY: TradeValues = {
  businessName: '',
  businessType: '',
  gstin: '',
  pincode: '',
  spendBand: '',
  categories: [],
  consent: false,
};

type Categories = { state: 'loading' } | { state: 'error' } | { state: 'ready'; options: CategoryOption[] };

/**
 * Trade account application (audience entry design 2026-11-22, item 3). The account is the signed-in person's:
 * nothing about who they are is typed here. Codes only (type, spend band, category slugs); the GSTIN is optional.
 */
export function TradeForm({ onDone }: { onDone: (code: string) => void }) {
  const t = useTranslations('business');
  const locale = useLocale();
  const [values, setValues] = useState<TradeValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<TradeField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Categories>({ state: 'loading' });
  const [focus, setFocus] = useState<{ n: number; where: 'summary' | 'form' }>({ n: 0, where: 'summary' });
  const summaryRef = useRef<HTMLDivElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const loadCategories = useCallback(async () => {
    setCategories({ state: 'loading' });
    const { fetchCategoryOptions } = await import('@/lib/business-api');
    const res = await fetchCategoryOptions(locale);
    setCategories(res.ok ? { state: 'ready', options: res.data } : { state: 'error' });
  }, [locale]);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (focus.n === 0) return;
    (focus.where === 'summary' ? summaryRef : formErrorRef).current?.focus();
  }, [focus]);

  const set = <K extends keyof TradeValues>(key: K, value: TradeValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };
  const toggle = (value: string) => {
    set(
      'categories',
      values.categories.includes(value)
        ? values.categories.filter((c) => c !== value)
        : [...values.categories, value],
    );
  };
  const msg = (f: TradeField) => {
    const key = errors[f];
    return key ? t(key as 'err_businessName') : undefined;
  };

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validateTrade(values);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setFocus((f) => ({ n: f.n + 1, where: 'summary' }));
      return;
    }
    setBusy(true);
    const { submitTradeApplication } = await import('@/lib/business-api');
    const res = await submitTradeApplication(locale, tradeBody(values));
    setBusy(false);
    if (!res.ok) {
      const view = businessErrorView(res.code);
      if (view.pincode) {
        setErrors({ pincode: 'errForm_pincodeNotServed' });
        setFocus((f) => ({ n: f.n + 1, where: 'summary' }));
        return;
      }
      setFormError(view.form ? t(view.form) : t('errForm_generic'));
      setFocus((f) => ({ n: f.n + 1, where: 'form' }));
      return;
    }
    track('click', { id: 'business_apply_trade', path: window.location.pathname });
    onDone(res.data.code);
  }

  const labels: Record<TradeField, string> = {
    businessName: t('businessName'),
    businessType: t('legend_businessType'),
    gstin: t('gstin'),
    pincode: t('pincode'),
    spendBand: t('legend_spend'),
    categories: t('legend_categories'),
    consent: t('consent_trade'),
  };
  const summary = TRADE_FIELD_ORDER.flatMap((name) => {
    const message = msg(name);
    return message ? [{ name, message, label: labels[name] }] : [];
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
      <ErrorSummary items={summary} summaryRef={summaryRef} />
      <div ref={formErrorRef} tabIndex={-1} id="biz-form-error">
        <FormError id="biz-form-error-text" text={formError} />
      </div>

      <TextField
        name="businessName"
        label={labels.businessName}
        required
        autoComplete="organization"
        maxLength={120}
        value={values.businessName}
        onChange={(v) => {
          set('businessName', v);
        }}
        {...(msg('businessName') ? { error: msg('businessName') } : {})}
      />
      <ChoiceGroup
        name="businessType"
        legend={labels.businessType}
        required
        type="radio"
        options={TRADE_BUSINESS_TYPES.map((v) => ({ value: v, label: t(`type_${v}`) }))}
        selected={values.businessType ? [values.businessType] : []}
        onToggle={(v) => {
          set('businessType', v);
        }}
        {...(msg('businessType') ? { error: msg('businessType') } : {})}
      />
      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <TextField
          name="gstin"
          label={labels.gstin}
          required={false}
          hint={t('gstinHint')}
          autoComplete="off"
          inputMode="text"
          maxLength={20}
          value={values.gstin}
          onChange={(v) => {
            set('gstin', v);
          }}
          {...(msg('gstin') ? { error: msg('gstin') } : {})}
        />
        <TextField
          name="pincode"
          label={labels.pincode}
          required
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={6}
          value={values.pincode}
          onChange={(v) => {
            set('pincode', v);
          }}
          {...(msg('pincode') ? { error: msg('pincode') } : {})}
        />
      </div>
      <ChoiceGroup
        name="spendBand"
        legend={labels.spendBand}
        required
        type="radio"
        options={TRADE_SPEND_BANDS.map((v) => ({ value: v, label: t(`spend_${v}`) }))}
        selected={values.spendBand ? [values.spendBand] : []}
        onToggle={(v) => {
          set('spendBand', v);
        }}
        {...(msg('spendBand') ? { error: msg('spendBand') } : {})}
      />
      {categories.state === 'ready' ? (
        <ChoiceGroup
          name="categories"
          legend={labels.categories}
          required
          hint={t('categoriesHint')}
          type="checkbox"
          options={categories.options.map((c) => ({ value: c.slug, label: c.name }))}
          selected={values.categories}
          onToggle={toggle}
          {...(msg('categories') ? { error: msg('categories') } : {})}
        />
      ) : (
        <div id={fieldId('categories')} tabIndex={-1}>
          {categories.state === 'loading' ? (
            <p role="status" className="text-sm text-muted">
              {t('categoriesLoading')}
            </p>
          ) : (
            <div className="space-y-2">
              <p role="alert" className="text-sm font-bold text-error">
                {t('categoriesError')}
              </p>
              <button
                type="button"
                onClick={() => void loadCategories()}
                className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {t('categoriesRetry')}
              </button>
            </div>
          )}
        </div>
      )}
      <ConsentField
        checked={values.consent}
        onChange={(v) => {
          set('consent', v);
        }}
        label={labels.consent}
        {...(msg('consent') ? { error: msg('consent') } : {})}
      />
      <SubmitButton busy={busy} label={t('submit_trade')} busyLabel={t('submitting')} />
    </form>
  );
}
