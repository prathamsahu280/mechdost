import { getTranslations } from 'next-intl/server';
import type { CardView } from '@/lib/catalogue/view';
import { ProductCard } from './product-card';

export interface SimilarItem {
  card: CardView;
  /** The size both products share ("185/65 R15", "900 ml"); null when they match on a spec only. */
  size: string | null;
}

/**
 * "Similar options" on the product page (shopping personalisation phase 3, design 2026-11-25): products of the same
 * category in the same size (and oil grade / battery capacity), for the same kind of vehicle, of other brands, that can
 * be bought today. A Server Component (no client code of its own): the usual catalogue cards plus the shared size, and
 * one honest note to check the fit (never "recommended for you": the match is the size, not the shopper's vehicle).
 * `data-reco-*` lets the lazy tracker count impressions and clicks (spec 12). Nothing to show renders nothing.
 */
export async function SimilarSection({ items }: { items: readonly SimilarItem[] }) {
  if (items.length === 0) return null;
  const t = await getTranslations('reco');
  return (
    <section aria-labelledby="similar" className="mt-14" data-reco-surface="product" data-reco-algo="similar">
      <h2 id="similar" className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
        {t('similarTitle')}
      </h2>
      <p className="mt-2 max-w-prose text-sm text-muted">{t('similarNote')}</p>
      <ul className="card-grid mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
        {items.map(({ card, size }) => (
          <li key={card.slug} className="flex flex-col" data-reco-slug={card.slug}>
            <div className="flex-1">
              <ProductCard product={card} scope="similar" />
            </div>
            {size ? <p className="mt-2 text-[13px] text-muted">{t('similarSize', { size })}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
