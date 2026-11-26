import type { RecoSlot } from '@mechdost/shared/recommendations';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { Wrench } from 'lucide-react';
import { fetchRecommendations } from '@/lib/catalogue/recommendations-source';
import type { CardView } from '@/lib/catalogue/view';
import { formatPrice } from '@/lib/format';
import { LocalLink } from '../ui/local-link';
import type { ReactNode } from 'react';
import { ProductVisual } from './product-visual';

/**
 * A card with no client code at all (artwork, brand, name, price, a link): the cart page is at its JavaScript budget
 * (spec 16), so "Add before checkout" cannot bring the add-to-cart button or the compare toggle with it. The product
 * page is where the item is added.
 */
export async function LeanCard({ product }: { product: CardView }) {
  const t = await getTranslations('reco');
  return (
    <article className="flex h-full flex-col rounded-card border border-line-card bg-surface p-3 shadow-card">
      <LocalLink href={`/shop/${product.slug}`} className="block" tabIndex={-1} aria-hidden="true">
        <ProductVisual category={product.category.key} brand={product.brand} sku={product.sku} />
      </LocalLink>
      <p className="mt-3 text-xs font-bold text-muted uppercase">{product.brand}</p>
      <h3 className="mt-1 text-[15px] leading-snug font-bold text-ink">
        <LocalLink href={`/shop/${product.slug}`} className="hover:underline">
          {product.name}
        </LocalLink>
      </h3>
      {product.price ? (
        <p className="mt-2 font-heading text-lg font-extrabold text-ink">
          {formatPrice(product.price.pricePaise)}
        </p>
      ) : null}
      <p className="mt-auto pt-3 text-sm font-bold">
        <LocalLink
          href={`/shop/${product.slug}`}
          className="text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('view', { name: product.name })}
        </LocalLink>
      </p>
    </article>
  );
}

/**
 * "Goes well with this" (product page) and "Add before checkout" (cart), spec 11. A Server Component with no client
 * code of its own: it asks the API for up to four suggestions for the given product slugs and shows each with the
 * reason it is suggested (the admin's wording for a rule, "bought together N times" for the nightly counts). The
 * card comes from the caller: the product page passes the catalogue card (`recommendations-section.tsx`), the cart the
 * lean one above (`recommendations-cart.tsx`), so the cart never imports the card's client code (JS budget, spec 16). Nothing to show means nothing is
 * rendered: no heading, no empty box.
 */
export async function RecommendationsCore({
  slugs,
  slot,
  locale,
  renderCard,
}: {
  slugs: readonly string[];
  slot: RecoSlot;
  locale: Locale;
  /** The card for each suggestion; the module that picks it decides what client code comes with it. */
  renderCard: (card: CardView) => ReactNode;
}) {
  const { items, fitting } = await fetchRecommendations(slugs, slot, locale);
  if (items.length === 0 && !fitting) return null;
  const t = await getTranslations('reco');
  const headingId = `reco-${slot}`;
  return (
    // `data-reco-*`: the lazy tracker counts impressions and clicks per surface and algorithm (spec 12).
    <section
      aria-labelledby={headingId}
      className="mt-14"
      data-reco-surface={slot === 'cart' ? 'cart' : 'product'}
    >
      <h2 id={headingId} className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
        {slot === 'cart' ? t('titleCart') : t('title')}
      </h2>
      {items.length > 0 ? (
        <ul className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
          {items.map(({ card, reason }) => (
            <li
              key={card.slug}
              className="flex flex-col"
              data-reco-slug={card.slug}
              data-reco-algo={reason.source === 'copurchase' ? 'copurchase' : 'rule'}
            >
              <div className="flex-1">{renderCard(card)}</div>
              <p className="mt-2 text-[13px] text-muted">
                {reason.source === 'rule' && reason.label
                  ? reason.label
                  : reason.count !== null
                    ? t('together', { count: reason.count })
                    : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {fitting ? (
        // The workshop fitting link (phase 3): an admin rule for this kind of product; one quiet row, one link.
        <p
          data-reco-slug=""
          data-reco-algo="fitting"
          className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-tile border border-line-card bg-surface px-4 py-3 text-sm text-ink"
        >
          <Wrench aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">{fitting.label}</span>
          <LocalLink
            href="/workshops"
            className="inline-flex min-h-11 items-center font-bold text-accent-soft-text underline underline-offset-4"
          >
            {t('fittingAction')}
          </LocalLink>
        </p>
      ) : null}
    </section>
  );
}
