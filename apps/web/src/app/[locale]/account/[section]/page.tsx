import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ACCOUNT_SECTIONS, type AccountSection } from '@/lib/sections';
import { routing, type Locale } from '@/i18n/routing';
import { AccountShell } from '../account-shell';

type Section = Exclude<AccountSection, 'overview'>;
const SECTIONS = ACCOUNT_SECTIONS.filter((s): s is Section => s !== 'overview');
const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s);

interface Props {
  params: Promise<{ locale: Locale; section: string }>;
}

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => SECTIONS.map((section) => ({ locale, section })));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, section } = await params;
  if (!isSection(section)) return {};
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t(`nav_${section}`), robots: { index: false } };
}

/** Account sections: orders, service requests, bulk quotes, vehicles, addresses, profile (spec 01). */
export default async function AccountSectionPage({ params }: Props) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  return <AccountShell section={section} />;
}
