import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/sections';
import { routing, type Locale } from '@/i18n/routing';
import { AdminShell } from '../admin-shell';

type Section = Exclude<AdminSection, 'overview'>;
const SECTIONS = ADMIN_SECTIONS.filter((s): s is Section => s !== 'overview');
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
  const t = await getTranslations({ locale, namespace: 'portal' });
  return { title: t(`nav_${section}`), robots: { index: false } };
}

export default async function AdminSectionPage({ params }: Props) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  return <AdminShell section={section} />;
}
