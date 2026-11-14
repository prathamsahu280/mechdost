/**
 * Demo bulk quotes (spec 19) in the browser store, split from `store.ts` so pages without quotes do not load this
 * code (JS budget, spec 16). Same storage and listeners as the rest of the demo store (`storeCore`).
 */
import { publicCode } from '@mechdost/shared/ids';
import { useSyncExternalStore } from 'react';
import { storeCore, type DemoOrder, type DemoQuote, type QuoteMessage, type QuoteOffer } from './store';

const { keys: KEYS, read, write, subscribe, serverSnapshot, isRecord, ordersSnapshot, newId } = storeCore;

const isQuote = (v: unknown): v is DemoQuote =>
  isRecord(v) && typeof v.code === 'string' && Array.isArray(v.messages) && Array.isArray(v.offers);
const quotesSnapshot = () => read(KEYS.quotes, isQuote);

export function useQuotes(): readonly DemoQuote[] {
  return useSyncExternalStore(subscribe, quotesSnapshot, serverSnapshot);
}

export function createQuote(input: {
  customer: DemoQuote['customer'];
  pincode: string;
  address?: string;
  lines: DemoQuote['lines'];
  note: string;
}): DemoQuote {
  const now = new Date().toISOString();
  const quote: DemoQuote = {
    code: publicCode('QT', 'RPR'),
    createdAt: now,
    customer: input.customer,
    pincode: input.pincode,
    ...(input.address ? { address: input.address } : {}),
    lines: input.lines,
    status: 'open',
    messages: input.note ? [{ id: newId(), from: 'customer', text: input.note, at: now }] : [],
    offers: [],
    orderCode: null,
  };
  write(KEYS.quotes, [quote, ...quotesSnapshot()].slice(0, 50));
  return quote;
}

function updateQuote(code: string, change: (q: DemoQuote) => DemoQuote) {
  write(
    KEYS.quotes,
    quotesSnapshot().map((q) => (q.code === code ? change(q) : q)),
  );
}

export function postQuoteMessage(code: string, from: QuoteMessage['from'], text: string) {
  const clean = text.trim().slice(0, 1000);
  if (!clean) return;
  updateQuote(code, (q) =>
    q.status === 'accepted' || q.status === 'declined'
      ? q
      : { ...q, messages: [...q.messages, { id: newId(), from, text: clean, at: new Date().toISOString() }] },
  );
}

/** Admin sets the final price. A new offer supersedes the previous one (only the latest can be accepted). */
export function sendOffer(
  code: string,
  offer: { lines: QuoteOffer['lines']; deliveryPaise: number; validDays: number; note: string },
) {
  updateQuote(code, (q) => {
    if (q.status === 'accepted' || q.status === 'declined') return q;
    const subtotal = offer.lines.reduce((sum, l) => {
      const qty = q.lines.find((x) => x.slug === l.slug)?.qty ?? 0;
      return sum + l.unitPaise * qty;
    }, 0);
    const now = new Date();
    const next: QuoteOffer = {
      version: (q.offers.at(-1)?.version ?? 0) + 1,
      lines: offer.lines,
      deliveryPaise: offer.deliveryPaise,
      totalPaise: subtotal + offer.deliveryPaise,
      validUntil: new Date(now.getTime() + offer.validDays * 86_400_000).toISOString(),
      note: offer.note.trim().slice(0, 500),
      at: now.toISOString(),
    };
    return { ...q, status: 'offered', offers: [...q.offers, next] };
  });
}

export type AcceptResult =
  | { ok: true; orderCode: string }
  | { ok: false; reason: 'stale' | 'expired' | 'closed' | 'address' | 'blocked' };

/** Where the accepted quote is delivered; the same rules as checkout apply (review B10). */
export interface QuoteDelivery {
  /** From `customerAllowed()` for the account (passed in: the store stays free of the blocks module). */
  allowed: { order: boolean; cod: boolean };
  address: { line1: string; landmark: string; pincode: string } | null;
}

/**
 * Accept exactly the offer version the customer saw. A superseded or expired offer is refused, and a quote can
 * create only one order (mirrors spec 19's conditional UPDATE + UNIQUE orders.quote_offer_id).
 */
export function acceptOffer(code: string, version: number, delivery: QuoteDelivery): AcceptResult {
  const quote = quotesSnapshot().find((q) => q.code === code);
  if (quote?.status !== 'offered') return { ok: false, reason: 'closed' };
  const latest = quote.offers.at(-1);
  if (latest?.version !== version) return { ok: false, reason: 'stale' };
  if (new Date(latest.validUntil).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  // Checkout rules (checkout-form.tsx): a serviceable Raipur address, and no order/COD block on the account.
  const address =
    delivery.address ??
    (quote.address ? { line1: quote.address, landmark: '', pincode: quote.pincode } : null);
  if (!address || address.line1.trim().length < 10 || !/^4920\d{2}$/.test(address.pincode))
    return { ok: false, reason: 'address' };
  if (!delivery.allowed.order || !delivery.allowed.cod) return { ok: false, reason: 'blocked' };

  const lines = quote.lines.map((l) => ({
    slug: l.slug,
    name: l.name,
    brand: l.brand,
    qty: l.qty,
    unitPaise: latest.lines.find((x) => x.slug === l.slug)?.unitPaise ?? l.listPaise,
  }));
  const subtotalPaise = lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
  const order: DemoOrder = {
    code: publicCode('MD', 'RPR'),
    createdAt: new Date().toISOString(),
    lines,
    subtotalPaise,
    deliveryPaise: latest.deliveryPaise,
    totalPaise: subtotalPaise + latest.deliveryPaise,
    customer: {
      name: quote.customer.name,
      phone: quote.customer.phone,
      address: [address.line1.trim(), address.landmark.trim()].filter(Boolean).join(', '),
      pincode: address.pincode,
    },
    payment: 'cod',
    stage: 1, // the normal order workflow continues: admin routes it to a shop
  };
  write(KEYS.orders, [order, ...ordersSnapshot()].slice(0, 50));
  updateQuote(code, (q) => ({ ...q, status: 'accepted', orderCode: order.code }));
  return { ok: true, orderCode: order.code };
}

export function declineQuote(code: string) {
  updateQuote(code, (q) => (q.status === 'accepted' ? q : { ...q, status: 'declined' }));
}
