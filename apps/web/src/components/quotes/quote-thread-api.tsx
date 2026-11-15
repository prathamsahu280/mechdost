'use client';

import { BadgeCheck, Send } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { QuoteDetail, QuoteOffer, QuotePay } from '@mechdost/shared/quote-api';
import { QUOTE_DECLINE_REASONS, type QuoteDeclineReason, type QuoteStatus } from '@mechdost/shared/state';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { newQuoteKey, quoteErrorKey, quoteStatusKey, type QuoteMessageKey } from '@/lib/quote-views';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; quote: QuoteDetail };
const POLL_MS = 20_000;
const card = 'rounded-card border border-line-card bg-surface p-6 shadow-card';
const primary =
  'press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover';
const OPEN: readonly QuoteStatus[] = ['open', 'negotiating', 'offered'];

const STATUS_STYLE: Record<QuoteStatus, string> = {
  open: 'bg-warning-bg text-warning',
  negotiating: 'bg-warning-bg text-warning',
  offered: 'bg-accent-soft text-accent-soft-text',
  accepted: 'bg-success-bg text-success',
  declined: 'bg-pill text-muted',
  expired: 'bg-pill text-muted',
  withdrawn: 'bg-pill text-muted',
};

/**
 * Bulk quote thread on the API (real data mode; spec 19): `GET /v1/quotes/{code}` for the signed-in customer — the
 * active offer pinned on top with "Accept offer" as the single primary action (cash on delivery), the chat with
 * MechDost below, and "Close quote" with a reason. Accepting sends the offer version the customer saw (a replaced
 * offer is refused) and an Idempotency-Key (a double tap is one order). Refreshes every 20 s while visible.
 */
export function QuoteThreadApi({ code }: { code: string }) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const prefix = locale === 'hi' ? '/hi' : '';

  const refresh = useCallback(async () => {
    const { fetchMyQuote } = await import('@/lib/quote-api');
    const res = await fetchMyQuote(locale, code);
    setLoad(res.ok ? { kind: 'ok', quote: res.data } : { kind: 'error', code: res.code });
  }, [code, locale]);

  // Online payment of the accepted quote's order (spec 19): the checkout runs here so the result survives the offer
  // card leaving the screen once the quote is accepted.
  const [payNote, setPayNote] = useState<PayNote | null>(null);
  const [paying, setPaying] = useState(false);
  const startPayment = useCallback(
    async (handle: NonNullable<QuotePay['razorpay']> | null, orderCode: string, prefill: Prefill) => {
      if (!handle) {
        // Paid meanwhile, or the payment window closed: the refreshed thread tells which.
        setPayNote('expired');
        await refresh();
        return;
      }
      setPaying(true);
      setPayNote(null);
      const { checkoutQuote } = await import('@/lib/payments/pay-quote');
      const result = await checkoutQuote({ locale, orderCode, handle, prefill });
      setPaying(false);
      setPayNote(result.ok ? 'paid' : result.reason);
      track('click', {
        id: result.ok ? 'quote_paid_online' : `quote_pay_${result.reason}`,
        path: window.location.pathname,
      });
      await refresh();
    },
    [locale, refresh],
  );

  useEffect(() => {
    if (!code) return;
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [code, refresh]);

  if (!code || (load.kind === 'error' && quoteErrorKey(load.code) === 'api_err_notFound'))
    return (
      <div className={card}>
        <p className="text-muted">{t('api_notFound')}</p>
        <Link href={`${prefix}/account/quotes`} className={`${primary} mt-5`}>
          {t('api_allQuotes')}
        </Link>
      </div>
    );
  if (load.kind === 'error' && quoteErrorKey(load.code) === 'api_err_auth')
    return (
      <div className={card}>
        <p className="text-ink">{t('api_signIn')}</p>
        <Link
          href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/quotes/${code}`)}`}
          className={`${primary} mt-4`}
        >
          {t('api_signInLink')}
        </Link>
      </div>
    );
  if (load.kind === 'error')
    return (
      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <p role="alert" className="font-bold text-ink">
          {t(quoteErrorKey(load.code))}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
        >
          {t('api_retry')}
        </button>
      </div>
    );
  if (load.kind === 'loading')
    return (
      <p role="status" className={`${card} text-muted`}>
        {t('api_loading')}
      </p>
    );

  const quote = load.quote;
  const open = OPEN.includes(quote.status);
  const offer = quote.currentOffer;

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span className={`rounded-pill px-3 py-1 text-xs font-extrabold ${STATUS_STYLE[quote.status]}`}>
          {t(quoteStatusKey(quote.status))}
        </span>
        <span>{formatDate(quote.createdAt, locale)}</span>
      </p>

      {isNew && quote.status === 'open' ? (
        <div role="status" className="animate-page-in flex gap-3 rounded-tile bg-success-bg p-5 text-success">
          <BadgeCheck aria-hidden="true" className="size-6 shrink-0" />
          <div>
            <p className="font-heading font-bold">{t('sent')}</p>
            <p className="mt-1 text-sm">{t('sentBody')}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 nav:grid-cols-[minmax(0,1fr)_400px] nav:items-start">
        <div className="space-y-6 nav:order-2 nav:sticky nav:top-28">
          {quote.status === 'accepted' && quote.orderCode ? (
            <AcceptedCard
              quote={quote}
              orderCode={quote.orderCode}
              note={payNote}
              paying={paying}
              onPay={startPayment}
            />
          ) : null}
          <ClosedNote quote={quote} />
          {offer && (quote.status === 'offered' || quote.status === 'accepted') ? (
            <OfferCard quote={quote} offer={offer} onChanged={refresh} onPay={startPayment} />
          ) : (
            <RequestedLines quote={quote} waiting={open} />
          )}
          {open && quote.status !== 'offered' ? <CloseQuote code={quote.code} onChanged={refresh} /> : null}
        </div>
        <Chat quote={quote} open={open} onChanged={refresh} />
      </div>
    </div>
  );
}

