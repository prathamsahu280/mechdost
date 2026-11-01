'use client';

import { BadgeCheck, Send } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  acceptOffer,
  declineQuote,
  postQuoteMessage,
  sendOffer,
  useHydrated,
  useQuotes,
  type DemoQuote,
  type QuoteOffer,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { productNameFor } from '@/demo/i18n/localize';

const STATUS_STYLE: Record<DemoQuote['status'], string> = {
  open: 'bg-warning-bg text-warning',
  offered: 'bg-accent-soft text-accent-soft-text',
  accepted: 'bg-success-bg text-success',
  declined: 'bg-pill text-muted',
};

/**
 * Bulk quote thread (spec 19): the active offer pinned on top with "Accept offer" as the single primary action,
 * the chat with MechDost admin below. Demo controls stand in for the admin console's reply + offer builder.
 */
export function QuoteThread({ code }: { code: string }) {
  const t = useTranslations('quote');
  const demo = useTranslations('demo');
  const locale = useLocale();
  const hydrated = useHydrated();
  const isNew = useSearchParams().get('new') === '1';
  const quote = useQuotes().find((q) => q.code === code);
  const base = locale === 'hi' ? '/hi' : '';

  if (!hydrated) {
    return <div className="skeleton h-80 rounded-card" aria-hidden="true" />;
  }
  if (!quote) {
    return (
      <div className="rounded-card border border-line-card bg-surface p-8 shadow-card">
        <p className="text-muted">{t('notFound')}</p>
        <Link
          href={`${base}/shop`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('back')}
        </Link>
      </div>
    );
  }

  const offer = quote.offers.at(-1);
  const closed = quote.status === 'accepted' || quote.status === 'declined';

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span className={`rounded-pill px-3 py-1 text-xs font-extrabold ${STATUS_STYLE[quote.status]}`}>
          {t(`status_${quote.status}`)}
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
            <section className="rounded-card border border-line-card bg-surface p-6 shadow-card">
              <h2 className="font-heading text-lg font-extrabold text-success">{t('acceptedTitle')}</h2>
              <p className="mt-2 text-sm text-ink">{t('acceptedBody', { code: quote.orderCode })}</p>
              <Link
                href={`${base}/orders/${quote.orderCode}`}
                className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
              >
                {t('viewOrder')}
              </Link>
            </section>
          ) : null}
          {quote.status === 'declined' ? (
            <p className="rounded-card border border-line-card bg-surface p-6 text-sm text-muted shadow-card">
              {t('declinedBody')}
            </p>
          ) : null}
          {offer ? (
            <OfferCard quote={quote} offer={offer} />
          ) : (
            <RequestedLines quote={quote} waiting={!closed} />
          )}
        </div>

        <Chat quote={quote} closed={closed} />
      </div>

      {!closed ? (
        <details className="rounded-lg border border-dashed border-line p-3 text-sm">
          <summary className="cursor-pointer font-bold text-muted">{demo('controls')}</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                postQuoteMessage(quote.code, 'admin', t('demoReplyText'));
              }}
              className="press inline-flex min-h-10 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
            >
              {t('demoReply')}
            </button>
            <button
              type="button"
              onClick={() => {
                sendOffer(quote.code, {
                  lines: quote.lines.map((l) => ({
                    slug: l.slug,
                    unitPaise: Math.round((l.listPaise * 0.92) / 100) * 100,
                  })),
                  deliveryPaise: 0,
                  validDays: 3,
                  note: '',
                });
              }}
              className="press inline-flex min-h-10 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
            >
              {t('demoOffer')}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">{demo('note')}</p>
        </details>
      ) : null}
    </div>
  );
}

