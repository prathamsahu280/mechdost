import { getTranslations } from 'next-intl/server';
import { fillPolicyText, type PolicyDoc } from '@mechdost/shared/policy';
import type { Locale } from '@/i18n/routing';
import { companyFactsFor } from '@/lib/company-facts';
import { policyDateLabel } from '@/lib/policy-view';
import { site } from '@/lib/site';
import { Container, PageIntro } from './page-intro';
import { PolicySections } from './policy-sections';
import { GrievanceOfficer } from '../site/company-legal';

/**
 * A policy page the admin published (Admin -> Content -> Policy pages; design 2026-11-15 item 5), rendered like the
 * built-in text: same intro, cards and call link, with `{company}`, `{address}` and `{phone}` filled in from the
 * company facts. Server-only; the page falls back to its built-in text when nothing is published.
 */
export async function PublishedPolicy({
  doc,
  locale,
  eyebrow,
  help,
  track,
}: {
  doc: PolicyDoc;
  locale: Locale;
  eyebrow: string;
  help: string;
  track: string;
}) {
  const [t, facts] = await Promise.all([
    getTranslations({ locale, namespace: 'siteCompany' }),
    companyFactsFor(locale),
  ]);
  const fill = (text: string) =>
    fillPolicyText(text, {
      company: facts.company,
      address: facts.registeredAddress,
      phone: site.supportPhone,
    });
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={eyebrow} line1={fill(doc.title)} lead={fill(doc.lead)} />
      <PolicySections
        sections={doc.sections.map((s) => ({
          emoji: s.emoji ?? '📄',
          title: fill(s.heading),
          body: fill(s.body),
        }))}
        help={help}
        updated={t('updatedOn', { date: policyDateLabel(doc.updatedOn, locale) })}
        track={track}
      />
      <GrievanceOfficer locale={locale} />
    </Container>
  );
}
