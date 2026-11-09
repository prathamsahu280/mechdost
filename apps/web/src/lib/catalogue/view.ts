import type { CataloguePhoto } from '@mechdost/shared/catalogue';
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
  /** 2W / 4W / EV label; `null` until fitment data exists (the card says "Check fitment"). */
  fit: string | null;
  price: { pricePaise: number; mrpPaise: number | null } | null;
  availability: 'in_stock' | 'low_stock' | 'on_request';
  leadDays: number | null;
  highlights: string[];
  rating: { avg: number; count: number } | null;
  popular: boolean;
  photo: CataloguePhoto | null;
}

export interface ProductView extends CardView {
  description: string | null;
  specRows: { label: string; value: string }[];
  /** The shop that sells at the shown price (E-Commerce Rules); `null` in demo data. */
  seller: string | null;
  countryOfOrigin: string | null;
  partNumbers: { kind: string; value: string }[];
  shippingPaise: number | null;
}
