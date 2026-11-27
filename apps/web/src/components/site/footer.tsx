import { Bike, Globe, MessageCircle, Moon, Phone, Store, Sun, UserRound, Wrench } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { CATEGORY_SLUGS } from '@/demo/catalogue';
import { site, whatsappLink } from '@/lib/site';
import { LocalLink } from '../ui/local-link';
import { CompanyCopyright, CompanyLegal } from './company-legal';
import { ConsentChoicesButton } from './consent-banner';
import { BrandMark } from './header';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';
import { DATA_MODE, QUOTES_AVAILABLE } from '@/lib/data-mode';

interface FooterLink {
  href: string;
  label: string;
  track: string;
  /** A small icon tile before the label (the "For partners" panel). */
  icon?: ReactNode;
}

/** Policy pages, in the concept's order (company, privacy, delivery, returns, service terms); Terms of Service added
 * 2026-11-14 (Meta needs it at /terms). */
const POLICY_LINKS = [
  { href: '/policies/company', label: 'companyPolicy', track: 'footer_company_policy' },
  { href: '/terms', label: 'termsOfService', track: 'footer_terms' },
  { href: '/policies/privacy', label: 'privacyPolicy', track: 'footer_privacy_policy' },
  { href: '/policies/delivery', label: 'deliveryPolicy', track: 'footer_delivery_policy' },
  { href: '/policies/returns', label: 'returnsPolicy', track: 'footer_returns_policy' },
  { href: '/policies/service-terms', label: 'serviceTerms', track: 'footer_service_terms' },
] as const;

const linkClass =
  'inline-flex min-h-10 min-w-6 items-center gap-[9px] rounded-lg text-sm text-muted underline-offset-4 hover:text-ink hover:underline';

/**
 * Site footer (v4, user-approved design 2026-11-23): one rounded card. The top holds the help card (WhatsApp/call)
 * beside five link columns (shop, vehicle care, account, business, and "For partners" in a softly tinted panel with
 * small icon tiles); then a row with the logo, the operator, GSTIN and registered office (confirmed by the user, inbox
 * Q15) and the language and dark-mode buttons; then the policy links, privacy choices, credits and copyright.
 * Server-only apart from the two buttons. Link lists become admin-editable navigation in Phase 1 (rule 8, spec 08).
 */
