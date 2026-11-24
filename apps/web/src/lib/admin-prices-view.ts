import { checkAdminPrice, resolveCustomerPrice, type AdminPriceIssue } from '@mechdost/shared/admin-prices';
import { parseRupees, type RupeeError } from './money-input';

/**
 * View helpers for Admin → Catalogue → Prices (design `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md`,
 * Q26). The board comes from `GET /v1/admin/prices/products/{slug}`; the rules are the shared ones the API applies,
 * checked here first so staff see the problem next to the field before anything is sent.
 */
export interface PriceRef {
  pricePaise: number;
  version: number;
}

export interface BoardPin {
  pincode: string;
  override: PriceRef | null;
  nearestShopPaise: number | null;
  lowestShopPaise: number | null;
  highestShopPaise: number | null;
}

export interface BoardVariant {
  sku: string;
  /** Null = no MRP yet: the price form is replaced by a hint (design 2026-11-22). */
  mrpPaise: number | null;
  city: PriceRef | null;
  pins: BoardPin[];
}

export interface PriceBoard {
  productSlug: string;
  cityCode: string;
  variants: BoardVariant[];
}

export type PriceSource = 'pin' | 'city' | 'shop' | 'none';
export type SuggestionKind = 'nearest' | 'lowest' | 'highest';

export interface PinView {
  /** What a customer at this PIN pays today; null = no shop can sell it there. */
  customerPaise: number | null;
  source: PriceSource;
  /** Best case: the customer price less the lowest shop price there (the shop actually chosen may be paid more). */
  marginPaise: number | null;
  /** One-click prices from the shops that deliver there (user 2026-11-13: nearest + lowest + highest). */
  suggestions: { kind: SuggestionKind; paise: number }[];
}

export function pinView(pin: BoardPin, city: PriceRef | null): PinView {
  const customerPaise = resolveCustomerPrice({
    pinPaise: pin.override?.pricePaise ?? null,
    cityPaise: pin.lowestShopPaise === null ? null : (city?.pricePaise ?? null),
    shopPaise: pin.nearestShopPaise,
  });
  const source: PriceSource =
    customerPaise === null
      ? 'none'
      : pin.override
        ? 'pin'
        : city && pin.lowestShopPaise !== null
          ? 'city'
          : 'shop';
  const seen = new Set<number>();
  const suggestions: PinView['suggestions'] = [];
  for (const [kind, paise] of [
    ['nearest', pin.nearestShopPaise],
    ['lowest', pin.lowestShopPaise],
    ['highest', pin.highestShopPaise],
  ] as const) {
    if (paise === null || seen.has(paise)) continue;
    seen.add(paise);
    suggestions.push({ kind, paise });
  }
  return {
    customerPaise,
    source,
    marginPaise:
      customerPaise === null || pin.lowestShopPaise === null ? null : customerPaise - pin.lowestShopPaise,
    suggestions,
  };
}

/** The lowest city price the API accepts: the lowest shop price across the city's PINs (null = no shop). */
export function cityFloorPaise(variant: BoardVariant): number | null {
  const lows = variant.pins.map((p) => p.lowestShopPaise).filter((p): p is number => p !== null);
  return lows.length > 0 ? Math.min(...lows) : null;
}

export type PriceInputIssue = RupeeError | AdminPriceIssue;

/** A typed rupee amount checked against the shared admin price rules. */
export function readPriceInput(
  raw: string,
  rules: { mrpPaise: number; lowestShopPaise: number | null },
): { ok: true; paise: number } | { ok: false; issue: PriceInputIssue } {
  const parsed = parseRupees(raw);
  if (!parsed.ok) return { ok: false, issue: parsed.error };
  const issue = checkAdminPrice({ pricePaise: parsed.paise, ...rules });
  return issue ? { ok: false, issue } : { ok: true, paise: parsed.paise };
}

/** Codes the screen has words for (`portal.cat_err_*`); anything else gets the generic message. */
const KNOWN = new Set([
  'MRP_EXCEEDED',
  'MRP_MISSING',
  'STALE_GROUP',
  'REASON_CODE',
  'BULK_SIZE',
  'MRP_INVALID',
  'BELOW_PRICE',
  'BELOW_SHOP_PRICE',
  'NO_SHOP',
  'BAD_PRICE',
  'PIN_CITY',
  'ATTRIBUTES',
  'NAME_REQUIRED',
  'TEXT_TOO_LONG',
  'HIGHLIGHTS',
  'HIGHLIGHTS_HI_ALIGNED',
  'EMPTY_PATCH',
  'NET_QUANTITY',
  'VEHICLE_TYPES',
  'FORBIDDEN',
  'STAFF_2FA_REQUIRED',
  'VERIFICATION_REQUIRED',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'SKU_TAKEN',
  'SKU_INVALID',
  'MRP_BELOW_PRICE',
  'LAST_VARIANT',
  'VARIANT_LABEL',
  'VARIANT_OPTION',
  'BARCODE',
  'empty',
  'format',
  'zero',
]);

export function errorKey(code: string): string {
  if (code === 'STALE_PRODUCT' || code === 'STALE_PRICE' || code === 'STALE_VARIANT' || code === 'CONFLICT')
    return 'cat_err_STALE';
  return KNOWN.has(code) ? `cat_err_${code}` : 'cat_err_generic';
}
