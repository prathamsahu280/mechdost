'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  ADMIN_QUOTE_VIEWS,
  type AdminQuoteView,
  type QuoteDetail,
  type QuoteSummary,
} from '@mechdost/shared/quote-api';
import { QUOTE_WITHDRAW_REASONS, type QuoteStatus, type QuoteWithdrawReason } from '@mechdost/shared/state';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import {
  lowPriceLines,
  offerDraft,
  quoteErrorKey,
  quotePhotoProblem,
  quoteStatusKey,
  type QuoteMessageKey,
} from '@/lib/quote-views';
import { PhotoPicker, QuoteAttachments, SeenMark } from '@/components/quotes/quote-attachments';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

type List =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ok'; items: QuoteSummary[]; nextCursor: string | null };
type Detail =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ok'; quote: QuoteDetail };

const OPEN: readonly QuoteStatus[] = ['open', 'negotiating', 'offered'];
const POLL_MS = 20_000;

/**
 * Admin quote desk on the API (real sign-in; spec 19): the queue by view (waiting for us, open, offered, expiring,
 * closed), and per quote the thread with a reply as MechDost, the offer builder (unit price per line, delivery,
 * validity, terms; the discount against the catalogue total is information only, Q20) and "withdraw" with a reason
 * code and a message. Every change sends the quote's `version`; a 409 reloads the quote. Refreshes every 20 s.
 */
