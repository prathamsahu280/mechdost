import { useTranslations } from 'next-intl';
import { CATEGORY_KEYS, CATEGORY_SLUGS } from '@/demo/catalogue';
import { stagger } from '@/lib/motion';
import { DEFAULT_FEATURED } from '@/lib/site-layout';
import { CATEGORY_ART } from '../illustrations';
import { LocalLink } from '../ui/local-link';
import { ButtonLink } from '../ui/button-link';
import { Container, Eyebrow } from '../ui/page-intro';

const isDefault = (key: string) => DEFAULT_FEATURED.some((k) => k === key);

/**
 * Home category shortcuts. All nine tiles are rendered; the default six show, and the admin's choice (demo:
 * /admin/layout, applied by the pre-paint layout script via `data-home-category`) can feature any 3–6 of them.
 * Each category has a fixed icon (lib/icons.ts). Admin-managed categories replace this list in Phase 1 (spec 08).
 */
export function CategoryTiles() {
  const t = useTranslations('home.products');
  const c = useTranslations('home.categories');
  const hints = useTranslations('home.categoryHints');
  return (
    <section aria-labelledby="categories-title" className="pt-20 tab:pt-24">
      <Container>
        <div className="reveal flex flex-wrap items-end justify-between gap-4">
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
        <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORY_KEYS.map((key, i) => {
            const slug = CATEGORY_SLUGS[key];
            const Art = CATEGORY_ART[key];
            return (
              <li
                key={key}
                data-home-category={key}
                style={stagger(i)}
                className={isDefault(key) ? 'reveal' : 'reveal hidden'}
              >
                <LocalLink
                  href="/shop"
                  query={{ category: slug }}
                  data-track={`home_category_${slug}`}
                  className="group press flex h-full flex-col items-center rounded-card px-3 pt-5 pb-4 text-center transition-colors duration-[var(--duration-base)] hover:bg-surface"
                >
                  <Art className="size-[84px] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:-translate-y-1 tab:size-24" />
                  <span className="mt-3 block text-[15px] font-extrabold text-ink">{c(key)}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{hints(key)}</span>
                </LocalLink>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
