'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { CatalogueCard } from '@mechdost/shared/catalogue';
import type { QuoteRules } from '@mechdost/shared/quote-api';
import { useSession } from '@/demo/session';
import { useCart } from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { newQuoteKey, quoteErrorKey, type QuoteMessageKey } from '@/lib/quote-views';

/**
 * Bulk quote request on the API (real data mode; spec 19): products from the live catalogue (search, or prefilled
 * from `?product=` / `?from=cart`), quantities (≥ the admin's minimum in total), the delivery contact and address,
 * and a note. `POST /v1/quotes` with an Idempotency-Key per attempt (a double tap is one quote). Signed-in and
 * verified customers only; the API's codes come back as translated messages.
 */
type Field = 'items' | 'name' | 'phone' | 'address' | 'pincode';
interface Line {
  slug: string;
  sku: string | null;
  title: string;
  listPaise: number | null;
  qty: number;
}
type Rules = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; rules: QuoteRules };

const CITY = 'RPR'; // until the city selector (spec 15)
const input =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
const box = 'rounded-tile border border-line-card bg-surface-alt p-4';

async function catalogue() {
  const [{ call }, shared] = await Promise.all([
    import('@/lib/orders-api'),
    import('@mechdost/shared/catalogue'),
  ]);
  return { call, ...shared };
}

function cardLine(card: CatalogueCard, qty: number, sku: string | null = null): Line {
  return {
    slug: card.slug,
    sku,
    title: `${card.brand.name} ${card.name}`.trim(),
    listPaise: card.offer?.pricePaise ?? null,
    qty,
  };
}

