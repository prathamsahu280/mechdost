import type { VehicleType } from '@mechdost/shared/vehicles';
import type { CataloguePhoto } from '@mechdost/shared/catalogue';
import type { AttrValue, NetQuantity } from '@mechdost/shared/product-attributes';
import type { CategoryKey } from '@/demo/catalogue';

/**
 * What the catalogue screens render (plan 2026-11-10): one shape for both data sources (demo data and the API),
 * already localised. Optional facts are `null` when the source does not know them, and the screens leave them
 * out instead of guessing (no price without a buyable offer, no fit without the vehicle master).
 */
export interface CardView {
  slug: string;
  sku: string | null;
  brand: string;
  name: string;
  /** `key` picks the artwork and the translated name; `name` is the source's localised name when it has one. */
  category: { key: CategoryKey | null; slug: string; name: string | null };
  spec: string | null;
  compatibility: string | null;
  /** Vehicle types the product is for, 2W/3W/4W order; empty = "Fitment not listed" (decision 2026-11-12). */
  vehicleTypes: readonly VehicleType[];
  price: { pricePaise: number; mrpPaise: number | null } | null;
  /** Lowest pack MRP, shown as "MRP ₹x" when there is no price (no shop offer yet); never a price, never sellable. */
  mrpFrom: { paise: number; varies: boolean } | null;
  /** Net quantity of the pack the price is for (unit price, design 2026-11-13); null when not listed. */
  pack: NetQuantity | null;
  availability: 'in_stock' | 'low_stock' | 'on_request';
  leadDays: number | null;
  /** Several sizes: the card says "from ₹X · N sizes" (X = lowest offered price); null for a single size. */
  sizes: { count: number; fromPaise: number | null } | null;
  /** The sizes a search named (at most 3): the card says "Size … available" and opens on the first. Absent = none. */
  matchedSizes?: readonly { label: string; sku: string }[];
  highlights: string[];
  rating: { avg: number; count: number } | null;
  popular: boolean;
  photo: CataloguePhoto | null;
}

/**
 * One size of a product (user 2026-11-24: sizes are variants, "like 500 ml and 1 L"). `priceOnRequest` = no MRP
 * (never shown a price, never added to the cart); `inStock` = a verified shop offers it now (else the size is
 * shown as unavailable but stays selectable, so the customer sees why).
 */
export interface VariantView {
  sku: string;
  label: string;
  pricePaise: number | null;
  mrpPaise: number | null;
  priceOnRequest: boolean;
  inStock: boolean;
  leadDays: number | null;
  shippingPaise: number | null;
  pack: NetQuantity | null;
}

export interface ProductView extends CardView {
  /** Every active size, in the order shown; one entry = a single-size product (no picker). */
  variants: readonly VariantView[];
  /** The size the page opens on (lowest offered price, else the first); `sku`, `price` and `availability` are its. */
  defaultSku: string | null;
  /** All approved photos in order (the first is `photo`); absent in demo data. */
  photos?: readonly CataloguePhoto[];
  description: string | null;
  /** The shop that sells at the shown price (E-Commerce Rules); `null` in demo data. */
  seller: string | null;
  countryOfOrigin: string | null;
  partNumbers: { kind: string; value: string }[];
  /**
   * The "Part reference" row: the SKU of a single-pack product, else the first real (OE or maker) part number,
   * else null. A multi-pack product's SKU names one pack size ("…-1-L"), which would read as a part number.
   */
  partReference: string | null;
  shippingPaise: number | null;
  /** Category slug whose attribute definitions apply; null = shared compare rows only. */
  attributeSet: string | null;
  /** Typed attributes (only valid, known values) for comparison. */
  attributes: Record<string, AttrValue>;
  warranty: string | null;
}
