'use client';

import Image from 'next/image';
import type { CategoryKey } from '@/demo/catalogue';
import { productPhoto } from '@/lib/media';

/** Small square product photo for client lists (cart, order summary). Decorative: the name is next to it. */
export function ProductVisualClient({ slug, category }: { slug: string; category: CategoryKey }) {
  return (
    <div aria-hidden="true" className="relative aspect-square overflow-hidden rounded-tile bg-pill">
      <Image src={productPhoto(slug, category)} alt="" fill sizes="96px" className="object-cover" />
    </div>
  );
}
