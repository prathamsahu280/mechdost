import { MessageCircle, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CATEGORY_SLUGS } from '@/demo/catalogue';
import { site, whatsappLink } from '@/lib/site';
import { ExternalButtonLink } from '../ui/button-link';
import { LocalLink } from '../ui/local-link';
import { BrandMark } from './header';
import { ThemeToggle } from './theme-toggle';

interface FooterLink {
  href: string;
  label: string;
  track: string;
}

/**
 * Site footer: help card (WhatsApp/call) beside four link columns (shop, vehicle care, account, partners), then a
 * legal row with the operator, GSTIN and registered office (confirmed by the user, inbox Q15), theme toggle and
 * credits. Server-only. Policy links join when the CMS policy pages ship — no links to pages that do not exist.
 * Link lists become admin-editable navigation in Phase 1 (rule 8, spec 08).
 */
export function Footer() {
  const t = useTranslations('footer');
  const wa = useTranslations('whatsapp');
  const theme = useTranslations('theme');
  const nav = useTranslations('nav');
  const cat = useTranslations('categories');
  const account = useTranslations('account');
  const partners = useTranslations('pages.partners');
  const year = new Date().getFullYear();

  const columns: { id: string; title: string; links: FooterLink[] }[] = [
    {
      id: 'shop',
      title: t('colShop'),
      links: [
        { href: '/shop', label: t('allProducts'), track: 'footer_shop_all' },
        ...(['tyres', 'batteries', 'lubricants'] as const).map((key) => ({
          href: `/shop?category=${CATEGORY_SLUGS[key]}`,
          label: cat(key),
          track: `footer_shop_${key}`,
        })),
        { href: '/quotes/new', label: t('bulkPrice'), track: 'footer_bulk' },
      ],
    },
    {
      id: 'care',
      title: t('colCare'),
      links: [
        { href: '/workshops', label: nav('workshops'), track: 'footer_workshops' },
        { href: '/account/vehicles', label: nav('vehicles'), track: 'footer_vehicles' },
        { href: '/account/services', label: account('nav_services'), track: 'footer_services' },
      ],
    },
    {
      id: 'account',
      title: t('colAccount'),
      links: [
        { href: '/login', label: t('signIn'), track: 'footer_sign_in' },
        { href: '/account/orders', label: t('trackOrder'), track: 'footer_orders' },
        { href: '/account/quotes', label: account('nav_quotes'), track: 'footer_quotes' },
        { href: '/cart', label: nav('cart'), track: 'footer_cart' },
      ],
    },
    {
      id: 'partners',
      title: t('partnersLabel'),
      links: [
        { href: '/partners', label: t('becomePartner'), track: 'footer_partners' },
        { href: '/partners/apply/seller', label: partners('sellerAction'), track: 'footer_apply_seller' },
        { href: '/partners/apply/garage', label: partners('garageAction'), track: 'footer_apply_garage' },
        {
          href: '/partners/apply/mechanic',
          label: partners('mechanicAction'),
          track: 'footer_apply_mechanic',
        },
      ],
    },
  ];

  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-[5%] pt-12 pb-8 nav:grid-cols-[minmax(280px,340px)_1fr]">
        <section
          aria-labelledby="footer-help"
          className="rounded-card border border-whatsapp-line bg-whatsapp-bg p-6 nav:self-start"
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

        <div className="grid grid-cols-2 gap-x-6 gap-y-8 tab:grid-cols-4">
          {columns.map((col) => (
            <nav key={col.id} aria-labelledby={`footer-col-${col.id}`}>
              <h2 id={`footer-col-${col.id}`} className="text-sm font-extrabold text-ink">
                {col.title}
              </h2>
              <ul className="mt-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <LocalLink
                      href={link.href}
                      data-track={link.track}
                      className="inline-flex min-h-11 min-w-11 items-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
                    >
                      {link.label}
                    </LocalLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-[5%] pb-10">
        <div className="grid gap-6 border-t border-line pt-8 nav:grid-cols-[1fr_auto] nav:items-start">
          <div className="space-y-3">
            <BrandMark />
            <p className="max-w-xl text-sm text-muted">{t('accountNote')}</p>
            <p className="text-xs leading-relaxed text-muted">
              {t('operatedBy')} <span className="font-bold text-ink uppercase">{site.company}</span>
              <br />
              {t('gstin', { gstin: site.gstin })}
              <br />
              {t('registered', { address: site.registeredAddress })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle label={theme('toggle')} className="border border-line-card" />
            <span aria-hidden="true" className="text-sm text-muted">
              {theme('toggle')}
            </span>
          </div>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-muted">{t('credits')}</p>
        <p className="mt-2 text-xs text-muted">{t('copyright', { year, company: site.company })}</p>
      </div>
    </footer>
  );
}
