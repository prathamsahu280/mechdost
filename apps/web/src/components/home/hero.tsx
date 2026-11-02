import { BadgeCheck, MapPin, MessageCircle, ReceiptText, Search, Store, Wallet, Wrench } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { getPathname } from '@/i18n/navigation';
import heroImage from '../../../public/images/site/hero-workshop.jpg';
import { SiteText } from '../site/site-overrides';
import { LocalLink } from '../ui/local-link';
import { HeroVehicleSelect } from './hero-vehicle-select';

const POPULAR = [
  { key: 'oil', q: 'engine oil' },
  { key: 'battery', q: 'battery' },
  { key: 'tyre', q: 'tyre' },
  { key: 'brake', q: 'brake pad' },
] as const;

/**
 * Home hero (decision 2026-11-01 "Modern storefront refresh"): a full-bleed workshop photo with deep green fading in from
 * the left, the concept headline, and a search console for the visitor's first job — find a part, or find a
 * workshop by PIN. The console's two modes are a native radio group switched with CSS `:has()`, so the hero stays
 * a static Server Component and both forms are plain GETs that work before JS loads.
 */
export function Hero({ city }: { city: string }) {
  const t = useTranslations('home.hero');
  const locale = useLocale();
  const shopPath = getPathname({ href: '/shop', locale });
  const workshopsPath = getPathname({ href: '/workshops', locale });
  const ticker = [
    { text: t('photoCaption', { city }), icon: BadgeCheck },
    { text: t('ticker2'), icon: ReceiptText },
    { text: t('ticker3'), icon: Store },
    { text: t('ticker4', { city }), icon: Wallet },
    { text: t('ticker5'), icon: MessageCircle },
  ];

  return (
    <section aria-labelledby="hero-title" className="hero-console px-[3%] pt-4 tab:pt-5">
      <div className="relative mx-auto max-w-[1600px] overflow-hidden rounded-[20px] bg-hero text-white tab:rounded-hero">
        {/* Phones/tablets: full-bleed photo under a green veil. Wide screens: the photo fills the right ~58% and is
            framed on the car (its subject), with green fading in from the copy side. */}
        <div className="hero-parallax absolute inset-0 nav:left-[42%]">
          <Image
            src={heroImage}
            alt={t('imageAlt')}
            fill
            preload
            placeholder="blur"
            sizes="(min-width: 1024px) 58vw, 100vw"
            className="object-cover object-[30%_center]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-hero/80 via-hero/85 to-hero nav:bg-gradient-to-r nav:from-hero nav:via-hero/30 nav:to-transparent"
          />
        </div>

        <div className="relative grid grid-cols-1 gap-6 px-[6%] pt-7 pb-6 tab:pt-10 tab:pb-8 nav:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)] nav:px-[5%] nav:pt-[clamp(28px,5vh,56px)] nav:pb-[clamp(24px,4.5vh,48px)]">
          <div className="min-w-0 max-w-[720px]">
            <p className="text-sm font-bold text-hero-accent">
              <SiteText k="hero.eyebrow" locale={locale} fallback={t('eyebrow')} />
            </p>
            <h1
              id="hero-title"
              className="mt-3 font-heading text-[clamp(30px,min(4.6vw,6.2vh),60px)] leading-[1.02] font-extrabold tracking-[-0.04em] tab:mt-4"
            >
              <SiteText k="hero.titleLine1" locale={locale} fallback={t('titleLine1')} />
              <br />
              <span className="text-hero-accent">
                <SiteText k="hero.titleLine2" locale={locale} fallback={t('titleLine2')} />
              </span>
            </h1>
            <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-hero-text tab:mt-4 tab:text-[15px]">
              <SiteText k="hero.lead" locale={locale} fallback={t('lead', { city })} />
            </p>

            {/* Search console */}
            <div className="mt-5 rounded-[18px] bg-surface p-2 text-ink shadow-dialog tab:mt-6">
              <fieldset className="grid grid-cols-2 gap-1 rounded-[12px] bg-pill p-1">
                <legend className="sr-only">{t('consoleLabel')}</legend>
                <label className="hero-mode">
                  <input
                    type="radio"
                    name="hero-mode"
                    value="parts"
                    defaultChecked
                    className="hero-mode-input"
                  />
                  <Search aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
                  <span className="min-[480px]:hidden">{t('modePartsShort')}</span>
                  <span className="hidden min-[480px]:inline">{t('modeParts')}</span>
                </label>
                <label className="hero-mode">
                  <input
                    type="radio"
                    name="hero-mode"
                    value="workshop"
                    className="hero-mode-input"
                    data-track="hero_mode_workshop"
                  />
                  <Wrench aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
                  <span className="min-[480px]:hidden">{t('modeWorkshopShort')}</span>
                  <span className="hidden min-[480px]:inline">{t('modeWorkshop')}</span>
                </label>
              </fieldset>

              <form
                role="search"
                action={shopPath}
                method="get"
                data-track-search="hero"
                className="hero-panel-parts p-2 pt-3"
              >
                <label htmlFor="hero-search" className="sr-only">
                  {t('searchLabel')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="hero-search"
                    name="q"
                    type="search"
                    maxLength={120}
                    autoComplete="off"
                    enterKeyHint="search"
                    placeholder={t('searchPlaceholder')}
                    className="min-h-11 w-full min-w-0 flex-1 rounded-input border border-input-border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted"
                  />
                  <button
                    type="submit"
                    aria-label={t('searchSubmit')}
                    className="press inline-flex min-h-11 min-w-11 items-center justify-center rounded-input bg-accent-button px-4 text-white hover:bg-accent-button-hover"
                  >
                    <Search aria-hidden="true" className="size-5" strokeWidth={2.5} />
                  </button>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto text-[13px] [scrollbar-width:none] min-[480px]:flex-wrap">
                  <span className="mr-1 shrink-0 text-muted">{t('popularLabel')}</span>
                  {POPULAR.map((p) => (
                    <LocalLink
                      key={p.key}
                      href="/shop"
                      query={{ q: p.q }}
                      data-track={`hero_popular_${p.key}`}
                      className="inline-flex min-h-8 shrink-0 items-center rounded-pill border border-line-card px-3 font-bold whitespace-nowrap text-ink hover:border-ink"
                    >
                      {t(`popular.${p.key}`)}
                    </LocalLink>
                  ))}
                </div>
              </form>

              <form
                action={workshopsPath}
                method="get"
                data-track-search="hero_workshop"
                className="hero-panel-workshop p-2 pt-3"
              >
                <div className="grid gap-2 min-[480px]:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label htmlFor="hero-pin" className="text-xs font-bold text-muted">
                      {t('pinLabel')}
                    </label>
                    <input
                      id="hero-pin"
                      name="pin"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="postal-code"
                      placeholder={t('pinPlaceholder')}
                      className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted"
                    />
                  </div>
                  <div>
                    <label
                      id="hero-vehicle-label"
                      htmlFor="hero-vehicle"
                      className="text-xs font-bold text-muted"
                    >
                      {t('vehicleLabel')}
                    </label>
                    <HeroVehicleSelect
                      labels={{ any: t('vehicleAny'), twoW: t('vehicle2W'), fourW: t('vehicle4W') }}
                    />
                  </div>
                  <button
                    type="submit"
                    className="press inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-input bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
                  >
                    <MapPin aria-hidden="true" className="size-4" strokeWidth={2.5} />
                    {t('workshopSubmit')}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Rotating trust badge (user 2026-11-02: "make it feel alive … appear alternatively"). Pure CSS cycle
              (.hero-ticker in globals.css); screen readers get the full list once; reduced motion shows line 1. */}
          <div className="hidden self-end justify-self-start tab:block nav:justify-self-end">
            <ul className="sr-only" aria-label={t('tickerLabel')}>
              {ticker.map(({ text }) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p
              aria-hidden="true"
              className="hero-ticker rounded-pill border border-white/15 bg-hero/80 px-3.5 py-2 text-[13px] font-bold text-white backdrop-blur"
            >
              {ticker.map(({ text, icon: Icon }, i) => (
                <span
                  key={text}
                  style={{ '--n': i } as CSSProperties}
                  className="inline-flex items-center gap-2"
                >
                  <Icon className="size-4 shrink-0 text-hero-accent" />
                  {text}
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
