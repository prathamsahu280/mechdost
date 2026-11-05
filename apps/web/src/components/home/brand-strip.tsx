import { useTranslations } from 'next-intl';
import { DEMO_PRODUCTS } from '@/demo/catalogue';
import { stagger } from '@/lib/motion';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';

/**
 * Brands we stock (redesign 2026-11-05, boodmo-inspired "brands we trust"). Plain text wordmarks — no logos (they
 * are trademarks we have no licence to show) — each searching the shop. The list is the brands actually in the
 * catalogue, so every tile returns results.
 */
export function BrandStrip() {
  const t = useTranslations('home.brands');
  const brands = [...new Set(DEMO_PRODUCTS.map((p) => p.brand))].sort((a, b) => a.localeCompare(b));
  return (
    <section aria-labelledby="brands-title" className="pt-20 tab:pt-28">
      <Container>
        <div className="reveal">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2
            id="brands-title"
            className="mt-4 font-heading text-[clamp(24px,2.6vw,34px)] font-extrabold tracking-[-0.03em] text-ink"
          >
            {t('title')}
          </h2>
        </div>
        <ul className="mt-7 grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-3 tab:grid-cols-4 nav:grid-cols-6">
          {brands.map((brand, i) => (
            <li key={brand} className="reveal" style={stagger(i % 6)}>
              <LocalLink
                href="/shop"
                query={{ q: brand }}
                data-track={`home_brand_${brand.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`}
                className="press grid min-h-16 place-items-center rounded-tile border border-line-card bg-surface px-3 text-center font-heading text-[15px] font-extrabold tracking-[-0.01em] text-muted transition-colors duration-[var(--duration-base)] hover:border-accent hover:text-ink"
              >
                {brand}
              </LocalLink>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">{t('note')}</p>
      </Container>
    </section>
  );
}
