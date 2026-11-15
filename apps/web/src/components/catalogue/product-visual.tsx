import {
  BatteryFull,
  CircleDot,
  Cog,
  Disc3,
  Droplets,
  Filter,
  Package,
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
 * Product artwork until catalogue photos arrive (next/image + Storage, spec 02): a blueprint plate — navy panel,
 * engineering grid, the part drawn in light line work, brand stamped in the corner, part reference at the foot.
 * Fixed aspect ratio so cards never shift.
 */
export function ProductVisual({
  category,
  brand,
  sku,
  size = 'card',
}: {
  /** `null` when the source's category has no artwork (generic part icon). */
  category: CategoryKey | null;
  brand: string;
  sku?: string | null;
  size?: 'card' | 'hero';
}) {
  const Icon = category ? CATEGORY_ICONS[category] : Package;
  return (
    <div
      aria-hidden="true"
      className={`blueprint relative flex items-center justify-center overflow-hidden ${
        size === 'hero' ? 'aspect-square rounded-card' : 'aspect-[4/3] rounded-tile'
      }`}
    >
      <span className="absolute inset-[14%] rounded-full border border-dashed border-white/15" />
      <Icon
        className={`relative text-accent-pale transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:scale-105 ${
          size === 'hero' ? 'size-36' : 'size-16'
        }`}
        strokeWidth={1}
      />
      <span className="absolute top-3 left-3 rounded-md bg-white/12 px-2 py-1 text-[11px] font-extrabold tracking-wide text-white">
        {brand}
      </span>
      {sku ? (
        <span
          lang="en"
          className="absolute right-3 bottom-3 text-[10px] font-bold tracking-wider text-white/70"
        >
          {sku}
        </span>
      ) : null}
    </div>
  );
}
