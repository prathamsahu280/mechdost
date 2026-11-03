import type { Metadata, Viewport } from 'next';
import { DM_Sans, Manrope, Noto_Sans_Devanagari } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { assistantCopy } from '@/assistant/server-copy';
import { AssistantLauncher } from '@/components/assistant/assistant-launcher';
import { AnalyticsListener } from '@/components/site/analytics-listener';
import { ConsentBanner } from '@/components/site/consent-banner';
import { Footer } from '@/components/site/footer';
import { AnnouncementBar, Header } from '@/components/site/header';
import { MobileTabBar } from '@/components/site/mobile-tab-bar';
import { routing } from '@/i18n/routing';
import { PRIMARY_NAV } from '@/lib/nav';
import { site } from '@/lib/site';
import { SITE_LAYOUT_SCRIPT } from '@/lib/site-layout';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';
import { localePath } from '@/lib/locale-path';

const manrope = Manrope({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-manrope' });
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-dm-sans' });
// Devanagari glyphs download only when Hindi text renders (unicode-range), so it is not preloaded.
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600', '700'],
  variable: '--font-devanagari',
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#101f34' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1424' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'meta' });
  const city = (await getTranslations({ locale, namespace: 'cities' }))(site.defaultCity);
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    title: { default: t('title'), template: `%s · MechDost` },
    description: t('description', { city }),
    applicationName: 'MechDost',
    openGraph: { siteName: 'MechDost', locale: locale === 'hi' ? 'hi_IN' : 'en_IN', type: 'website' },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations('common');
  const nav = await getTranslations('nav');
  const tabs = await getTranslations('tabs');
  // next-intl stays on the server: client islands get localised hrefs and translated labels as props, so no
  // i18n runtime or message catalogue ships to the browser (spec 16 JS budget).
  const localised = (href: string) => localePath(href, locale);
  const navItems = PRIMARY_NAV.map((item) => ({ ...item, href: localised(item.href), label: nav(item.key) }));
  const tabItems = PRIMARY_NAV.map((item) => ({
    ...item,
    href: localised(item.href),
    label: tabs(item.key),
  }));
  const city = (await getTranslations('cities'))(site.defaultCity);
  const consent = await getTranslations('consent');

  return (
    // suppressHydrationWarning: the pre-paint script may set data-theme before React hydrates.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${manrope.variable} ${dmSans.variable} ${devanagari.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Admin home layout (demo, browser-stored) applied as CSS before first paint — no React JS. */}
        <script dangerouslySetInnerHTML={{ __html: SITE_LAYOUT_SCRIPT }} />
      </head>
      <body>
        <a
          href="#content"
          className="sr-only z-50 rounded-button bg-navy px-4 py-3 text-sm font-bold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          {t('skipToContent')}
        </a>
        <AnnouncementBar city={city} />
        <Header navItems={navItems} />
        <main id="content" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <Footer />
        <MobileTabBar label={tabs('label')} items={tabItems} />
        <AssistantLauncher copy={await assistantCopy(locale)} />
        <AnalyticsListener locale={locale} />
        <ConsentBanner
          copy={{
            label: consent('label'),
            title: consent('title'),
            body: consent('body'),
            allow: consent('allow'),
            essential: consent('essential'),
            policy: consent('policy'),
            policyHref: localised('/policies/privacy'),
          }}
        />
      </body>
    </html>
  );
}
