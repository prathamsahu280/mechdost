import { Briefcase, Car, House, ShoppingBag, Siren, Wrench, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NavKey } from '@/lib/nav';

const ICONS: Record<NavKey, LucideIcon> = {
  home: House,
  shop: ShoppingBag,
  workshops: Wrench,
  vehicles: Car,
  business: Briefcase,
  roadside: Siren,
};

/**
 * The line icon of a primary destination (v4, decision 2026-11-23: lucide, no emoji in the header, footer or dock).
 * Server-only: the layout renders these and passes them to the client islands as props, so no icon code ships in
 * the browser bundle.
 */
export function navIcon(key: NavKey, size: number): ReactNode {
  const Icon = ICONS[key];
  return <Icon aria-hidden="true" size={size} strokeWidth={1.9} />;
}