function RequestedLines({ quote, waiting }: { quote: DemoQuote; waiting: boolean }) {
  const t = useTranslations('quote');
  const locale = useLocale();
  return (
    <section className="rounded-card border border-line-card bg-surface p-6 shadow-card">
      <h2 className="font-heading text-lg font-extrabold text-ink">{t('requested')}</h2>
      <ul className="mt-4 divide-y divide-line text-sm">
        {quote.lines.map((l) => (
          <li key={l.slug} className="flex justify-between gap-3 py-2.5">
            <span className="min-w-0 text-ink">
              <span className="font-bold">{l.brand}</span> {productNameFor(l.slug, l.name, locale)}
            </span>
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

function OfferCard({ quote, offer }: { quote: DemoQuote; offer: QuoteOffer }) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const [problem, setProblem] = useState<'stale' | 'expired' | null>(null);
  // The version shown when the customer started reading: accepting checks it is still the latest.
  const [seenVersion, setSeenVersion] = useState(offer.version);
  const expired = new Date(offer.validUntil).getTime() < Date.now();
  const listTotal = quote.lines.reduce((n, l) => n + l.listPaise * l.qty, 0);
  const saving = listTotal + offer.deliveryPaise - offer.totalPaise;
  const canAccept = quote.status === 'offered' && !expired;

  function accept() {
    if (seenVersion !== offer.version) {
      setProblem('stale');
      setSeenVersion(offer.version);
      return;
    }
    const result = acceptOffer(quote.code, offer.version);
    if (result.ok) {
      track('click', { id: 'quote_accepted', path: window.location.pathname });
      setProblem(null);
    } else if (result.reason === 'stale') {
      setProblem('stale');
      setSeenVersion(offer.version);
    } else if (result.reason === 'expired') {
      setProblem('expired');
    }
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
          {quote.lines.map((l) => {
            const unit = offer.lines.find((x) => x.slug === l.slug)?.unitPaise ?? l.listPaise;
            return (
              <li key={l.slug} className="grid grid-cols-[1fr_auto] gap-x-3 py-2.5">
                <span className="min-w-0 font-bold text-ink">
                  {productNameFor(l.slug, l.name, locale)}{' '}
                  <span className="font-normal text-muted">× {l.qty}</span>
                </span>
                <span className="font-bold text-ink tabular-nums">{formatPrice(unit * l.qty)}</span>
                <span className="text-xs text-muted">
                  {t('each', { price: formatPrice(unit) })}
                  {unit < l.listPaise ? (
                    <span className="ml-2 line-through">
                      {t('list', { price: formatPrice(l.listPaise) })}
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
        {offer.note ? (
          <p data-user-content className="mt-3 rounded-lg bg-surface-alt p-3 text-sm text-ink">
            {offer.note}
          </p>
        ) : null}

        {problem === 'stale' ? (
          <p role="alert" className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
            {t('stale')}
          </p>
        ) : null}
        {expired || problem === 'expired' ? (
          <p className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">{t('expired')}</p>
        ) : null}

        {canAccept ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={accept}
              className="press inline-flex min-h-12 flex-1 items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover"
            >
              {t('accept')}
            </button>
            <button
              type="button"
              onClick={() => {
                declineQuote(quote.code);
              }}
              className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-muted underline-offset-4 hover:underline"
            >
              {t('decline')}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Chat({ quote, closed }: { quote: DemoQuote; closed: boolean }) {
  const t = useTranslations('quote');
  const locale = useLocale();
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLLIElement>(null);
  const count = quote.messages.length;

  useEffect(() => {
    if (count > 0) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [count]);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.trim()) return;
    postQuoteMessage(quote.code, 'customer', draft);
    track('click', { id: 'quote_message_sent', path: window.location.pathname });
    setDraft('');
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
        {quote.messages.length === 0 ? <li className="text-sm text-muted">{t('noMessages')}</li> : null}
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
                  {m.text}
                </p>
              </div>
            </li>
          );
        })}
        <li ref={end} aria-hidden="true" />
      </ol>
      {closed ? (
        <p className="border-t border-line px-6 py-4 text-sm text-muted">{t('closedChat')}</p>
      ) : (
        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line p-3 tab:p-4">
          <label htmlFor="quote-message" className="sr-only">
            {t('messageLabel')}
          </label>
          <textarea
            id="quote-message"
            rows={1}
            maxLength={1000}
            value={draft}
            placeholder={t('messagePlaceholder')}
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
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-button bg-accent-button text-white hover:bg-accent-button-hover"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </form>
      )}
    </section>
  );
}
