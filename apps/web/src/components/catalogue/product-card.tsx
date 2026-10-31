import { useTranslations } from 'next-intl';
import type { DemoProduct } from '@/demo/catalogue';
import { discountPercent, formatPrice } from '@/lib/format';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { ProductVisual } from './product-visual';

/** Concept product card: artwork, BRAND · Category, name, spec, price (+MRP), availability, details, add to cart. */
export function ProductCard({ product }: { product: DemoProduct }) {
  const t = useTranslations('catalogue');
  const c = useTranslations('categories');
  const off = discountPercent(product.pricePaise, product.mrpPaise);
  const availability =
    product.availability === 'in_stock'
      ? t('inStock')
      : product.availability === 'low_stock'
        ? t('lowStock')
        : t('onRequest');

  return (
    <article className="group reveal flex h-full flex-col rounded-card border border-line-card bg-surface p-4 shadow-card transition duration-[var(--duration-base)] hover:-translate-y-1 hover:shadow-card-hover">
      <LocalLink href={`/shop/${product.slug}`} className="block" tabIndex={-1} aria-hidden="true">
        <ProductVisual category={product.category} brand={product.brand} />
      </LocalLink>
      <p className="mt-4 text-[11px] text-muted">
        <span className="font-bold uppercase">{product.brand}</span> · {c(product.category)}
      </p>
      <h3 className="mt-1 font-heading text-[17px] leading-snug font-bold text-ink">
        <LocalLink
          href={`/shop/${product.slug}`}
          className="inline-block py-0.5 hover:underline"
          data-track={`product_${product.slug}`}
        >
          {product.name}
        </LocalLink>
      </h3>
      <p className="mt-1 text-xs text-muted">{product.spec}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <span className="font-heading text-[22px] font-extrabold text-ink">
          {formatPrice(product.pricePaise)}
        </span>
        {product.mrpPaise && off ? (
          <>
            <span className="text-xs text-muted line-through">
              {t('mrp', { price: formatPrice(product.mrpPaise) })}
            </span>
            <span className="rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-bold text-success">
              {t('save', { percent: off })}
            </span>
          </>
        ) : null}
      </div>
      <p
        className={`mt-1 text-xs font-bold ${product.availability === 'on_request' ? 'text-warning' : 'text-success'}`}
      >
        {availability}
      </p>
      <div className="mt-auto pt-4">
        <AddToCartButton
          slug={product.slug}
          labels={{ add: t('addToCart'), added: t('added'), maxQty: t('maxQty'), maxLines: t('maxLines') }}
        />
      </div>
    </article>
  );
}