export function QuoteRequestFormApi() {
  const t = useTranslations('quote');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const cart = useCart();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [rules, setRules] = useState<Rules>({ kind: 'loading' });
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogueCard[] | null>(null);
  const [searching, setSearching] = useState<'idle' | 'busy' | 'error'>('idle');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<QuoteMessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One key per attempt: a retry of the same request reuses it, any change starts a new attempt.
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const prefilled = useRef(false);
  const minUnits = rules.kind === 'ok' ? rules.rules.minUnits : 10;

  const loadRules = useCallback(async () => {
    const { fetchQuoteRules } = await import('@/lib/quote-api');
    const res = await fetchQuoteRules(locale);
    setRules(res.ok ? { kind: 'ok', rules: res.data } : { kind: 'error', code: res.code });
  }, [locale]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  // Once the PIN is complete the minimum is the PIN city's value (spec 19). Quiet update: the form stays as it is,
  // an older answer never overwrites a newer one, and a failed read keeps the rules already shown.
  const rulesPin = useRef('');
  const rulesForPin = useCallback(
    async (pin: string) => {
      const wanted = /^[1-9]\d{5}$/.test(pin) ? pin : '';
      if (wanted === rulesPin.current) return;
      rulesPin.current = wanted;
      const { fetchQuoteRules } = await import('@/lib/quote-api');
      const res = await fetchQuoteRules(locale, wanted || null);
      if (res.ok && rulesPin.current === wanted) setRules({ kind: 'ok', rules: res.data });
    },
    [locale],
  );
  const addresses = session?.role === 'customer' ? session.addresses : null;
  const savedPin = (addresses?.find((a) => a.isDefault) ?? addresses?.[0])?.pincode;
  useEffect(() => {
    if (savedPin) void rulesForPin(savedPin);
  }, [savedPin, rulesForPin]);

  // Prefill once: the product of `?product=`, or the cart's lines (with their packs) for `?from=cart`.
  const product = params.get('product');
  const fromCart = params.get('from') === 'cart';
  useEffect(() => {
    if (prefilled.current) return;
    const wanted = fromCart
      ? cart.map((l) => ({ slug: l.slug, sku: l.sku ?? null, qty: l.qty }))
      : product
        ? [{ slug: product, sku: null, qty: 10 }]
        : [];
    if (wanted.length === 0) return;
    prefilled.current = true;
    void (async () => {
      const { call, CatalogueProductSchema } = await catalogue();
      const found = await Promise.all(
        wanted.slice(0, 20).map(async (w) => {
          const res = await call(
            `/catalogue/products/${encodeURIComponent(w.slug)}?locale=${locale === 'hi' ? 'hi' : 'en'}&city=${CITY}`,
            CatalogueProductSchema,
          );
          if (!res.ok) return null;
          const variant = res.data.variants.find((v) => v.sku === w.sku) ?? res.data.variants[0];
          return {
            slug: res.data.slug,
            sku: w.sku ? (variant?.sku ?? null) : null,
            title: `${res.data.brand.name} ${res.data.name}`.trim(),
            listPaise: variant?.offer?.pricePaise ?? null,
            qty: Math.min(99, Math.max(1, w.qty)),
          } satisfies Line;
        }),
      );
      setLines(found.filter((l): l is Line => l !== null));
    })();
  }, [cart, fromCart, product, locale]);

  async function search() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching('busy');
    const { call, CataloguePageSchema } = await catalogue();
    const p = new URLSearchParams({
      q: q.slice(0, 120),
      locale: locale === 'hi' ? 'hi' : 'en',
      city: CITY,
      limit: '8',
    });
    const res = await call(`/catalogue/products?${p.toString()}`, CataloguePageSchema);
    if (res.ok) {
      setResults(res.data.items);
      setSearching('idle');
    } else setSearching('error');
  }

  function add(card: CatalogueCard) {
    setLines((ls) =>
      ls.some((l) => l.slug === card.slug) || ls.length >= 20 ? ls : [...ls, cardLine(card, minUnits)],
    );
    setResults(null);
    setQuery('');
  }

  const units = lines.reduce((n, l) => n + l.qty, 0);
  const listTotal = lines.every((l) => l.listPaise !== null)
    ? lines.reduce((n, l) => n + (l.listPaise ?? 0) * l.qty, 0)
    : null;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const phone = value('phone')
      .replace(/\D/g, '')
      .replace(/^91(?=\d{10}$)/, '');
    const next: Partial<Record<Field, string>> = {};
    if (lines.length === 0) next.items = t('errItems');
    else if (units < minUnits) next.items = t('errMin', { min: minUnits });
    if (value('name').length < 2) next.name = t('errName');
    if (!/^[6-9]\d{9}$/.test(phone)) next.phone = t('errPhone');
    if (value('address').length < 10) next.address = t('errAddress');
    if (!/^[1-9]\d{5}$/.test(value('pincode'))) next.pincode = t('errPincode');
    setErrors(next);
    setFailure(null);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`quote-${first}`)?.focus();
      return;
    }
    const body = {
      lines: lines.map((l) => ({ slug: l.slug, sku: l.sku, qty: l.qty })),
      address: {
        contactName: value('name'),
        contactPhone: `+91${phone}`,
        line1: value('address'),
        landmark: value('landmark') || null,
        pincode: value('pincode'),
      },
      note: value('note') || null,
    };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.body !== fingerprint) attempt.current = { body: fingerprint, key: newQuoteKey() };
    setSubmitting(true);
    const { createQuote } = await import('@/lib/quote-api');
    const res = await createQuote(locale, body, attempt.current.key);
    setSubmitting(false);
    if (res.ok) {
      track('click', { id: 'quote_requested', path: window.location.pathname });
      router.push(`${prefix}/quotes/${res.data.code}?new=1`);
      return;
    }
    const key = quoteErrorKey(res.code);
    if (key === 'api_err_min' || key === 'api_err_product' || key === 'api_err_duplicate') {
      setErrors({ items: key === 'api_err_min' ? t('errMin', { min: minUnits }) : t(key) });
      document.getElementById('quote-items')?.focus();
    } else if (key === 'api_err_pincode') {
      setErrors({ pincode: t(key) });
      document.getElementById('quote-pincode')?.focus();
    } else setFailure(key);
    track('click', { id: `quote_request_failed_${key}`, path: window.location.pathname });
  }

  if (rules.kind === 'error' && (rules.code === 'AUTH_REQUIRED' || rules.code === 'HTTP_401'))
    return (
      <div>
        <p className="text-ink">{t('api_signIn')}</p>
        <Link
          href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/quotes/new`)}`}
          className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('api_signInLink')}
        </Link>
      </div>
    );
  if (rules.kind === 'error')
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="font-bold text-ink">
          {t(quoteErrorKey(rules.code))}
        </p>
        <button
          type="button"
          onClick={() => {
            setRules({ kind: 'loading' });
            void loadRules();
          }}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
        >
          {t('api_retry')}
        </button>
      </div>
    );
  if (rules.kind === 'loading')
    return (
      <p role="status" className="text-muted">
        {t('api_loading')}
      </p>
    );
  if (rules.rules.open >= rules.rules.openLimit)
    return (
      <div>
        <p className="text-ink">{t('api_openFull', { limit: rules.rules.openLimit })}</p>
        <Link
          href={`${prefix}/account/quotes`}
          className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('api_allQuotes')}
        </Link>
      </div>
    );

  const customer = session?.role === 'customer' ? session : null;
  const saved = customer?.addresses.find((a) => a.isDefault) ?? customer?.addresses[0] ?? null;
  const aria = (id: Field) => ({
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `quote-${id}-error` : undefined,
  });
  const err = (id: Field) =>
    errors[id] ? (
      <p id={`quote-${id}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-6">
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('errorSummary')}
        </p>
      ) : null}

      <fieldset id="quote-items" tabIndex={-1} {...aria('items')}>
        <legend className="font-heading text-lg font-extrabold text-ink">{t('items')}</legend>
        <p className="mt-1 text-sm text-muted">{t('minUnits', { min: minUnits })}</p>

        <div className="mt-4">
          <label htmlFor="quote-search" className="text-xs font-bold text-muted">
            {t('api_search')}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="quote-search"
              type="search"
              value={query}
              maxLength={120}
              placeholder={t('api_searchPlaceholder')}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
              className={`${input} mt-0`}
            />
            <button
              type="button"
              onClick={() => void search()}
              disabled={query.trim().length < 2 || searching === 'busy'}
              aria-label={t('api_search')}
              className="press inline-flex size-11 shrink-0 items-center justify-center rounded-button border border-input-border text-ink hover:bg-pill disabled:opacity-50"
            >
              <Search aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div aria-live="polite">
            {searching === 'busy' ? <p className="mt-2 text-sm text-muted">{t('api_searching')}</p> : null}
            {searching === 'error' ? (
              <p className="mt-2 text-sm font-bold text-warning">{t('api_searchError')}</p>
            ) : null}
            {results?.length === 0 ? <p className="mt-2 text-sm text-muted">{t('api_noResults')}</p> : null}
          </div>
          {results && results.length > 0 ? (
            <ul className="mt-2 divide-y divide-line rounded-tile border border-line-card bg-surface">
              {results.map((card) => (
                <li key={card.slug} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 text-ink">
                    <span className="font-bold">{card.brand.name}</span> {card.name}
                    <span className="block text-xs text-muted">
                      {card.offer ? formatPrice(card.offer.pricePaise) : t('api_noPrice')}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      add(card);
                    }}
                    disabled={lines.some((l) => l.slug === card.slug)}
                    className="press inline-flex min-h-10 shrink-0 items-center rounded-button border border-input-border px-3 text-sm font-bold text-ink hover:bg-pill disabled:opacity-50"
                  >
                    {t('api_addProduct')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {lines.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {lines.map((line, i) => (
              <li key={line.slug} className={`${box} grid grid-cols-[1fr_96px_44px] items-end gap-2 p-3`}>
                <p className="min-w-0 self-center text-sm text-ink">
                  <span className="font-bold">{line.title}</span>
                  <span className="block text-xs text-muted">
                    {line.listPaise === null
                      ? t('api_noPrice')
                      : t('each', { price: formatPrice(line.listPaise) })}
                  </span>
                </p>
                <div>
                  <label htmlFor={`quote-qty-${String(i)}`} className="text-xs font-bold text-muted">
                    {t('qty')}
                  </label>
                  <input
                    id={`quote-qty-${String(i)}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={line.qty}
                    onChange={(e) => {
                      const qty = Math.min(99, Math.max(1, Math.floor(Number(e.target.value) || 1)));
                      setLines((ls) => ls.map((l, j) => (j === i ? { ...l, qty } : l)));
                    }}
                    className={`${input} tabular-nums`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLines((ls) => ls.filter((_, j) => j !== i));
                  }}
                  aria-label={t('remove', { name: line.title })}
                  className="press inline-flex size-11 items-center justify-center rounded-button text-muted hover:bg-pill"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-tile border border-dashed border-input-border p-4 text-sm text-muted">
            {t('api_noLines')}
          </p>
        )}
        <p className="mt-3 text-sm text-ink" aria-live="polite">
          <span className="font-bold">{t('units', { count: units })}</span>
          {listTotal !== null && listTotal > 0 ? (
            <span className="text-muted"> · {t('listTotal', { price: formatPrice(listTotal) })}</span>
          ) : null}
        </p>
        {err('items')}
      </fieldset>

      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <div>
          <label htmlFor="quote-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            id="quote-name"
            {...aria('name')}
            name="name"
            autoComplete="name"
            maxLength={80}
            defaultValue={customer?.name ?? ''}
            className={input}
          />
          {err('name')}
        </div>
        <div>
          <label htmlFor="quote-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input
            id="quote-phone"
            {...aria('phone')}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            defaultValue={customer?.phone ?? ''}
            className={input}
          />
          {err('phone')}
        </div>
        <div className="min-[600px]:col-span-2">
          <label htmlFor="quote-address" className="text-sm font-bold text-ink">
            {t('address')}
          </label>
          <input
            id="quote-address"
            {...aria('address')}
            name="address"
            autoComplete="street-address"
            maxLength={200}
            defaultValue={saved?.line1 ?? ''}
            className={input}
          />
          {err('address')}
        </div>
        <div>
          <label htmlFor="quote-landmark" className="text-sm font-bold text-ink">
            {t('api_landmark')}
          </label>
          <input
            id="quote-landmark"
            name="landmark"
            maxLength={120}
            defaultValue={saved?.landmark ?? ''}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="quote-pincode" className="text-sm font-bold text-ink">
            {t('pincode')}
          </label>
          <input
            id="quote-pincode"
            {...aria('pincode')}
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            onChange={(e) => {
              void rulesForPin(e.target.value.trim());
            }}
            defaultValue={saved?.pincode ?? ''}
            className={input}
          />
          {err('pincode')}
        </div>
      </div>

      <div>
        <label htmlFor="quote-note" className="text-sm font-bold text-ink">
          {t('note')}
        </label>
        <textarea
          id="quote-note"
          name="note"
          rows={3}
          maxLength={1000}
          placeholder={t('notePlaceholder')}
          className={`${input} py-2`}
        />
      </div>

      {failure ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t(failure)}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {t('api_openCount', { open: rules.rules.open, limit: rules.rules.openLimit })}
      </p>
      <button
        type="submit"
        disabled={submitting}
        className="press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 min-[600px]:w-auto"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
