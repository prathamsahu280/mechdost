import { BadgeCheck, MessageCircle, ReceiptText, Store, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { HeroDeliveryScene, HeroShopScene, HeroWorkshopScene } from '../illustrations';
import { SiteText } from '../site/site-overrides';
import { ButtonLink } from '../ui/button-link';
import { HeroCarousel } from './hero-carousel';

type Tone = 'light' | 'green' | 'soft';

const TONES: Record<Tone, { panel: string; eyebrow: string; accent: string; lead: string }> = {
  light: {
    panel: 'bg-accent-soft text-ink',
    eyebrow: 'text-accent-soft-text',
    accent: 'text-accent-soft-text',
    lead: 'text-muted',
  },
  green: {
    panel: 'bg-hero text-white',
    eyebrow: 'text-hero-accent',
    accent: 'text-hero-accent',
    lead: 'text-hero-text',
  },
  soft: {
    panel: 'bg-surface-alt text-ink',
    eyebrow: 'text-accent-soft-text',
    accent: 'text-accent-soft-text',
    lead: 'text-muted',
  },
};

const TITLE =
  'mt-3 font-heading text-[clamp(30px,min(4.2vw,6.4vh),56px)] leading-[1.03] font-extrabold tracking-[-0.04em]';

/** One banner: copy on the left, illustration on the right (hidden on narrow phones to keep the hero short). */
function Slide({
  tone,
  eyebrow,
  title,
  lead,
  actions,
  art,
}: {
  tone: Tone;
  eyebrow: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  actions: ReactNode;
  art: ReactNode;
}) {
  const c = TONES[tone];
  return (
    <div
      className={`relative grid h-full items-center gap-6 overflow-hidden rounded-[22px] px-[6%] py-8 min-[480px]:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] tab:rounded-hero nav:px-[5%] nav:py-[clamp(28px,5vh,52px)] ${c.panel}`}
    >
      <div className="relative z-10 max-w-[560px]">
        <p className={`text-sm font-bold ${c.eyebrow}`}>{eyebrow}</p>
        {title}
        <p className={`mt-3 max-w-[48ch] text-[14px] leading-relaxed tab:mt-4 tab:text-[15px] ${c.lead}`}>
          {lead}
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5 tab:mt-6">{actions}</div>
      </div>
      <div className="hidden min-[480px]:block">{art}</div>
    </div>
  );
}

/**
 * Home hero (redesign 2026-11-02: "Sparevillage jaisa … more illustration, subtle animations, less crowded and
 * premium"): an illustrated banner carousel — shop, workshop care, local delivery. Slide 1 keeps the admin-editable
 * copy (SiteText) and the only h1 (LCP is this text, no image). Site search moved to the header; the rotating trust
 * badge sits beside the carousel controls. Illustrations: components/illustrations (CSS-only gentle motion).
 */
export function Hero({ city }: { city: string }) {
  const t = useTranslations('home.hero');
  const locale = useLocale();
  const ticker = [
    { text: t('photoCaption', { city }), icon: BadgeCheck },
    { text: t('ticker2'), icon: ReceiptText },
    { text: t('ticker3'), icon: Store },
    { text: t('ticker4', { city }), icon: Wallet },
    { text: t('ticker5'), icon: MessageCircle },
  ];

  const slides = [
    <Slide
      key="shop"
      tone="light"
      eyebrow={<SiteText k="hero.eyebrow" locale={locale} fallback={t('eyebrow')} />}
      title={
        <h1 id="hero-title" className={TITLE}>
          <SiteText k="hero.titleLine1" locale={locale} fallback={t('titleLine1')} />
          <br />
          <span className={TONES.light.accent}>
            <SiteText k="hero.titleLine2" locale={locale} fallback={t('titleLine2')} />
          </span>
        </h1>
      }
      lead={<SiteText k="hero.lead" locale={locale} fallback={t('lead', { city })} />}
      actions={
        <>
          <ButtonLink href="/shop" data-track="hero_shop" className="min-h-12 px-6">
            {t('slide1Cta')}
          </ButtonLink>
          <ButtonLink
            href="/workshops"
            variant="quiet"
            data-track="hero_find_workshop"
            className="min-h-12 px-2"
          >
            {t('findWorkshop')}
          </ButtonLink>
        </>
      }
      art={<HeroShopScene className="mx-auto w-full max-w-[520px]" />}
    />,
    <Slide
      key="care"
      tone="green"
      eyebrow={t('slide2Eyebrow', { city })}
      title={
        <h2 className={TITLE}>
          {t('slide2Title1')}
          <br />
          <span className={TONES.green.accent}>{t('slide2Title2')}</span>
        </h2>
      }
      lead={t('slide2Lead')}
      actions={
        <ButtonLink
          href="/workshops"
          variant="onGreen"
          data-track="hero_slide2_workshops"
          className="min-h-12 px-6"
        >
          {t('slide2Cta')}
        </ButtonLink>
      }
      art={<HeroWorkshopScene className="mx-auto w-full max-w-[520px]" />}
    />,
    <Slide
      key="delivery"
      tone="soft"
      eyebrow={t('slide3Eyebrow')}
      title={
        <h2 className={TITLE}>
          {t('slide3Title1')}
          <br />
          <span className={TONES.soft.accent}>{t('slide3Title2')}</span>
        </h2>
      }
      lead={t('slide3Lead')}
      actions={
        <ButtonLink href="/shop" data-track="hero_slide3_shop" className="min-h-12 px-6">
          {t('slide3Cta')}
        </ButtonLink>
      }
      art={<HeroDeliveryScene className="mx-auto w-full max-w-[520px] overflow-hidden" />}
    />,
  ];

  return (
    <section aria-labelledby="hero-title" className="px-[3%] pt-4 tab:pt-5">
      <div className="mx-auto max-w-[1600px]">
        <HeroCarousel
          slides={slides}
          labels={{
            carousel: t('carouselLabel'),
            slides: slides.map((_, i) => t('slideLabel', { n: i + 1, total: slides.length })),
            goTo: slides.map((_, i) => t('goTo', { n: i + 1 })),
            pause: t('pause'),
            play: t('play'),
          }}
          aside={
            <>
              {/* Rotating trust line (CSS cycle, .hero-ticker); screen readers get the full list once. */}
              <ul className="sr-only" aria-label={t('tickerLabel')}>
                {ticker.map(({ text }) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <p aria-hidden="true" className="hero-ticker text-[13px] font-semibold text-muted">
                {ticker.map(({ text, icon: Icon }, i) => (
                  <span
                    key={text}
                    style={{ '--n': i } as CSSProperties}
                    className="inline-flex items-center gap-2"
                  >
                    <Icon className="size-4 shrink-0 text-accent" />
                    {text}
                  </span>
                ))}
              </p>
            </>
          }
        />
      </div>
    </section>
  );
}
