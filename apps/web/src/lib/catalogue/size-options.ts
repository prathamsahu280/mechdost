import { unitPrice } from '@mechdost/shared/product-attributes';
import type { SizeOption } from '@/components/catalogue/size-buy-box';
import { discountPercent } from '@/lib/format';
import type { VariantView } from './view';

/** The translators and formatters the page hands in (the picker itself ships no i18n runtime). */
export interface SizeText {
  price: (paise: number) => string;
  mrp: (paise: number) => string;
  mrpOnly: (paise: number) => string;
  save: (percent: number) => string;
  unit: (per: 'litre' | 'kg' | 'piece' | 'metre', paise: number) => string;
  inStock: string;
  onRequest: string;
  outOfStock: string;
  delivery: (days: number) => string;
  askHref: (label: string) => string;
}

/**
 * Every size of a product as the picker shows it (user 2026-11-24). A size has a price only while a shop offers it;
 * a size with an MRP but no offer shows "MRP ₹x" and is marked out of stock; a size with no MRP is "price on
 * request" and shows no amount at all (spec 02).
 */
export function sizeOptions(variants: readonly VariantView[], text: SizeText): SizeOption[] {
  return variants.map((v) => {
    const hasPrice = v.pricePaise !== null && v.inStock;
    const off = hasPrice && v.mrpPaise !== null ? discountPercent(v.pricePaise ?? 0, v.mrpPaise) : null;
    const unit = hasPrice ? unitPrice(v.pricePaise ?? 0, v.pack) : null;
    return {
      sku: v.sku,
      label: v.label,
      inStock: v.inStock,
      priceOnRequest: v.priceOnRequest,
      priceText: hasPrice && v.pricePaise !== null ? text.price(v.pricePaise) : null,
      mrpText: hasPrice && v.mrpPaise !== null && off ? text.mrp(v.mrpPaise) : null,
      saveText: off ? text.save(off) : null,
      unitText: unit ? text.unit(unit.per, unit.paise) : null,
      mrpOnlyText: !hasPrice && v.mrpPaise !== null && v.mrpPaise > 0 ? text.mrpOnly(v.mrpPaise) : null,
      availabilityText: hasPrice ? text.inStock : v.priceOnRequest ? text.onRequest : text.outOfStock,
      deliveryText: hasPrice && v.leadDays !== null ? text.delivery(v.leadDays) : null,
      askHref: text.askHref(v.label),
    };
  });
}