export function Footer({ roadside = false }: { roadside?: boolean }) {
  const t = useTranslations('footer');
  const consent = useTranslations('consent');
  const wa = useTranslations('whatsapp');
  const theme = useTranslations('theme');
  const nav = useTranslations('nav');
  const cat = useTranslations('categories');
  const account = useTranslations('account');
  const partners = useTranslations('pages.partners');
  const chrome = useTranslations('chrome');
  const locale = useLocale();
  const language = useTranslations('language');
  const tile = (icon: ReactNode) => (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent-soft-text transition-transform group-hover/link:scale-110"
    >
      {icon}
    </span>
  );

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
        // Offers come from the API (the demo build has none), so the link exists only in real data mode.
        ...(DATA_MODE === 'api' ? [{ href: '/offers', label: nav('offers'), track: 'footer_offers' }] : []),
        ...(QUOTES_AVAILABLE ? [{ href: '/quotes/new', label: t('bulkPrice'), track: 'footer_bulk' }] : []),
      ],
    },
    {
      id: 'care',
      title: t('colCare'),
      links: [
        { href: '/workshops', label: nav('workshops'), track: 'footer_workshops' },
        // Only where the city has roadside on (spec 22, 2026-11-24).
        ...(roadside ? [{ href: '/roadside', label: nav('roadside'), track: 'footer_roadside' }] : []),
        { href: '/account/vehicles', label: nav('vehicles'), track: 'footer_vehicles' },
        { href: '/account/services', label: account('nav_services'), track: 'footer_services' },
      ],
    },
    {
      id: 'account',
      title: t('colAccount'),
      links: [
        // The account area (sign-in card when signed out): the footer is static, so it cannot say "Sign in" only to
        // signed-out visitors (UI review 2026-11-14).
        { href: '/account', label: nav('account'), track: 'footer_account' },
        { href: '/account/orders', label: t('trackOrder'), track: 'footer_orders' },
        ...(QUOTES_AVAILABLE
          ? [{ href: '/account/quotes', label: account('nav_quotes'), track: 'footer_quotes' }]
          : []),
        { href: '/cart', label: nav('cart'), track: 'footer_cart' },
      ],
    },
    {
      // Design 2026-11-22: the trade and fleet entry points (landing pages) and bulk orders.
      id: 'business',
      title: t('colBusiness'),
      links: [
        { href: '/business/garages', label: t('businessGarages'), track: 'footer_business_garages' },
        { href: '/business/fleets', label: t('businessFleets'), track: 'footer_business_fleets' },
        ...(QUOTES_AVAILABLE
          ? [{ href: '/quotes/new', label: t('bulkPrice'), track: 'footer_business_bulk' }]
          : []),
      ],
    },
  ];

  const partnerLinks: FooterLink[] = [
    {
      href: '/partners/apply/seller',
      label: partners('sellerAction'),
      track: 'footer_apply_seller',
      icon: tile(<Store size={15} strokeWidth={1.9} />),
    },
    {
      href: '/partners/apply/garage',
      label: partners('garageAction'),
      track: 'footer_apply_garage',
      icon: tile(<Wrench size={15} strokeWidth={1.9} />),
    },
    {
      href: '/partners/apply/mechanic',
      label: partners('mechanicAction'),
      track: 'footer_apply_mechanic',
      icon: tile(<UserRound size={15} strokeWidth={1.9} />),
    },
    {
      href: '/partners/apply/delivery_agent',
      label: partners('delivery_agentAction'),
      track: 'footer_apply_delivery_agent',
      icon: tile(<Bike size={15} strokeWidth={1.9} />),
    },
  ];

  return (
    <footer className="mx-auto mt-16 mb-10 max-w-[1320px] px-2.5 tab:px-5">
      <div className="overflow-hidden rounded-3xl bg-surface shadow-float">
        <div className="grid gap-9 p-5 tab:p-8 min-[1100px]:grid-cols-[minmax(260px,320px)_1fr]">
          <section
            aria-labelledby="footer-help"
            className="rounded-[18px] border border-whatsapp-line bg-whatsapp-bg p-[22px] min-[1100px]:self-start"
          >
            <h2 id="footer-help" className="font-heading text-lg leading-tight font-extrabold text-ink">
              {t('helpTitle')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t('helpBody')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={whatsappLink(wa('general'))}
                target="_blank"
                rel="noopener noreferrer"
                data-track="footer_whatsapp"
                className="press inline-flex min-h-11 items-center gap-2 rounded-xl bg-whatsapp px-3.5 text-sm font-bold text-white hover:brightness-110"
              >
                <MessageCircle aria-hidden="true" size={18} strokeWidth={1.9} />
                {t('whatsapp', { phone: site.supportPhone })}
                <span className="sr-only"> ({t('whatsappNote')})</span>
              </a>
              <a
                href={`tel:${site.supportPhoneE164}`}
                data-track="footer_call"
                className="press inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface px-3.5 text-sm font-bold text-ink ring-1 ring-line hover:bg-pill"
              >
                <Phone aria-hidden="true" size={18} strokeWidth={1.9} />
                {t('call')}
              </a>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-x-[22px] gap-y-8 tab:grid-cols-3 min-[1100px]:grid-cols-[repeat(4,minmax(0,1fr))_minmax(210px,1.35fr)]">
            {columns.map((col) => (
              <nav key={col.id} aria-labelledby={`footer-col-${col.id}`}>
                <h2
                  id={`footer-col-${col.id}`}
                  className="mt-1 mb-3 font-heading text-sm font-extrabold text-ink"
                >
                  {col.title}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <LocalLink href={link.href} data-track={link.track} className={linkClass}>
                        {link.label}
                      </LocalLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
            <nav
              aria-labelledby="footer-col-partners"
              className="col-span-full rounded-2xl bg-bg px-3.5 pt-3.5 pb-3 ring-1 ring-line min-[1100px]:col-span-1 min-[1100px]:-mt-3.5 min-[1100px]:-mr-1.5 min-[1100px]:-ml-1.5"
            >
              <h2 id="footer-col-partners" className="mb-3 font-heading text-sm font-extrabold text-ink">
                {t('partnersLabel')}
              </h2>
              <ul className="flex flex-col gap-0.5 tab:grid tab:grid-cols-2 min-[1100px]:flex">
                {partnerLinks.map((link) => (
                  <li key={link.href}>
                    <LocalLink
                      href={link.href}
                      data-track={link.track}
                      className={`${linkClass} group/link leading-snug font-semibold text-ink`}
                    >
                      {link.icon}
                      {link.label}
                    </LocalLink>
                  </li>
                ))}
              </ul>
              <LocalLink
                href="/partners"
                data-track="footer_partners"
                className="mt-2 inline-flex min-h-10 items-center text-[13px] font-bold whitespace-nowrap text-accent-soft-text underline-offset-4 hover:underline"
              >
                {chrome('howPartnering')}
              </LocalLink>
            </nav>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[18px] border-t border-line p-5 tab:px-8 tab:py-5">
          <div className="space-y-2">
            <BrandMark variant="footer" />
            <p className="max-w-xl text-sm text-muted">{t('accountNote')}</p>
            <CompanyLegal locale={locale} />
          </div>
          {/* Language switch lives here and in the account menu (user 2026-11-22), next to the dark-mode button. */}
          <div className="flex flex-wrap gap-2">
            <LanguageSwitcher
              target={locale === 'hi' ? 'en' : 'hi'}
              text={language('other')}
              icon={<Globe size={17} strokeWidth={1.9} />}
            />
            <ThemeToggle
              label={theme('toggle')}
              icon={
                <>
                  <Moon size={17} strokeWidth={1.9} className="theme-icon-moon" />
                  <Sun size={17} strokeWidth={1.9} className="theme-icon-sun" />
                </>
              }
            />
          </div>
        </div>

        <div className="border-t border-line px-5 py-3 tab:px-8">
          <nav aria-label={t('policiesLabel')}>
            <ul className="flex flex-wrap gap-x-[18px]">
              {POLICY_LINKS.map((link) => (
                <li key={link.href}>
                  <LocalLink
                    href={link.href}
                    data-track={link.track}
                    className="inline-flex min-h-10 items-center text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
                  >
                    {t(link.label)}
                  </LocalLink>
                </li>
              ))}
              <li>
                <ConsentChoicesButton label={consent('choices')} />
              </li>
            </ul>
          </nav>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('credits')}</p>
          <CompanyCopyright locale={locale} />
        </div>
      </div>
    </footer>
  );
}
