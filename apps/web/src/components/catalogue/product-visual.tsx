import Image from 'next/image';
import type { CategoryKey } from '@/demo/catalogue';
import { productPhoto } from '@/lib/media';

/**
 * Product photo (decision 2026-11-01 "Real photos"): a representative, openly licensed photo of the product type
 * (lib/media.ts) until seller photos arrive from Storage (spec 02). Fixed aspect ratio + `fill` so cards never shift;
 * `priority` only for the product page hero. The brand chip keeps the listed brand visible on every photo.
 */
export function ProductVisual({
  slug,
  category,
  brand,
  size = 'card',
}: {
  slug: string;
  category: CategoryKey;
  brand: string;
  size?: 'card' | 'hero';
}) {
  return (
    <div
      className={`relative overflow-hidden bg-pill ${
        size === 'hero' ? 'aspect-[4/3] rounded-card' : 'aspect-[4/3] rounded-tile'
      }`}
    >
      <Image
        src={productPhoto(slug, category)}
        alt=""
        fill
        preload={size === 'hero'}
        sizes={
          size === 'hero'
            ? '(min-width: 760px) 50vw, 100vw'
            : '(min-width: 1024px) 23vw, (min-width: 480px) 46vw, 92vw'
        }
        className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
      />
      <span className="absolute top-2.5 left-2.5 rounded-md bg-surface/95 px-2 py-1 text-[11px] font-extrabold tracking-wide text-ink shadow-card">
        {brand}
      </span>
    </div>
  );
}
