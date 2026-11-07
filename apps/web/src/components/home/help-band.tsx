import { MessageCircle, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { site, whatsappLink } from '@/lib/site';
import { Container } from '../ui/page-intro';

/**
 * "Need a hand?" band (redesign 2026-11-05, Fixter-inspired): one deep-green panel with WhatsApp and call, placed
 * last on the home page. Support number from site config.
 */
export function HelpBand({ city }: { city: string }) {
  const t = useTranslations('home.help');
  const wa = useTranslations('whatsapp');
  const footer = useTranslations('footer');
  return (
    <section aria-labelledby="help-title" className="pt-20 tab:pt-28">
      <Container>
        <div className="reveal-panel relative overflow-hidden rounded-hero bg-navy px-6 py-12 text-white tab:px-12 tab:py-16">
          <div className="relative grid items-center gap-8 nav:grid-cols-[minmax(0,1.4fr)_auto]">
            <div className="max-w-2xl">
              <h2
                id="help-title"
                className="font-heading text-[clamp(28px,3.4vw,44px)] leading-[1.08] font-extrabold tracking-[-0.03em]"
              >
                {t('title')}
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-hero-text">{t('body', { city })}</p>
            </div>
            <div className="flex flex-col gap-3 min-[480px]:flex-row nav:flex-col">
              <a
                href={whatsappLink(wa('general'))}
                target="_blank"
                rel="noopener noreferrer"
                data-track="home_help_whatsapp"
                className="press inline-flex min-h-13 items-center justify-center gap-2.5 rounded-pill bg-white px-6 text-[15px] font-extrabold text-accent-button shadow-card hover:bg-accent-soft"
              >
                <MessageCircle aria-hidden="true" className="size-5" strokeWidth={2.25} />
                {t('whatsapp')}
                <span className="sr-only"> ({footer('whatsappNote')})</span>
              </a>
              <a
                href={`tel:${site.supportPhoneE164}`}
                data-track="home_help_call"
                className="press inline-flex min-h-13 items-center justify-center gap-2.5 rounded-pill border border-white/40 px-6 text-[15px] font-bold text-white hover:bg-white/10"
              >
                <Phone aria-hidden="true" className="size-5" strokeWidth={2.25} />
                {t('call', { phone: site.supportPhone })}
              </a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
