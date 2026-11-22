import { Search } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import heroImage from '../../../public/images/automotive-hero.jpg';
import insetImage from '../../../public/images/motorcycle.jpg';
import { SiteText } from '../site/site-overrides';
import { TrustLine } from '../site/trust-line';
import { ButtonLink } from '../ui/button-link';
import { localePath } from '@/lib/locale-path';

/**
 * Concept hero (docs/concept/customer-site.md §3.1): navy panel, copy + search on the left, workshop photo with
 * a rotated motorcycle inset on the right. Static imports give width/height + blur placeholders (no CLS, LQIP);
 * only the main photo is preloaded (LCP). The search form is a plain GET to /shop, so it works before JS loads.
 */
export function Hero({ region }: { region: string }) {
  const t = useTranslations('home.hero');
  const trust = useTranslations('trust');
  const locale = useLocale();
  const shopPath = localePath('/shop', locale);

  return (
    <section aria-labelledby="hero-title" className="px-[3%] pt-5 tab:pt-6">
      <div className="mx-auto grid max-w-[1600px] overflow-hidden rounded-[18px] bg-navy text-white tab:rounded-hero nav:grid-cols-2">
        <div className="px-[7%] py-12 tab:py-14 nav:px-[6%] nav:py-16">
          {/* Admin-editable text (demo: /admin/content); the defaults come from the locale files. */}
          <p className="eyebrow text-accent-light">
            <SiteText k="hero.eyebrow" locale={locale} fallback={t('eyebrow')} />
          </p>
          <h1
            id="hero-title"
            className="mt-5 font-heading text-[clamp(40px,3.8vw,60px)] leading-[1.02] font-extrabold tracking-[-0.045em]"
          >
            <SiteText k="hero.titleLine1" locale={locale} fallback={t('titleLine1')} />
            <br />
            <em className="text-accent-light not-italic">
              <SiteText k="hero.titleLine2" locale={locale} fallback={t('titleLine2')} />
            </em>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-hero-copy tab:text-base">
            <SiteText k="hero.lead" locale={locale} fallback={t('lead', { region })} />
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/shop" data-track="hero_explore_products" className="min-h-12 px-6">
              {t('exploreProducts')}
            </ButtonLink>
            <ButtonLink
              href="/workshops"
              variant="outlineOnDark"
              data-track="hero_find_workshop"
              className="min-h-12 px-5"
            >
              {t('findWorkshop')}
            </ButtonLink>
          </div>

          <form
            role="search"
            action={shopPath}
            method="get"
            data-track-search="hero"
            className="mt-8 max-w-md"
          >
            <label htmlFor="hero-search" className="text-[13px] text-hero-copy">
              {t('searchLabel')}
            </label>
            <div className="mt-3 flex flex-col gap-2 rounded-[11px] border-2 border-white/80 bg-surface p-1.5 min-[480px]:flex-row">
              <input
                id="hero-search"
                name="q"
                type="search"
                maxLength={120}
                autoComplete="off"
                enterKeyHint="search"
                placeholder={t('searchPlaceholder')}
                className="min-h-11 w-full min-w-0 flex-1 rounded-input px-3 text-[15px] text-ink placeholder:text-muted"
              />
              <button
                type="submit"
                aria-label={t('searchSubmit')}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-input bg-accent-button px-4 text-white hover:bg-accent-button-hover"
              >
                <Search aria-hidden="true" className="size-5" strokeWidth={2.5} />
              </button>
            </div>
          </form>

          {/* Trust lines (design 2026-11-15): admin-editable per language, hidden when the admin hides all three. */}
          <ul
            aria-label={trust('homeLabel')}
            className="mt-6 flex max-w-md flex-col gap-1.5 text-[13px] text-hero-copy empty:hidden"
          >
            {(['homeGenuine', 'homeBill', 'homeEstimates'] as const).map((placement) => (
              <TrustLine
                key={placement}
                placement={placement}
                as="li"
                className="before:mr-2 before:font-bold before:text-accent-light before:content-['✓']"
              />
            ))}
          </ul>
        </div>

        <figure className="relative aspect-[16/10] nav:aspect-auto nav:min-h-full">
          <Image
            src={heroImage}
            alt={t('imageAlt')}
            fill
            preload
            placeholder="blur"
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-navy/50 to-transparent" />
          <figcaption className="eyebrow absolute top-6 left-6 max-w-[calc(100%-3rem)] rounded-lg bg-navy/85 px-3 py-2 text-[9px] text-white">
            {t('imageLabel')}
          </figcaption>
          <div className="absolute right-[4%] bottom-[5%] w-[min(320px,58%)] -rotate-3 overflow-hidden rounded-xl border-[6px] border-white shadow-dialog">
            <Image
              src={insetImage}
              alt={t('insetAlt')}
              placeholder="blur"
              sizes="320px"
              className="aspect-[16/10] h-auto w-full object-cover"
            />
            <p className="eyebrow absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy/90 to-transparent px-3 pt-6 pb-2 text-[8px] text-white">
              {t('insetLabel')}
            </p>
          </div>
        </figure>
      </div>
    </section>
  );
}