export function QuoteDeskApi() {
  const t = useTranslations('portal');
  const q = useTranslations('quote');
  const locale = useLocale();
  const [view, setView] = useState<AdminQuoteView>('waiting');
  const [list, setList] = useState<List>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>({ kind: 'none' });

  const loadList = useCallback(
    async (cursor?: string) => {
      const { fetchAdminQuotes } = await import('@/lib/quote-api');
      const res = await fetchAdminQuotes(locale, view, cursor);
      if (!res.ok) {
        setList({ kind: 'error', code: res.code });
        return;
      }
      setList((prev) =>
        cursor && prev.kind === 'ok'
          ? { kind: 'ok', items: [...prev.items, ...res.data.items], nextCursor: res.data.nextCursor }
          : { kind: 'ok', items: res.data.items, nextCursor: res.data.nextCursor },
      );
    },
    [locale, view],
  );

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const { fetchAdminQuote } = await import('@/lib/quote-api');
    const res = await fetchAdminQuote(locale, selected);
    setDetail(res.ok ? { kind: 'ok', quote: res.data } : { kind: 'error', code: res.code });
  }, [locale, selected]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadDetail();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDetail();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [loadDetail]);

  const changed = useCallback(async () => {
    await Promise.all([loadDetail(), loadList()]);
  }, [loadDetail, loadList]);

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
      <section aria-labelledby="quote-list">
        <h2 id="quote-list" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_quotes')}
        </h2>
        <div role="group" aria-label={q('api_admin_views')} className="mt-3 flex flex-wrap gap-2">
          {ADMIN_QUOTE_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setList({ kind: 'loading' });
              }}
              className={`press min-h-10 rounded-pill px-3 text-sm font-bold ${
                view === v
                  ? 'bg-accent-soft text-accent-soft-text'
                  : 'border border-line-card text-ink hover:bg-pill'
              }`}
            >
              {q(`api_admin_view_${v}`)}
            </button>
          ))}
        </div>
        {list.kind === 'loading' ? (
          <p role="status" className="mt-3 text-sm text-muted">
            {q('api_loading')}
          </p>
        ) : null}
        {list.kind === 'error' ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm font-bold text-ink">
              {q(quoteErrorKey(list.code))}
            </p>
            <button type="button" onClick={() => void loadList()} className={portalQuiet}>
              {q('api_retry')}
            </button>
          </div>
        ) : null}
        {list.kind === 'ok' && list.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
        ) : null}
        {list.kind === 'ok' && list.items.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {list.items.map((x) => (
              <li key={x.code}>
                <button
                  type="button"
                  aria-pressed={selected === x.code}
                  onClick={() => {
                    setSelected(x.code);
                    setDetail({ kind: 'loading' });
                  }}
                  className={`press w-full rounded-tile border p-3 text-left ${
                    selected === x.code
                      ? 'border-accent-button bg-accent-soft'
                      : 'border-line-card bg-surface hover:bg-pill'
                  }`}
                >
                  <span className="block font-bold text-ink">{x.code}</span>
                  <span className="block text-xs text-muted">
                    {formatDate(x.createdAt, locale)} · {q('units', { count: x.units })} ·{' '}
                    {q(quoteStatusKey(x.status))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {list.kind === 'ok' && list.nextCursor ? (
          <button
            type="button"
            onClick={() => void loadList(list.nextCursor ?? undefined)}
            className={`${portalQuiet} mt-3`}
          >
            {q('api_admin_loadMore')}
          </button>
        ) : null}
      </section>

      {detail.kind === 'none' ? <p className="text-sm text-muted">{t('selectQuote')}</p> : null}
      {detail.kind === 'loading' ? (
        <p role="status" className="text-sm text-muted">
          {q('api_loading')}
        </p>
      ) : null}
      {detail.kind === 'error' ? (
        <div className={`${portalCard} flex flex-wrap items-center gap-3`}>
          <p role="alert" className="font-bold text-ink">
            {q(quoteErrorKey(detail.code))}
          </p>
          <button type="button" onClick={() => void loadDetail()} className={portalQuiet}>
            {q('api_retry')}
          </button>
        </div>
      ) : null}
      {detail.kind === 'ok' ? (
        <QuoteWork key={detail.quote.code} quote={detail.quote} onChanged={changed} />
      ) : null}
    </div>
  );
}

function QuoteWork({ quote, onChanged }: { quote: QuoteDetail; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const q = useTranslations('quote');
  const locale = useLocale();
  const open = OPEN.includes(quote.status);
  const offer = quote.currentOffer;
  return (
    <div className="space-y-6">
      <section aria-labelledby="quote-chat" className={portalCard}>
        <h2 id="quote-chat" className="font-heading text-lg font-extrabold text-ink">
          {quote.code} · <span data-user-content>{quote.address.contactName}</span> ·{' '}
          {q(quoteStatusKey(quote.status))}
        </h2>
        <p className="mt-1 text-sm text-muted">
          <span data-user-content>
            {quote.address.line1}
            {quote.address.landmark ? `, ${quote.address.landmark}` : ''}
          </span>{' '}
          · {quote.address.pincode} · {quote.address.contactPhone}
        </p>
        <ul className="mt-4 divide-y divide-line text-sm">
          {quote.lineItems.map((l) => (
            <li key={l.lineNo} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 text-ink">
                <span className="font-bold">{l.title}</span> <span className="text-muted">({l.sku})</span>
              </span>
              <span className="shrink-0 text-ink tabular-nums">
                × {l.qty} · {l.listUnitPaise === null ? q('api_noPrice') : formatPrice(l.listUnitPaise)}
              </span>
            </li>
          ))}
        </ul>
        {offer ? (
          <p className="mt-3 rounded-lg bg-pill p-3 text-sm text-ink">
            {q('api_admin_currentOffer', {
              version: offer.version,
              total: formatPrice(offer.totalPaise),
              date: formatDate(offer.validUntil, locale),
            })}
            {offer.expired ? ` · ${q('api_status_expired')}` : ''}
          </p>
        ) : null}
        {quote.closingMessage ? (
          <p data-user-content className="mt-3 rounded-lg bg-surface-alt p-3 text-sm text-ink">
            {quote.closingMessage}
          </p>
        ) : null}
        <Thread quote={quote} />
        {open ? (
          <Reply quote={quote} onChanged={onChanged} />
        ) : (
          <p className="mt-4 text-sm text-muted">{t('quoteClosed')}</p>
        )}
      </section>
      {open ? <OfferBuilder key={quote.version} quote={quote} onChanged={onChanged} /> : null}
      {open ? <Withdraw quote={quote} onChanged={onChanged} /> : null}
    </div>
  );
}

function Thread({ quote }: { quote: QuoteDetail }) {
  const q = useTranslations('quote');
  const locale = useLocale();
  // The team has now seen the thread: tell the customer ("Seen"), once per newest message; a failure is silent.
  const markedFor = useRef<string | null>(null);
  const newestId = quote.messages.at(-1)?.id ?? null;
  const code = quote.code;
  useEffect(() => {
    if (!newestId || markedFor.current === newestId || document.visibilityState !== 'visible') return;
    markedFor.current = newestId;
    void import('@/lib/quote-api').then(({ markQuoteRead }) => markQuoteRead(locale, code, true));
  }, [newestId, code, locale]);
  return (
    <ol className="mt-4 max-h-80 space-y-3 overflow-y-auto">
      {quote.messages.length === 0 ? <li className="text-sm text-muted">{q('noMessages')}</li> : null}
      {quote.messages.map((m) => {
        const ours = m.from !== 'customer';
        return (
          <li key={m.id} className={`flex ${ours ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm text-ink ${ours ? 'rounded-br-md bg-accent-soft' : 'rounded-bl-md bg-surface-alt'}`}
            >
              <p className="text-[11px] font-extrabold text-muted">
                {ours ? q('team') : <span data-user-content>{quote.address.contactName}</span>} ·{' '}
                {formatDate(m.at, locale)}
              </p>
              <p data-user-content className="mt-0.5 whitespace-pre-wrap">
                {m.body}
              </p>
              <QuoteAttachments attachments={m.attachments} />
              {m.seen ? (
                <p className="text-right">
                  <SeenMark />
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Reply({ quote, onChanged }: { quote: QuoteDetail; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const q = useTranslations('quote');
  const locale = useLocale();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<QuoteMessageKey | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = reply.trim();
    if (busy || (!text && files.length === 0)) return;
    setProblem(null);
    if (files.length > 0) {
      const bad = quotePhotoProblem(files);
      if (bad) {
        setProblem(quoteErrorKey(bad));
        return;
      }
      if (!text) {
        setProblem('api_err_photoNote');
        return;
      }
    }
    setBusy(true);
    const { postAdminQuoteMessage, sendQuotePhotoMessage } = await import('@/lib/quote-api');
    const res =
      files.length > 0
        ? await sendQuotePhotoMessage(locale, quote.code, text, files, true)
        : await postAdminQuoteMessage(locale, quote.code, text);
    setBusy(false);
    if (res.ok) {
      setReply('');
      setFiles([]);
      track('click', {
        id: files.length > 0 ? 'admin_quote_photo_reply' : 'admin_quote_reply',
        path: window.location.pathname,
      });
      await onChanged();
    } else setProblem(quoteErrorKey(res.code));
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4">
      {problem ? (
        <p role="alert" className="mb-2 text-sm font-bold text-warning">
          {q(problem)}
        </p>
      ) : null}
      <div className="mb-2">
        <PhotoPicker files={files} onChange={setFiles} disabled={busy} describedBy="admin-attach-hint" />
        <p id="admin-attach-hint" className="mt-1 text-xs text-muted">
          {q('api_attachHint')}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <label htmlFor="admin-reply" className="sr-only">
          {t('replyAs')}
        </label>
        <textarea
          id="admin-reply"
          rows={1}
          value={reply}
          maxLength={1000}
          placeholder={t('replyAs')}
          onChange={(e) => {
            setReply(e.target.value);
          }}
          className={`${portalField} mt-0 resize-none py-2.5`}
        />
        <button
          type="submit"
          disabled={(!reply.trim() && files.length === 0) || busy}
          className={portalPrimary}
        >
          {q('send')}
        </button>
      </div>
    </form>
  );
}

function OfferBuilder({ quote, onChanged }: { quote: QuoteDetail; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const q = useTranslations('quote');
  const locale = useLocale();
  const current = quote.currentOffer;
  const [prices, setPrices] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      quote.lineItems.map((l) => {
        const unit = current?.lines.find((x) => x.lineNo === l.lineNo)?.unitPaise ?? l.listUnitPaise;
        return [l.lineNo, unit === null ? '' : String(unit / 100)];
      }),
    ),
  );
  const [delivery, setDelivery] = useState(String((current?.deliveryPaise ?? 0) / 100));
  const [days, setDays] = useState('3');
  const [terms, setTerms] = useState(current?.terms ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  // Prices below the shop price or under a tenth of list need this tick (review I2; the API refuses them without).
  const [confirmLow, setConfirmLow] = useState(false);
  const [result, setResult] = useState<
    { ok: true; version: number } | { ok: false; key: QuoteMessageKey } | null
  >(null);
  const draft = offerDraft(quote.lineItems, prices, delivery, days);
  const errors = !draft.ok && tried ? draft.errors : {};
  const errorText = (code: string | undefined, id: string) =>
    code ? (
      <p id={`${id}-error`} className="mt-1 text-sm font-bold text-error">
        {code === 'range'
          ? t('daysRange')
          : code === 'empty'
            ? t('priceEmpty')
            : code === 'zero'
              ? t('priceZero')
              : t('priceFormat')}
      </p>
    ) : null;
  const listTotal = quote.listTotalPaise;
  const subtotal = draft.ok ? draft.totalPaise - draft.deliveryPaise : 0;
  const discount = listTotal && draft.ok ? Math.round(((listTotal - subtotal) / listTotal) * 100) : 0;
  const low = draft.ok
    ? lowPriceLines(quote.lineItems, draft.lines)
    : { belowCost: [], belowTenthOfList: [] };
  const needsConfirm = low.belowCost.length > 0 || low.belowTenthOfList.length > 0;

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    setResult(null);
    if (!draft.ok) {
      const first = Object.keys(draft.errors)[0];
      const id = first === 'delivery' ? 'offer-delivery' : first === 'days' ? 'offer-days' : first;
      if (id) document.getElementById(id)?.focus();
      track('click', { id: 'admin_quote_offer_invalid', path: window.location.pathname });
      return;
    }
    if (needsConfirm && !confirmLow) {
      document.getElementById('offer-confirm-low')?.focus();
      setResult({ ok: false, key: 'api_admin_confirmLowNeeded' });
      return;
    }
    setBusy(true);
    const { sendAdminOffer } = await import('@/lib/quote-api');
    const res = await sendAdminOffer(locale, quote.code, {
      version: quote.version,
      lines: draft.lines,
      deliveryPaise: draft.deliveryPaise,
      validDays: draft.validDays,
      terms: terms.trim() || null,
      confirmLowPrices: needsConfirm && confirmLow,
    });
    setBusy(false);
    if (res.ok) {
      setResult({ ok: true, version: res.data.offerVersion });
      track('click', { id: 'admin_quote_offer_sent', path: window.location.pathname });
      await onChanged();
    } else {
      setResult({ ok: false, key: quoteErrorKey(res.code) });
      if (res.code === 'STALE_QUOTE') await onChanged();
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-labelledby="offer-builder"
      className={`${portalCard} space-y-4`}
    >
      <h2 id="offer-builder" className="font-heading text-lg font-extrabold text-ink">
        {t('offerBuilder')}
      </h2>
      {quote.lineItems.map((l) => {
        const id = `price-${String(l.lineNo)}`;
        const err = (errors as Record<string, string | undefined>)[id];
        const parsed = draft.ok ? draft.lines.find((x) => x.lineNo === l.lineNo)?.unitPaise : undefined;
        return (
          <div key={l.lineNo}>
            <label htmlFor={id} className="text-sm font-bold text-ink">
              {t('unitPrice', { name: l.title })}
            </label>
            <input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              aria-required="true"
              aria-invalid={err ? true : undefined}
              aria-describedby={[err ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(' ')}
              value={prices[l.lineNo] ?? ''}
              onChange={(e) => {
                setPrices((p) => ({ ...p, [l.lineNo]: e.target.value }));
              }}
              className={portalField}
            />
            {errorText(err, id)}
            {parsed !== undefined && l.listUnitPaise !== null && parsed > l.listUnitPaise ? (
              <p role="status" className="mt-1 text-xs font-bold text-warning">
                {t('aboveList', { price: formatPrice(l.listUnitPaise) })}
              </p>
            ) : null}
            {low.belowCost.includes(l.lineNo) || low.belowTenthOfList.includes(l.lineNo) ? (
              <p role="status" className="mt-1 text-xs font-bold text-warning">
                {low.belowTenthOfList.includes(l.lineNo)
                  ? q('api_admin_belowTenth')
                  : q('api_admin_belowCost', { price: formatPrice(l.costPaise ?? 0) })}
              </p>
            ) : null}
            <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
              {l.listUnitPaise === null
                ? `${q('api_noPrice')} · × ${String(l.qty)}`
                : t('listPrice', { price: formatPrice(l.listUnitPaise), qty: l.qty })}
              {' · '}
              {l.costPaise === null
                ? q('api_admin_noShop', { stock: l.stock ?? 0 })
                : q('api_admin_shopPrice', { price: formatPrice(l.costPaise), stock: l.stock ?? 0 })}
            </p>
          </div>
        );
      })}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="offer-delivery" className="text-sm font-bold text-ink">
            {t('delivery')}
          </label>
          <input
            id="offer-delivery"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={errors.delivery ? true : undefined}
            aria-describedby={errors.delivery ? 'offer-delivery-error' : undefined}
            value={delivery}
            onChange={(e) => {
              setDelivery(e.target.value);
            }}
            className={portalField}
          />
          {errorText(errors.delivery, 'offer-delivery')}
        </div>
        <div>
          <label htmlFor="offer-days" className="text-sm font-bold text-ink">
            {t('validDays')}
          </label>
          <input
            id="offer-days"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={errors.days ? true : undefined}
            aria-describedby={[errors.days ? 'offer-days-error' : null, 'offer-days-hint']
              .filter(Boolean)
              .join(' ')}
            value={days}
            onChange={(e) => {
              setDays(e.target.value.trim());
            }}
            className={portalField}
          />
          {errorText(errors.days, 'offer-days')}
          <p id="offer-days-hint" className="mt-1 text-xs text-muted">
            {t('daysRange')}
          </p>
        </div>
      </div>
      <div>
        <label htmlFor="offer-note" className="text-sm font-bold text-ink">
          {t('offerNote')}
        </label>
        <input
          id="offer-note"
          value={terms}
          maxLength={500}
          onChange={(e) => {
            setTerms(e.target.value);
          }}
          className={portalField}
        />
      </div>
      <p className="font-heading text-xl font-extrabold text-ink">
        {draft.ok ? t('offerTotal', { price: formatPrice(draft.totalPaise) }) : t('fixPrices')}
      </p>
      {/* Price is set by negotiation (user, Q20): the discount is shown for information, never gated. */}
      {discount > 0 ? (
        <p className="rounded-lg bg-pill p-3 text-sm font-bold text-ink">
          {t('discountInfo', { percent: discount })}
        </p>
      ) : null}
      <p className="text-xs text-muted">{q('api_cod')}</p>
      {needsConfirm ? (
        <label className="flex min-h-11 items-start gap-3 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
          <input
            id="offer-confirm-low"
            type="checkbox"
            checked={confirmLow}
            onChange={(e) => {
              setConfirmLow(e.target.checked);
            }}
            className="mt-0.5 size-5 accent-[var(--color-accent-button)]"
          />
          {q('api_admin_confirmLow')}
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('sendOffer')}
        </button>
        <p role="status" className="text-sm font-bold">
          {result?.ok ? (
            <span className="text-success">{q('api_admin_offerSent', { version: result.version })}</span>
          ) : null}
          {result && !result.ok ? <span className="text-warning">{q(result.key)}</span> : null}
        </p>
      </div>
    </form>
  );
}

function Withdraw({ quote, onChanged }: { quote: QuoteDetail; onChanged: () => Promise<void> }) {
  const q = useTranslations('quote');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<QuoteWithdrawReason | ''>('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<QuoteMessageKey | null>(null);
  const valid = reason !== '' && message.trim().length >= 10 && message.trim().length <= 500;

  if (!open)
    return (
      <button
        data-disclosure-trigger={`withdraw-${quote.code}`}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className={portalQuiet}
      >
        {q('api_admin_withdraw')}
      </button>
    );

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setProblem(null);
    const { withdrawAdminQuote } = await import('@/lib/quote-api');
    const res = await withdrawAdminQuote(locale, quote.code, {
      version: quote.version,
      reasonCode: reason,
      message: message.trim(),
    });
    setBusy(false);
    if (res.ok) {
      track('click', { id: `admin_quote_withdrawn_${reason}`, path: window.location.pathname });
      await onChanged();
    } else setProblem(quoteErrorKey(res.code));
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${portalCard} space-y-3`}>
      <h2 className="font-heading text-lg font-extrabold text-ink">{q('api_admin_withdraw')}</h2>
      <div>
        <label htmlFor="withdraw-reason" className="text-sm font-bold text-ink">
          {q('api_admin_withdrawReason')}
        </label>
        <select
          id="withdraw-reason"
          value={reason}
          onChange={(e) => {
            setReason(QUOTE_WITHDRAW_REASONS.find((r) => r === e.target.value) ?? '');
          }}
          className={portalField}
        >
          <option value="">{q('api_admin_withdrawPick')}</option>
          {QUOTE_WITHDRAW_REASONS.map((r) => (
            <option key={r} value={r}>
              {q(`api_withdraw_${r}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="withdraw-message" className="text-sm font-bold text-ink">
          {q('api_admin_withdrawMessage')}
        </label>
        <textarea
          id="withdraw-message"
          rows={3}
          maxLength={500}
          value={message}
          aria-describedby="withdraw-message-hint"
          onChange={(e) => {
            setMessage(e.target.value);
          }}
          className={`${portalField} py-2`}
        />
        <p id="withdraw-message-hint" className="mt-1 text-xs text-muted">
          {q('api_admin_withdrawHint')}
        </p>
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-bold text-warning">
          {q(problem)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!valid || busy} className={portalPrimary}>
          {q('api_admin_withdraw')}
        </button>
        <button
          data-panel-cancel={`withdraw-${quote.code}`}
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {q('api_keepOpen')}
        </button>
      </div>
    </form>
  );
}
