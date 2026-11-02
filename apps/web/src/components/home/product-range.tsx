import { useLocale, useTranslations } from 'next-intl';
import { DEMO_PRODUCTS, type DemoProduct } from '@/demo/catalogue';
import { getPathname } from '@/i18n/navigation';
import { ProductCard } from '../catalogue/product-card';
import { Container } from '../ui/page-intro';
import { Rail } from './rail';

/**
 * Product collections (redesign 2026-11-02, SpareVillage-style rails, less crowded): bestsellers, then two rails by
 * vehicle. Demo catalogue until the catalogue API ships; admin-curated collections replace these in Phase 1 (spec 08).
 */
export function ProductRange() {
  const t = useTranslations('home.products');
  const locale = useLocale();
  const shop = getPathname({ href: '/shop', locale });
  const rails: { id: string; title: string; items: readonly DemoProduct[]; href: string; track: string }[] = [
    {
      id: 'rail-best',
      title: t('railBest'),
      items: DEMO_PRODUCTS.filter((p) => p.popular),
      href: shop,
      track: 'home_rail_best_all',
    },
    {
      id: 'rail-2w',
      title: t('railTwo'),
      items: DEMO_PRODUCTS.filter((p) => p.fits === '2W' || p.fits === '2W/4W'),
      href: shop,
      track: 'home_rail_2w_all',
    },
    {
      id: 'rail-4w',
      title: t('railFour'),
      items: DEMO_PRODUCTS.filter((p) => p.fits === '4W' || p.fits === '2W/4W'),
      href: shop,
      track: 'home_rail_4w_all',
    },
  ];
  return (
    <section aria-labelledby="range-title" className="pt-20 tab:pt-24">
      <Container>
        <h2 id="range-title" className="sr-only">
          {t('rangeTitle')}
        </h2>
        <div className="space-y-14 tab:space-y-16">
          {rails.map((rail) => (
            <Rail
              key={rail.id}
              id={rail.id}
              title={rail.title}
              viewAll={{ href: rail.href, label: t('viewAll'), track: rail.track }}
              labels={{ prev: t('railPrev'), next: t('railNext') }}
            >
              {rail.items.map((p) => (
                <li key={p.slug} className="w-[min(78vw,270px)] shrink-0 snap-start">
                  <ProductCard product={p} />
                </li>
              ))}
            </Rail>
          ))}
        </div>
      </Container>
    </section>
  );
}
