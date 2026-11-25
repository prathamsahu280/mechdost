import type { NetQuantity } from '@mechdost/shared/product-attributes';
import type { VehicleType } from '@mechdost/shared/vehicles';
import type { BatteryPlan } from '../battery-import';
import type { LubeCategory } from './kinds';
import type { OilProperties } from './text';

/** One pack of a lubricant as the maker lists it: the shop label, the net quantity, the MRP (null = price on request). */
export interface LubePack {
  label: string;
  net: NetQuantity;
  mrpPaise: number | null;
  /** The text as the source wrote it ("1 Litre", "Rs. 354/-"). */
  sourceText: string;
}

export interface LubeText {
  en: string;
  hi: string;
}

/** Why a product with no usable picture is planned as a draft (user ruling 2026-11-25: a generic photo is never used). */
export type DraftReason =
  'generic_photo_only' | 'photo_of_another_product' | 'no_photo_on_site' | 'no_photo_file';

/** One product (one oil, one grade) read from a maker's CSV, before it is planned. */
export interface LubeItem {
  /** 1-based rows of the products CSV this item came from (more than one when duplicates were merged). */
  sourceRows: number[];
  listedRange: string;
  listedCategory: string;
  name: string;
  nameHi: string;
  category: LubeCategory;
  vehicleTypes: VehicleType[];
  /** Overrides of the category's words and HSN (diesel exhaust fluid, chain spray). */
  typeEn?: string;
  typeHi?: string;
  hsn?: string;
  /** Display grade ("10W-30", "90", "NLGI 3") or null. */
  grade: string | null;
  /** Text of "Specifications met", cleaned. */
  specsMet: string;
  application: LubeText | null;
  shortDescription: LubeText | null;
  features: LubeText[];
  packs: LubePack[];
  /** Picture path relative to the source folder, or null when the page has none. */
  photoFile: string | null;
  draftReason: DraftReason | null;
  /** How many products the maker's site shows this picture on (1 = its own). */
  photoSharedBy: number;
  properties: OilProperties;
  sourceDocs: { productPage: string; dataSheetUrl: string; pictureUrl: string };
  /** Extra typed spec keys (`evRange`). */
  extraSpec: Record<string, unknown>;
  /** What was odd in the source and how it was handled. */
  checks: string[];
}

export type SkipReason =
  | 'industrial'
  | 'marine'
  | 'railroad'
  | 'stationary_gas_engine'
  | 'agri_spray'
  | 'leaflet'
  | 'not_automotive';

export interface SkippedRow {
  sourceRow: number;
  name: string;
  listedRange: string;
  listedCategory: string;
  reason: SkipReason;
  detail: string;
}

export interface LubeCheck {
  slug: string;
  name: string;
  note: string;
}

export interface LubePlan extends BatteryPlan {
  skipped: SkippedRow[];
  drafts: { slug: string; name: string; reason: DraftReason }[];
  checks: LubeCheck[];
  /** Packs with no MRP, for the report. */
  priceOnRequest: { slug: string; name: string; sku: string }[];
}