type PayNote = 'paid' | 'cancelled' | 'failed' | 'unavailable' | 'not_confirmed' | 'expired';
interface Prefill {
  name: string;
  phone: string;
}
type OnPay = (
  handle: NonNullable<QuotePay['razorpay']> | null,
  orderCode: string,
  prefill: Prefill,
) => Promise<void>;
const PAY_NOTE_KEY = {
  paid: 'api_payPaid',
  cancelled: 'api_payCancelled',
  failed: 'api_payFailed',
  unavailable: 'api_err_payUnavailable',
  not_confirmed: 'api_payNotConfirmed',
  expired: 'api_payExpired',
} as const satisfies Record<PayNote, string>;
/** Payment states of an online order that still waits for money. */
const UNPAID: readonly string[] = ['created', 'attempted', 'failed'];

/** The accepted quote: the order, and for an unpaid online order "Pay now" (the one primary action then). */
function AcceptedCard({
  quote,
  orderCode,
  note,
  paying,
  onPay,
}: {
  quote: QuoteDetail;
  orderCode: string;
  note: PayNote | null;
  paying: boolean;
  onPay: OnPay;
}) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [problem, setProblem] = useState<QuoteMessageKey | null>(null);
  const [starting, setStarting] = useState(false);
  const waiting = quote.orderPayment?.method === 'online' && UNPAID.includes(quote.orderPayment.status);
  const paid = quote.orderPayment?.method === 'online' && quote.orderPayment.status === 'paid';

  async function payNow() {
    setStarting(true);
    setProblem(null);
    const { fetchQuotePay } = await import('@/lib/quote-api');
    const res = await fetchQuotePay(locale, quote.code);
    setStarting(false);
    if (!res.ok) {
      setProblem(quoteErrorKey(res.code));
      return;
    }
    await onPay(res.data.razorpay, orderCode, {
      name: quote.address.contactName,
      phone: quote.address.contactPhone,
    });
  }

  return (
    <section className={card} aria-labelledby="accepted-title">
      <h2 id="accepted-title" className="font-heading text-lg font-extrabold text-success">
        {t('acceptedTitle')}
      </h2>
      <p className="mt-2 text-sm text-ink">{t('acceptedBody', { code: orderCode })}</p>
      {waiting ? <p className="mt-3 text-sm text-ink">{t('api_payWaiting', { code: orderCode })}</p> : null}
      {paid && note !== 'paid' ? (
        <p role="status" className="mt-3 text-sm font-bold text-success">
          {t('api_payPaid', { code: orderCode })}
        </p>
      ) : null}
      {note ? (
        <p
          role={note === 'paid' ? 'status' : 'alert'}
          className={`mt-3 rounded-lg p-3 text-sm font-bold ${note === 'paid' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}
        >
          {t(PAY_NOTE_KEY[note], { code: orderCode })}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
          {t(problem)}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {waiting ? (
          <button
            type="button"
            onClick={() => void payNow()}
            disabled={paying || starting}
            className={`${primary} disabled:opacity-70`}
          >
            {paying || starting ? t('api_paying') : t('api_payNow')}
          </button>
        ) : null}
        <Link
          href={`${prefix}/orders/${orderCode}`}
          className={
            waiting
              ? 'inline-flex min-h-11 items-center px-2 text-sm font-bold text-muted underline-offset-4 hover:underline'
              : primary
          }
        >
          {t('viewOrder')}
        </Link>
      </div>
    </section>
  );
}

function ClosedNote({ quote }: { quote: QuoteDetail }) {
  const t = useTranslations('quote');
  if (quote.status === 'declined') return <p className={`${card} text-sm text-muted`}>{t('declinedBody')}</p>;
  if (quote.status === 'expired')
    return <p className={`${card} text-sm text-muted`}>{t('api_expiredBody')}</p>;
  if (quote.status === 'withdrawn')
    return (
      <div className={`${card} text-sm`}>
        <p className="font-bold text-ink">{t('api_withdrawnBody')}</p>
        {quote.closingMessage ? (
          <p data-user-content className="mt-2 rounded-lg bg-surface-alt p-3 text-ink">
            {quote.closingMessage}
          </p>
        ) : null}
      </div>
    );
  return null;
}

function RequestedLines({ quote, waiting }: { quote: QuoteDetail; waiting: boolean }) {
  const t = useTranslations('quote');
  return (
    <section className={card}>
      <h2 className="font-heading text-lg font-extrabold text-ink">{t('requested')}</h2>
      <ul className="mt-4 divide-y divide-line text-sm">
        {quote.lineItems.map((l) => (
          <li key={l.lineNo} className="flex justify-between gap-3 py-2.5">
            <span className="min-w-0 font-bold text-ink">{l.title}</span>
            <span className="shrink-0 font-bold text-ink tabular-nums">× {l.qty}</span>
          </li>
        ))}
      </ul>
      {waiting ? (
        <p className="mt-4 rounded-lg bg-surface-alt p-3 text-sm text-muted">{t('waiting')}</p>
      ) : null}
    </section>
  );
}

function OfferCard({
  quote,
  offer,
  onChanged,
  onPay,
}: {
  quote: QuoteDetail;
  offer: QuoteOffer;
  onChanged: () => Promise<void>;
  onPay: OnPay;
}) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const [problem, setProblem] = useState<QuoteMessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [method, setMethod] = useState<'cod' | 'online'>('cod');
  const declineButton = useRef<HTMLButtonElement>(null);
  // One key per offer version and method: a retry after a network error never places a second order.
  const keys = useRef(new Map<string, string>());
  const unitOf = (lineNo: number) => offer.lines.find((x) => x.lineNo === lineNo)?.unitPaise ?? 0;
  const listTotal = quote.listTotalPaise;
  const saving = listTotal === null ? 0 : listTotal + offer.deliveryPaise - offer.totalPaise;
  const canAccept = quote.status === 'offered' && !offer.expired;

  async function accept() {
    const slot = `${String(offer.version)}:${method}`;
    const key = keys.current.get(slot) ?? newQuoteKey();
    keys.current.set(slot, key);
    setBusy(true);
    setProblem(null);
    const { acceptQuote } = await import('@/lib/quote-api');
    const res = await acceptQuote(locale, quote.code, offer.version, key, method);
    if (res.ok) {
      track('click', { id: `quote_accepted_${method}`, path: window.location.pathname });
      await onChanged();
      // Online: the order exists and is held; Razorpay opens now (and "Pay now" stays on the accepted card).
      if (res.data.paymentMethod === 'online')
        await onPay(res.data.razorpay ?? null, res.data.orderCode, {
          name: quote.address.contactName,
          phone: quote.address.contactPhone,
        });
      setBusy(false);
      return;
    }
    setBusy(false);
    const k = quoteErrorKey(res.code);
    // Too large for cash: the way forward is already on the screen, so select it.
    if (k === 'api_err_codCap') setMethod('online');
    setProblem(k);
    track('click', { id: `quote_accept_failed_${k}`, path: window.location.pathname });
    // A replaced, expired or closed offer: show the latest state.
    if (k === 'stale' || k === 'expired' || k === 'api_err_closed') await onChanged();
  }

  return (
    <section
      aria-labelledby="offer-title"
      className="overflow-hidden rounded-card border border-accent-button/40 bg-surface shadow-card-hover"
    >
      <div className="blueprint px-6 py-4 text-white">
        <h2 id="offer-title" className="font-heading text-lg font-extrabold">
          {t('offerTitle', { version: offer.version })}
        </h2>
        <p className="mt-0.5 text-xs text-white/80">
          {t('validUntil', { date: formatDate(offer.validUntil, locale) })}
        </p>
      </div>
      <div className="p-6">
        <ul className="divide-y divide-line text-sm">
          {quote.lineItems.map((l) => {
            const unit = unitOf(l.lineNo);
            return (
              <li key={l.lineNo} className="grid grid-cols-[1fr_auto] gap-x-3 py-2.5">
                <span className="min-w-0 font-bold text-ink">
                  {l.title} <span className="font-normal text-muted">× {l.qty}</span>
                </span>
                <span className="font-bold text-ink tabular-nums">{formatPrice(unit * l.qty)}</span>
                <span className="text-xs text-muted">
                  {t('each', { price: formatPrice(unit) })}
                  {l.listUnitPaise !== null && unit < l.listUnitPaise ? (
                    <span className="ml-2 line-through">
                      {t('list', { price: formatPrice(l.listUnitPaise) })}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        <dl className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t('delivery')}</dt>
            <dd className="font-bold text-ink">
              {offer.deliveryPaise === 0 ? t('free') : formatPrice(offer.deliveryPaise)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="font-bold text-ink">{t('total')}</dt>
            <dd className="font-heading text-2xl font-extrabold text-ink">{formatPrice(offer.totalPaise)}</dd>
          </div>
          {saving > 0 ? (
            <p className="text-right text-xs font-bold text-success">
              {t('saving', { price: formatPrice(saving) })}
            </p>
          ) : null}
        </dl>
        {offer.terms ? (
          <p data-user-content className="mt-3 rounded-lg bg-surface-alt p-3 text-sm text-ink">
            {offer.terms}
          </p>
        ) : null}
        {canAccept ? (
          <fieldset className="mt-4">
            <legend className="text-sm font-bold text-ink">{t('api_payMethod')}</legend>
            <div className="mt-1 space-y-1">
              <label className="flex min-h-11 items-start gap-3 py-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name="quote-pay-method"
                  value="cod"
                  checked={method === 'cod'}
                  onChange={() => {
                    setMethod('cod');
                  }}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent-button)]"
                />
                <span>
                  <span className="font-bold">{t('api_payCod')}</span>
                  <span className="block text-xs text-muted">{t('api_cod')}</span>
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3 py-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name="quote-pay-method"
                  value="online"
                  checked={method === 'online'}
                  onChange={() => {
                    setMethod('online');
                  }}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent-button)]"
                />
                <span>
                  <span className="font-bold">{t('api_payOnline')}</span>
                  <span className="block text-xs text-muted">{t('api_payOnlineNote')}</span>
                </span>
              </label>
            </div>
          </fieldset>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
            {t(problem)}
          </p>
        ) : null}
        {offer.expired && quote.status === 'offered' && problem !== 'expired' ? (
          <p className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">{t('expired')}</p>
        ) : null}

        {quote.status === 'offered' && !closing ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canAccept ? (
              <button
                type="button"
                onClick={() => void accept()}
                disabled={busy}
                className="press inline-flex min-h-12 flex-1 items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
              >
                {busy
                  ? method === 'online'
                    ? t('api_paying')
                    : t('api_accepting')
                  : method === 'online'
                    ? t('api_acceptPay')
                    : t('accept')}
              </button>
            ) : null}
            <button
              ref={declineButton}
              type="button"
              onClick={() => {
                setClosing(true);
              }}
              className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-muted underline-offset-4 hover:underline"
            >
              {t('decline')}
            </button>
          </div>
        ) : null}
        {closing ? (
          <CloseQuote
            code={quote.code}
            onChanged={onChanged}
            onCancel={() => {
              setClosing(false);
              // Focus returns to the button that opened the panel once it is back on screen.
              window.setTimeout(() => declineButton.current?.focus(), 0);
            }}
            inline
          />
        ) : null}
      </div>
    </section>
  );
}

/** "Close quote" with a reason code (one quiet action; the reasons open only when asked). */
function CloseQuote({
  code,
  onChanged,
  onCancel,
  inline = false,
}: {
  code: string;
  onChanged: () => Promise<void>;
  onCancel?: () => void;
  inline?: boolean;
}) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const [open, setOpen] = useState(inline);
  const [reason, setReason] = useState<QuoteDeclineReason | null>(null);
  const [problem, setProblem] = useState<QuoteMessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // Cancel and Escape close the panel; focus goes back to the button that opened it.
  function close() {
    setOpen(false);
    onCancel?.();
    window.setTimeout(() => trigger.current?.focus(), 0);
  }

  if (!open)
    return (
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-muted underline-offset-4 hover:underline"
      >
        {t('decline')}
      </button>
    );

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    // The reason is optional (dark-pattern audit 2026-11-15, "forced action"): none given is recorded as "other".
    const chosen: QuoteDeclineReason = reason ?? 'other';
    setBusy(true);
    const { declineQuote } = await import('@/lib/quote-api');
    const res = await declineQuote(locale, code, chosen);
    setBusy(false);
    if (res.ok) {
      track('click', { id: `quote_declined_${chosen}`, path: window.location.pathname });
      await onChanged();
    } else setProblem(quoteErrorKey(res.code));
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
      className={inline ? 'mt-5 space-y-3' : `${card} space-y-3`}
    >
      <fieldset>
        <legend className="text-sm font-bold text-ink">{t('api_declineTitle')}</legend>
        <div className="mt-2 space-y-1">
          {QUOTE_DECLINE_REASONS.map((r) => (
            <label key={r} className="flex min-h-11 items-center gap-3 text-sm text-ink">
              <input
                type="radio"
                name="quote-close-reason"
                value={r}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {t(`api_reason_${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {problem ? (
        <p role="alert" className="text-sm font-bold text-warning">
          {t(problem)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-50"
        >
          {t('decline')}
        </button>
        <button
          type="button"
          onClick={close}
          className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-muted underline-offset-4 hover:underline"
        >
          {t('api_keepOpen')}
        </button>
      </div>
    </form>
  );
}

function Chat({
  quote,
  open,
  onChanged,
}: {
  quote: QuoteDetail;
  open: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<QuoteMessageKey | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const count = quote.messages.length;

  useEffect(() => {
    if (count > 0) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [count]);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem(null);
    const { postQuoteMessage } = await import('@/lib/quote-api');
    const res = await postQuoteMessage(locale, quote.code, body);
    setBusy(false);
    if (res.ok) {
      track('click', { id: 'quote_message_sent', path: window.location.pathname });
      setDraft('');
      await onChanged();
    } else setProblem(quoteErrorKey(res.code));
  }

  return (
    <section
      aria-labelledby="chat-title"
      className="flex flex-col rounded-card border border-line-card bg-surface shadow-card nav:order-1"
    >
      <h2
        id="chat-title"
        className="border-b border-line px-6 py-4 font-heading text-lg font-extrabold text-ink"
      >
        {t('chat')}
      </h2>
      <ol aria-live="polite" className="max-h-[480px] min-h-48 space-y-3 overflow-y-auto px-4 py-5 tab:px-6">
        {count === 0 ? <li className="text-sm text-muted">{t('noMessages')}</li> : null}
        {quote.messages.map((m) => {
          const mine = m.from === 'customer';
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  mine ? 'rounded-br-md bg-accent-soft text-ink' : 'rounded-bl-md bg-surface-alt text-ink'
                }`}
              >
                <p className="text-[11px] font-extrabold text-muted">
                  {mine ? t('you') : t('team')} · {formatDate(m.at, locale)}
                </p>
                <p data-user-content className="mt-0.5 whitespace-pre-wrap">
                  {m.body}
                </p>
              </div>
            </li>
          );
        })}
        <li ref={end} aria-hidden="true" />
      </ol>
      {open ? (
        <form onSubmit={(e) => void onSubmit(e)} className="border-t border-line p-3 tab:p-4">
          {quote.status === 'offered' ? (
            <p id="quote-message-hint" className="mb-2 text-xs text-muted">
              {t('api_reopenHint')}
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="mb-2 text-sm font-bold text-warning">
              {t(problem)}
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <label htmlFor="quote-message" className="sr-only">
              {t('messageLabel')}
            </label>
            <textarea
              id="quote-message"
              rows={1}
              maxLength={1000}
              value={draft}
              placeholder={t('messagePlaceholder')}
              aria-describedby={quote.status === 'offered' ? 'quote-message-hint' : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="min-h-11 flex-1 resize-none rounded-input border border-input-border bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-muted"
            />
            <button
              type="submit"
              aria-label={t('send')}
              disabled={!draft.trim() || busy}
              className="press inline-flex size-11 shrink-0 items-center justify-center rounded-button bg-accent-button text-white hover:bg-accent-button-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send aria-hidden="true" className="size-4" />
            </button>
          </div>
        </form>
      ) : (
        <p className="border-t border-line px-6 py-4 text-sm text-muted">{t('closedChat')}</p>
      )}
    </section>
  );
}
