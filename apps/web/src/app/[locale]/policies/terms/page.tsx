import {
  BadgeCheck,
  Coins,
  FileText,
  Hand,
  PackageCheck,
  PackageX,
  RefreshCw,
  Scale,
  ShieldCheck,
  Store,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { PolicySections } from '@/components/ui/policy-sections';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { companyFacts } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.terms' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/policies/terms', locale),
  };
}

const SECTIONS = [
  { key: 'about', icon: FileText },
  { key: 'account', icon: UserRound },
  { key: 'marketplace', icon: Store },
  { key: 'orders', icon: BadgeCheck },
  { key: 'delivery', icon: PackageCheck },
  { key: 'returns', icon: PackageX },
  { key: 'coins', icon: Coins },
  { key: 'fair', icon: Hand },
  { key: 'responsibility', icon: ShieldCheck },
  { key: 'law', icon: Scale },
  { key: 'changes', icon: RefreshCw },
] as const;

/**
 * Terms of use (user 2026-11-10: "add a terms and policy section too"). Written from the product's own rules —
 * shop routing and acceptance, delivery code, no returns but faulty-part help (spec 05), Coins never a wallet
 * (spec 20), account blocks with a reason, Raipur jurisdiction — so it never promises what the product does not
 * do. Needs a lawyer's review before launch (questions-for-user Q69). Admin-editable as `policy.terms` (spec 08).
 */
export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.terms');
  const { company, registeredAddress } = companyFacts(locale);
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <PolicySections
        sections={SECTIONS.map(({ key, icon }) => ({
          icon,
          title: t(`${key}Title`),
          body: t(`${key}Body`, { company, address: registeredAddress }),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_terms_call"
      />
    </Container>
  );
}
