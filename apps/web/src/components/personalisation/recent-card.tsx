import type { CardView } from '@/lib/catalogue/view';
import { formatPrice } from '@/lib/format';
import NextLink from 'next/link';
import { localePath } from '@/lib/locale-path';
import { ProductPhoto } from '../catalogue/product-photo';
import { ProductVisual } from '../catalogue/product-visual';

/**
 * One product of "Recently viewed" (shopping personalisation phase 2): a compact row (picture, brand, name, price),
 * one link, no client code (a plain `next/link` with the locale path: server actions have no next-intl context).
 * Rendered on the server by `recentCards` and handed to the lazy list, so the list's chunk
 * carries no catalogue code. The whole row is the link; the picture is decoration (the name says it).
 */
export function RecentCard({ product, locale }: { product: CardView; locale: string }) {
  const href = `/shop/${product.slug}`;
  const price = product.price?.pricePaise ?? null;
  return (
    <NextLink
      href={localePath(href, locale)}
      data-reco-slug={product.slug}
      className="group flex h-full min-h-20 items-center gap-3 rounded-tile border border-line-card bg-surface p-2.5 pr-3 hover:border-accent focus-visible:border-accent"
    >
      <span aria-hidden="true" className="block w-16 shrink-0">
        {product.photo ? (
          <ProductPhoto photo={{ ...product.photo, alt: '' }} size="thumb" sizes="64px" />
        ) : (
          <ProductVisual category={product.category.key} brand={product.brand} sku={product.sku} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-muted uppercase">{product.brand}</span>
        <span className="line-clamp-2 text-sm leading-snug font-bold text-ink group-hover:underline">
          {product.name}
        </span>
        {price !== null ? (
          <span className="mt-0.5 block font-heading text-[15px] font-extrabold text-ink">
            {formatPrice(price)}
          </span>
        ) : null}
      </span>
    </NextLink>
  );
}
