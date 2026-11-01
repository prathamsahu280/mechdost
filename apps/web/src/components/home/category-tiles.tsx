import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { CATEGORY_KEYS, CATEGORY_SLUGS } from '@/demo/catalogue';
import { CATEGORY_ICONS } from '@/lib/icons';
import { CATEGORY_PHOTOS } from '@/lib/media';
import { DEFAULT_FEATURED } from '@/lib/site-layout';
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
          {CATEGORY_KEYS.map((key) => {
            const slug = CATEGORY_SLUGS[key];
            const Icon = CATEGORY_ICONS[key];
            return (
              <li key={key} data-home-category={key} className={isDefault(key) ? undefined : 'hidden'}>
                <LocalLink
                  href="/shop"
                  query={{ category: slug }}
                  data-track={`home_category_${slug}`}
                  className="group press flex h-full flex-col overflow-hidden rounded-tile border border-line-card bg-surface shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover"
                >
                  <span className="relative block aspect-[4/3] overflow-hidden bg-pill">
                    <Image
                      src={CATEGORY_PHOTOS[key]}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 16vw, (min-width: 640px) 31vw, 46vw"
                      className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:scale-[1.04]"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute top-2 left-2 grid size-9 place-items-center rounded-full bg-surface/95 text-accent-soft-text shadow-card"
                    >
                      <Icon className="size-[18px]" strokeWidth={2} />
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col px-3.5 py-3">
                    <span className="block text-[15px] font-extrabold text-ink">{c(key)}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{hints(key)}</span>
                  </span>
                </LocalLink>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
