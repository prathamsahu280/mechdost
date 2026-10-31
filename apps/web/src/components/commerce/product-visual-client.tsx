'use client';

import type { CategoryKey } from '@/demo/catalogue';
import { CATEGORY_ICONS } from '../catalogue/product-visual';

/** Small square product artwork for client lists (cart, order summary). */
export function ProductVisualClient({ category }: { category: CategoryKey }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <div
      aria-hidden="true"
      className="flex aspect-square items-center justify-center rounded-tile bg-gradient-to-br from-accent-soft to-pill"
    >
      <Icon className="size-9 text-accent" strokeWidth={1.25} />
    </div>
  );
}
