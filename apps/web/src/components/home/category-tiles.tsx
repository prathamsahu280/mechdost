import { useTranslations } from 'next-intl';
import { CATEGORY_KEYS, CATEGORY_SLUGS } from '@/demo/catalogue';
import { CATEGORY_EMOJI } from '@/lib/emoji';
import { DEFAULT_FEATURED } from '@/lib/site-layout';
import { CategoryEmoji } from '../site/site-overrides';
import { LocalLink } from '../ui/local-link';
import { ButtonLink } from '../ui/button-link';
import { Container, Eyebrow } from '../ui/page-intro';

/**
 * Home category shortcuts. All nine tiles are rendered; the featured ones show (the default six, or the admin's 3 to 6
 * from the saved layout, chosen on the server), and in the demo the pre-paint layout script can still change which
 * show via `data-home-category`. Emoji are admin-editable too (`emoji` from the saved layout wins over the demo's
 * browser-stored one). Admin-managed categories replace this list in Phase 1 (spec 08).
 */
export function CategoryTiles({
  featured = DEFAULT_FEATURED,
  emoji = {},
}: {
  featured?: readonly string[];
  emoji?: Partial<Record<string, string>>;
}) {
  const isDefault = (key: string) => featured.includes(key);
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
            return (
              <li key={key} data-home-category={key} className={isDefault(key) ? undefined : 'hidden'}>
                <LocalLink
                  href="/shop"
                  query={{ category: slug }}
                  data-track={`home_category_${slug}`}
                  className="group press reveal flex h-full min-h-[150px] flex-col items-center justify-center gap-3 rounded-tile border border-line-card bg-surface px-3 py-4 text-center shadow-card transition duration-[var(--duration-base)] hover:-translate-y-1 hover:border-accent-soft hover:shadow-card-hover"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-14 place-items-center rounded-full bg-accent-soft text-[28px] leading-none transition-transform duration-[var(--duration-base)] group-hover:scale-110"
                  >
                    {emoji[key] ?? <CategoryEmoji k={key} fallback={CATEGORY_EMOJI[key]} />}
                  </span>
                  <span>
                    <span className="block text-[15px] font-bold text-ink">{c(key)}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-muted">{hints(key)}</span>
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
