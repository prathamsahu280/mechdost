import { formatINR } from '@mechdost/shared/money';

/** Shelf price: ₹1,250 for whole rupees, ₹1,250.50 otherwise (money stays integer paise everywhere). */
export function formatPrice(paise: number): string {
  const full = formatINR(paise);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}

/** Whole-number discount percentage, or null when there is no MRP above the price. */
export function discountPercent(pricePaise: number, mrpPaise?: number): number | null {
  if (!mrpPaise || mrpPaise <= pricePaise) return null;
  return Math.round(((mrpPaise - pricePaise) * 100) / mrpPaise);
}

/** Date and time in IST for an end time, e.g. "1 Nov 2026, 11:59 pm" (the caller says "IST" in its own words). */
export function formatDateTimeIst(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/** Date in IST for display, e.g. "1 Nov 2026". */
export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}
