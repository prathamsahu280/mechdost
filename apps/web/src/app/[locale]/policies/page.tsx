import {
  Building2,
  ChevronRight,
  FileText,
  Lock,
  PackageX,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';
import { alternatesFor } from '@/lib/seo';
import { site } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.hub' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/policies', locale),
  };
}

interface PolicyLink {
  href: string;
  /** Key in `footer` (the page's name). */
  label:
    'termsOfUse' | 'privacyPolicy' | 'deliveryPolicy' | 'returnsPolicy' | 'serviceTerms' | 'companyPolicy';
  /** Key in `policies.hub` (one-line summary). */
  body: 'termsBody' | 'privacyBody' | 'deliveryBody' | 'returnsBody' | 'serviceBody' | 'companyBody';
  icon: LucideIcon;
  track: string;
}

/** Every policy page, in reading order. */
const POLICIES: readonly PolicyLink[] = [
  {
    href: '/policies/terms',
    label: 'termsOfUse',
    body: 'termsBody',
    icon: FileText,
    track: 'policies_terms',
  },
  {
    href: '/policies/privacy',
    label: 'privacyPolicy',
    body: 'privacyBody',
    icon: Lock,
    track: 'policies_privacy',
  },
  {
    href: '/policies/delivery',
    label: 'deliveryPolicy',
    body: 'deliveryBody',
    icon: Truck,
    track: 'policies_delivery',
  },
  {
    href: '/policies/returns',
    label: 'returnsPolicy',
    body: 'returnsBody',
    icon: PackageX,
    track: 'policies_returns',
  },
  {
    href: '/policies/service-terms',
    label: 'serviceTerms',
    body: 'serviceBody',
    icon: Wrench,
    track: 'policies_service',
  },
  {
    href: '/policies/company',
    label: 'companyPolicy',
    body: 'companyBody',
    icon: Building2,
    track: 'policies_company',
  },
];

/**
 * Terms and policies hub (user 2026-11-10: "add a terms and policy section too"): one card with a list of every
 * policy page and a one-line summary each — the same one-card list pattern as the home steps and FAQ.
 */
export default async function PoliciesPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.hub');
  const footer = await getTranslations('footer');
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <ul className="mt-10 max-w-4xl divide-y divide-line overflow-hidden rounded-card border border-line-card bg-surface shadow-card">
        {POLICIES.map((p) => (
          <li key={p.href}>
            <Link
              href={localePath(p.href, locale)}
              data-track={p.track}
              className="group flex min-h-11 items-center gap-4 p-5 transition-colors duration-[var(--duration-fast)] hover:bg-surface-alt tab:p-6"
            >
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-text"
              >
                <p.icon className="size-[22px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-heading text-lg font-extrabold text-ink">{footer(p.label)}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">{t(p.body)}</span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 text-muted transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 flex max-w-4xl flex-wrap items-center gap-x-2 text-sm text-muted">
        {t('help')}
        <a
          href={`tel:${site.supportPhoneE164}`}
          data-track="policies_call"
          className="inline-flex min-h-11 items-center font-bold text-ink underline-offset-4 hover:underline"
        >
          {site.supportPhone}
        </a>
      </p>
    </Container>
  );
}
