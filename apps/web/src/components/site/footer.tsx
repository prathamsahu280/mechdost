import { MessageCircle, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LocalLink } from '../ui/local-link';
import { site, whatsappLink } from '@/lib/site';
import { ExternalButtonLink } from '../ui/button-link';
import { BrandMark } from './header';
import { ThemeToggle } from './theme-toggle';

/**
 * Footer content from the concept (WhatsApp/call block, partners, brand, operator, credits). The concept's
 * cramped single row is rebuilt as a responsive grid. Policy links join when the CMS policy pages ship
 * (docs/progress.md) — no links to pages that do not exist yet.
 */
export function Footer() {
  const t = useTranslations('footer');
  const wa = useTranslations('whatsapp');
  const theme = useTranslations('theme');
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-[5%] py-12 tab:grid-cols-[minmax(280px,360px)_1fr]">
        <section
          aria-labelledby="footer-help"
          className="rounded-card border border-whatsapp-line bg-whatsapp-bg p-6"
        >
          <h2 id="footer-help" className="font-heading text-[17px] font-extrabold text-ink">
            {t('helpTitle')}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t('helpBody')}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ExternalButtonLink
              variant="whatsapp"
              href={whatsappLink(wa('general'))}
              target="_blank"
              rel="noopener noreferrer"
              note={t('whatsappNote')}
              data-track="footer_whatsapp"
            >
              <MessageCircle aria-hidden="true" className="mr-2 inline size-4 align-[-3px]" />
              {t('whatsapp', { phone: site.supportPhone })}
            </ExternalButtonLink>
            <a
              href={`tel:${site.supportPhoneE164}`}
              data-track="footer_call"
              className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-bold text-ink underline-offset-4 hover:underline"
            >
              <Phone aria-hidden="true" className="size-4" />
              {t('call')}
            </a>
          </div>
        </section>

        <div className="grid content-start gap-8 sm:grid-cols-2">
          <div>
            <BrandMark />
            <p className="mt-4 text-sm text-muted">{t('accountNote')}</p>
            <p className="mt-4 text-xs text-muted">
              {t('operatedBy')} <span className="font-bold text-ink uppercase">{site.company}</span>
            </p>
          </div>
          <nav aria-label={t('partnersLabel')}>
            <ul className="space-y-1">
              <li>
                <LocalLink
                  href="/partners"
                  data-track="footer_partners"
                  className="inline-flex min-h-11 items-center text-sm font-bold text-ink underline-offset-4 hover:underline"
                >
                  {t('partners')} <span aria-hidden="true">&nbsp;↗</span>
                </LocalLink>
              </li>
            </ul>
          </nav>
          <div className="flex items-center gap-2 sm:col-span-2">
            <ThemeToggle label={theme('toggle')} className="border border-line-card" />
            <span aria-hidden="true" className="text-sm text-muted">
              {theme('toggle')}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted sm:col-span-2">{t('credits')}</p>
          <p className="text-xs text-muted sm:col-span-2">
            {t('copyright', { year, company: site.company })}
          </p>
        </div>
      </div>
    </footer>
  );
}
