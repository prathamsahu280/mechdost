import {
  BatteryFull,
  CircleDot,
  Cog,
  Disc3,
  Droplets,
  Filter,
  PlugZap,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryKey } from '@/demo/catalogue';

export const CATEGORY_ICONS: Record<CategoryKey, LucideIcon> = {
  tyres: Disc3,
  lubricants: Droplets,
  batteries: BatteryFull,
  bearings: CircleDot,
  filters: Filter,
  spareParts: Cog,
  accessories: Sparkles,
  workshopTools: Wrench,
  evEssentials: PlugZap,
};

/**
 * Product artwork until real photos arrive with the catalogue (next/image + Storage, spec 02): a calm category
 * illustration on the accent tint, fixed aspect ratio so cards never shift.
 */
export function ProductVisual({
  category,
  brand,
  size = 'card',
}: {
  category: CategoryKey;
  brand: string;
  size?: 'card' | 'hero';
}) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <div
      aria-hidden="true"
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-accent-soft via-surface to-pill ${
        size === 'hero' ? 'aspect-square rounded-card' : 'aspect-[4/3] rounded-tile'
      }`}
    >
      <Icon
        className={`text-accent transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:scale-110 ${
          size === 'hero' ? 'size-32' : 'size-16'
        }`}
        strokeWidth={1.25}
      />
      <span className="eyebrow absolute bottom-3 left-3 rounded-md bg-surface/85 px-2 py-1 text-[9px] text-ink">
        {brand}
      </span>
    </div>
  );
}
