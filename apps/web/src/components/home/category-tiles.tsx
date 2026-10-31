import { BatteryFull, CircleDot, Cog, Disc3, Droplets, Sparkles, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LocalLink } from '../ui/local-link';
import { ButtonLink } from '../ui/button-link';
import { Container, Eyebrow } from '../ui/page-intro';

/** Home shortcuts from the concept (6 of the 9 categories). Admin-managed categories replace this list in Phase 1. */
const CATEGORIES: {
  key: 'tyres' | 'lubricants' | 'batteries' | 'bearings' | 'spareParts' | 'accessories';
  slug: string;
  icon: LucideIcon;
}[] = [
  { key: 'tyres', slug: 'tyres', icon: Disc3 },
  { key: 'lubricants', slug: 'lubricants', icon: Droplets },
  { key: 'batteries', slug: 'batteries', icon: BatteryFull },
  { key: 'bearings', slug: 'bearings', icon: CircleDot },
  { key: 'spareParts', slug: 'spare-parts', icon: Cog },
  { key: 'accessories', slug: 'accessories', icon: Sparkles },
];

export function CategoryTiles() {
  const t = useTranslations('home.products');
  const c = useTranslations('home.categories');
  const hints = useTranslations('home.categoryHints');
  return (
    <section aria-labelledby="categories-title" className="pt-14 tab:pt-16">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2
              id="categories-title"
              className="mt-4 font-heading text-[clamp(28px,3vw,40px)] font-extrabold tracking-[-0.03em] text-ink"
            >
              {t('title')}
            </h2>
          </div>
          <ButtonLink href="/shop" variant="quiet" data-track="home_view_all_products">
            {t('viewAll')}
          </ButtonLink>
        </div>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map(({ key, slug, icon: Icon }) => (
            <li key={key}>
              <LocalLink
                href="/shop"
                query={{ category: slug }}
                data-track={`home_category_${slug}`}
                className="press reveal flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-tile border border-line-card bg-surface px-3 py-4 text-center shadow-card transition duration-[var(--duration-base)] hover:-translate-y-1 hover:border-accent-soft hover:shadow-card-hover"
              >
                <Icon aria-hidden="true" className="size-8 text-accent" strokeWidth={1.75} />
                <span>
                  <span className="block text-[15px] font-bold text-ink">{c(key)}</span>
                  <span className="mt-1 block text-[11px] leading-snug text-muted">{hints(key)}</span>
                </span>
              </LocalLink>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
