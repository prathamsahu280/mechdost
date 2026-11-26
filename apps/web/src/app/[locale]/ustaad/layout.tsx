import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui/button-link';
import { Container, EmptyState } from '@/components/ui/page-intro';
import { UstaadIcon } from '@/components/ustaad/shell/icons';
import { UstaadGate } from '@/components/ustaad/shell/ustaad-gate';
import { UstaadNav, type UstaadTab } from '@/components/ustaad/shell/ustaad-nav';
import { UstaadPublicSwitch } from '@/components/ustaad/shell/public-switch';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';
import { publishedUstaadAccess } from '@/lib/site-config-content';

/** Mechanics only: never indexed, never in the sitemap (spec 23 § 13). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
}

const TABS = [
  { key: 'home', path: '/ustaad' },
  { key: 'discover', path: '/ustaad/discover' },
  { key: 'create', path: '/ustaad/create' },
  { key: 'learn', path: '/ustaad/learn' },
  { key: 'me', path: '/ustaad/me' },
] as const;

/**
 * The Ustaad Network shell (spec 23 § 5; plan task A3): its own header, a dock of five tabs under 1024 px and a left
 * rail above, shared by every `/ustaad` page so moving between tabs never feels like a reload. The site's own dock
 * hides itself here (one tab bar per screen). Access (`ustaad.access`): `off` → a real 404; otherwise the client gate
 * shows the network to whom it may (staff during the preview) and the site's "page not found" to everyone else.
 */
export default async function UstaadLayout({ children, params }: Props) {
  const { locale } = await params;
  const access = await publishedUstaadAccess();
  if (access === 'off') notFound();
  const [t, nf] = await Promise.all([
    getTranslations({ locale, namespace: 'ustaad.shell' }),
    getTranslations({ locale, namespace: 'pages.notFound' }),
  ]);
  const tabs: UstaadTab[] = TABS.map((tab) => ({
    key: tab.key,
    path: tab.path,
    href: localePath(tab.path, locale),
    label: t(`tab_${tab.key}`),
    ...(tab.key === 'create' ? { ariaLabel: t('tab_create_aria') } : {}),
    icon: <UstaadIcon name={tab.key} size={tab.key === 'create' ? 28 : 22} />,
  }));

  const notFoundView = (
    <Container className="py-16">
      <h1 className="font-heading text-[clamp(30px,3.4vw,44px)] font-extrabold tracking-[-0.03em] text-ink">
        {nf('title')}
      </h1>
      <div className="mt-8">
        <EmptyState
          body={nf('body')}
          action={
            <ButtonLink href="/" data-track="not_found_home">
              {nf('action')}
            </ButtonLink>
          }
        />
      </div>
    </Container>
  );
  const signIn = (
    <Container className="py-16">
      <h1 className="font-heading text-[clamp(26px,3vw,38px)] font-extrabold text-ink">{t('signInTitle')}</h1>
      <div className="mt-6 max-w-2xl">
        <EmptyState
          body={t('signInBody')}
          action={
            <ButtonLink
              href={`/login?next=${encodeURIComponent(localePath('/ustaad', locale))}`}
              data-track="ustaad_sign_in"
            >
              {t('signIn')}
            </ButtonLink>
          }
        />
      </div>
    </Container>
  );
  const preview = (
    <p
      role="note"
      className="mx-auto mb-4 w-full max-w-2xl rounded-2xl border border-line-card bg-surface-alt px-4 py-3 text-sm leading-relaxed text-ink"
    >
      <strong className="font-extrabold">{t('previewTitle')}: </strong>
      {t('previewBody')}
    </p>
  );

  const extras = (['network', 'messages', 'saved'] as const).map((key) => ({
    key,
    href: localePath(`/ustaad/${key}`, locale),
    label: t(key),
    icon: <UstaadIcon name={key === 'messages' ? 'message' : key} size={22} />,
  }));

  return (
    <UstaadPublicSwitch open={children} enabled={access === 'open'}>
      <UstaadGate locale={locale} access={access} notFound={notFoundView} signIn={signIn} preview={preview}>
        <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-32 tab:px-6 nav:grid nav:grid-cols-[220px_minmax(0,1fr)] nav:gap-10 nav:pt-8 nav:pb-14">
          {/* One navigation: the dock (fixed, under 1024 px) and the rail (this column, above). */}
          <div>
            <p className="mb-5 hidden px-4 nav:block">
              <span className="block font-heading text-lg font-extrabold text-ink">{t('brand')}</span>
              <span className="block text-sm text-muted">{t('tagline')}</span>
            </p>
            <UstaadNav tabs={tabs} extras={extras} label={t('navLabel')} />
          </div>
          <div className="min-w-0">
            <header className="mb-4 flex items-center justify-between gap-3 nav:hidden">
              <p>
                <span className="block font-heading text-lg font-extrabold text-ink">{t('brand')}</span>
                <span className="block text-[13px] text-muted">{t('tagline')}</span>
              </p>
              <span className="flex gap-2">
                <Link
                  href={localePath('/ustaad/messages', locale)}
                  aria-label={t('messages')}
                  data-track="ustaad_header_messages"
                  className="press inline-flex size-12 items-center justify-center rounded-full bg-surface text-ink shadow-card focus-visible:outline-3 focus-visible:outline-focus"
                >
                  <UstaadIcon name="message" />
                </Link>
                <Link
                  href={localePath('/notifications', locale)}
                  aria-label={t('bell')}
                  data-track="ustaad_bell"
                  className="press inline-flex size-12 items-center justify-center rounded-full bg-surface text-ink shadow-card focus-visible:outline-3 focus-visible:outline-focus"
                >
                  <UstaadIcon name="bell" />
                </Link>
              </span>
            </header>
            {children}
          </div>
        </div>
      </UstaadGate>
    </UstaadPublicSwitch>
  );
}
