import { useLocale, useTranslations } from 'next-intl';
import { DEMO_PRODUCTS } from '@/demo/catalogue';
import { demoCard } from '@/lib/catalogue/demo-source';
import { ProductCard } from '../catalogue/product-card';
import { ButtonLink } from '../ui/button-link';
import { Container } from '../ui/page-intro';

/** "Browse our product range": the popular products (demo catalogue until the catalogue API ships). */
export function ProductRange() {
  const t = useTranslations('home.products');
  const locale = useLocale();
  const popular = DEMO_PRODUCTS.filter((p) => p.popular)
    .slice(0, 4)
    .map((p) => demoCard(p, locale));
  return (
    <section aria-labelledby="range-title" className="pt-14">
      <Container>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="range-title" className="font-heading text-xl font-bold text-ink">
            {t('rangeTitle')}
          </h2>
          <p className="text-xs text-muted">{t('rangeNote')}</p>
        </div>
        <ul className="mt-6 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
          {popular.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} scope="home" />
            </li>
          ))}
        </ul>
        <div className="mt-6 text-center">
          <ButtonLink href="/shop" variant="quiet" data-track="home_range_view_all">
            {t('viewAll')}
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
