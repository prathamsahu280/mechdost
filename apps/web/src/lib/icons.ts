import {
  BatteryFull,
  CircleDot,
  Cog,
  Disc3,
  Droplets,
  Funnel,
  Globe,
  Hammer,
  House,
  LayoutGrid,
  Moon,
  Package,
  PlugZap,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Sun,
  UserRound,
  Wrench,
  Car,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryKey } from '@/demo/catalogue';
import type { PrimaryNavKey } from './nav';

/**
 * Icon registry (decision 2026-11-01: emoji removed site-wide in favour of Lucide icons — user: "remove emojis,
 * use icons"). Icons are decorative: render them with `aria-hidden="true"` beside a real text label, so they need
 * no translation. Sizes: nav/tab bar 18–20px, inline chips and meta 16px; stroke 2 (1.75 on large tiles).
 * Feature-specific icons (account sections, admin sections, policy points) live next to their lists but must also
 * come from lucide-react — never emoji.
 */
export const NAV_ICONS: Record<PrimaryNavKey, LucideIcon> = {
  home: House,
  shop: ShoppingBag,
  workshops: Wrench,
  vehicles: Car,
};

export const CATEGORY_ICONS: Record<CategoryKey, LucideIcon> = {
  tyres: Disc3,
  lubricants: Droplets,
  batteries: BatteryFull,
  bearings: CircleDot,
  filters: Funnel,
  spareParts: Cog,
  accessories: Sparkles,
  workshopTools: Hammer,
  evEssentials: PlugZap,
};

export const UI_ICONS = {
  cart: ShoppingCart,
  account: UserRound,
  language: Globe,
  dark: Moon,
  light: Sun,
  orders: Package,
  workshops: Wrench,
  all: LayoutGrid,
} as const satisfies Record<string, LucideIcon>;
