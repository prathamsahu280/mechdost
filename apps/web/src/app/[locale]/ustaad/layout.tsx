import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BRAND_LOGO, BRAND_LOGO_SIZE } from '@/components/site/header';
import { ButtonLink } from '@/components/ui/button-link';
import { Container, EmptyState } from '@/components/ui/page-intro';
import { NeutralFrame } from '@/components/ustaad/common/shape-skeleton';
import { UstaadIcon } from '@/components/ustaad/shell/icons';
import { RouteShape, UstaadGate } from '@/components/ustaad/shell/ustaad-gate';
import { UstaadNav, type UstaadTab } from '@/components/ustaad/shell/ustaad-nav';
import { UstaadPublicSwitch } from '@/components/ustaad/shell/public-switch';
import { USTAAD_TABS } from '@/components/ustaad/shell/tabs';
import type { Locale } from '@/i18n/routing';
import { DATA_MODE } from '@/lib/data-mode';
import { localePath } from '@/lib/locale-path';
import { SIGNED_IN_HINT, ustaadHiddenOnServer } from '@/lib/signed-in-hint';
import { publishedUstaadAccess } from '@/lib/site-config-content';

/** Mechanics only: never indexed, never in the sitemap (spec 23 § 13). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
}

/** Header buttons: one class constant so the visual-language pass changes them in one place. */
const HEADER_BTN =
  'press inline-flex size-12 items-center justify-center rounded-full text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-focus';

/**
 * The Ustaad Network shell (spec 23 § 5; UI upgrade U1, design § 3.0 / § 7). Inside `/ustaad` the storefront strip,
 * site header and phone parts search step aside **in the server HTML** (the name-free `data-shell-compact` marker +
 * `html:has()` in globals.css), and one 56 px network header takes their place; the dock (Home · Ask · + Create · Jobs
 * · Me, founder Q-UI-1) sits under 1024 px and a rail above. Access (`ustaad.access`): `off` → a real 404; `open` →
 * header and dock are server-rendered (they hold no member data) and the gate wraps only the content column, showing
 * the page's shape skeleton until it knows the viewer; `staff_preview` → the gate shows a neutral frame with the final
 * geometry and no network words until it knows the viewer, then the shell for staff and testers and the site's "page
 * not found" for everyone else. Either way nothing below moves when the gate answers (CLS < 0.05).
 */
export default async function UstaadLayout({ children, params }: Props) {
  const { locale } = await params;
  const access = await publishedUstaadAccess();
  if (access === 'off') notFound();
  // SIM-B1: signed out during the staff preview → the real 404 (status, title, body), nothing of the network rendered.
  if (ustaadHiddenOnServer(access, (await cookies()).get(SIGNED_IN_HINT)?.value, DATA_MODE)) notFound();
  const [t, nf, common] = await Promise.all([
    getTranslations({ locale, namespace: 'ustaad.shell' }),
    getTranslations({ locale, namespace: 'pages.notFound' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  const tabs: UstaadTab[] = USTAAD_TABS.map((tab) => {
    const icon = tab.key === 'ask' ? 'ask' : tab.key;
    return {
      key: tab.key,
      path: tab.path,
      href: localePath(tab.path, locale),
      label: t(`tab_${tab.key}`),
      ...(tab.key === 'create' ? { ariaLabel: t('tab_create_aria') } : {}),
      icon: <UstaadIcon name={icon} size={tab.key === 'create' ? 24 : 22} />,
      iconCurrent: <UstaadIcon name={icon} size={22} filled />,
    };
  });

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
      className="mx-auto mt-6 w-full max-w-2xl rounded-2xl border border-line-card bg-surface-alt px-4 py-3 text-sm leading-relaxed text-ink"
    >
      <strong className="font-extrabold">{t('previewTitle')}: </strong>
      {t('previewBody')}
    </p>
  );

  const extras = (['discover', 'learn', 'network', 'messages', 'saved'] as const).map((key) => ({
    key,
    href: localePath(`/ustaad/${key}`, locale),
    label: t(key),
    icon: <UstaadIcon name={key === 'messages' ? 'message' : key} size={22} />,
  }));

  /** One compact network header (56 px, sticky): MechDost mark (back to the store), the network's name, Messages, bell. */
  const header = (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface/95 backdrop-blur-[14px]">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-2 px-2 tab:px-4">
        <Link
          href={localePath('/', locale)}
          aria-label={t('home_logo_aria')}
          data-track="ustaad_shell_home_logo"
          className="inline-flex min-h-12 shrink-0 items-center rounded-button px-2 focus-visible:outline-3 focus-visible:outline-focus"
        >
          <img
            src={BRAND_LOGO.light}
            alt={common('brand')}
            {...BRAND_LOGO_SIZE}
            decoding="async"
            className="brand-logo-light h-[22px] w-auto"
          />
          <img
            src={BRAND_LOGO.dark}
            alt={common('brand')}
            {...BRAND_LOGO_SIZE}
            decoding="async"
            className="brand-logo-dark h-[22px] w-auto"
          />
        </Link>
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
        <p className="min-w-0 flex-1 truncate font-heading text-[17px] leading-normal font-extrabold text-ink">
          {t('brand')}
        </p>
        <Link
          href={localePath('/ustaad/messages', locale)}
          aria-label={t('messages')}
          data-track="ustaad_header_messages"
          className={HEADER_BTN}
        >
          <UstaadIcon name="message" />
        </Link>
        <Link
          href={localePath('/notifications', locale)}
          aria-label={t('bell')}
          data-track="ustaad_bell"
          className={HEADER_BTN}
        >
          <UstaadIcon name="bell" />
        </Link>
      </div>
    </header>
  );

  const shell = (content: ReactNode) => (
    <>
      {header}
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-8 tab:px-6 nav:grid nav:grid-cols-[220px_minmax(0,1fr)] nav:gap-10 nav:pt-8 nav:pb-14">
        {/* One navigation: the dock (fixed, under 1024 px) and the rail (this column, above). */}
        <div>
          <UstaadNav tabs={tabs} extras={extras} label={t('navLabel')} />
        </div>
        <div className="min-h-[calc(100dvh-56px-64px)] min-w-0">{content}</div>
      </div>
    </>
  );
  const gate = (placeholder: ReactNode, content: ReactNode) => (
    <UstaadGate
      locale={locale}
      access={access}
      notFound={notFoundView}
      signIn={signIn}
      preview={preview}
      placeholder={placeholder}
    >
      {content}
    </UstaadGate>
  );

  return (
    <UstaadPublicSwitch open={children} enabled={access === 'open'}>
      <div>
        {/* Name-free marker: storefront chrome steps aside in the server HTML (globals.css), no shift after load. */}
        <span data-shell-compact hidden />
        {access === 'open' ? shell(gate(<RouteShape />, children)) : gate(<NeutralFrame />, shell(children))}
      </div>
    </UstaadPublicSwitch>
  );
}
