import { MessageCircle, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { companyFacts, site, whatsappLink } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.company' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/policies/company', locale),
  };
}

/**
 * Company & contact (concept policy, Consumer Protection (E-Commerce) Rules 2020: operator, registered office,
 * GSTIN, contact and how complaints are handled). Facts come from `lib/site.ts` (one place; moves to admin
 * settings with the CMS). The grievance officer's name joins when confirmed (inbox Q15b).
 */
export default async function CompanyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.company');
  const wa = await getTranslations('whatsapp');
  const { company, registeredAddress } = companyFacts(locale);
  const facts = [
    { label: t('companyLabel'), value: company },
    { label: t('officeLabel'), value: registeredAddress },
    { label: t('gstinLabel'), value: site.gstin },
  ];
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <div className="mt-10 grid max-w-4xl gap-4">
        <dl className="grid gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-bold tracking-wide text-muted uppercase">{f.label}</dt>
              <dd className="mt-1 font-heading text-base font-bold text-ink">{f.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs font-bold tracking-wide text-muted uppercase">{t('phoneLabel')}</dt>
            <dd className="mt-1 flex flex-wrap gap-x-4">
              <a
                href={`tel:${site.supportPhoneE164}`}
                data-track="policy_company_call"
                className="inline-flex min-h-11 items-center gap-2 font-heading font-bold text-ink underline-offset-4 hover:underline"
              >
                <Phone aria-hidden="true" className="size-4" />
                {site.supportPhone}
              </a>
              <a
                href={whatsappLink(wa('general'))}
                data-track="policy_company_whatsapp"
                className="inline-flex min-h-11 items-center gap-2 font-heading font-bold text-ink underline-offset-4 hover:underline"
              >
                <MessageCircle aria-hidden="true" className="size-4" />
                {t('whatsapp')}
              </a>
            </dd>
          </div>
        </dl>
        <section
          aria-labelledby="complaints-title"
          className="flex gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
        >
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-[24px]"
          >
            🛟
          </span>
          <div>
            <h2 id="complaints-title" className="font-heading text-lg font-extrabold text-ink">
              {t('complaintsTitle')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t('complaintsBody')}</p>
          </div>
        </section>
      </div>
      <p className="mt-6 max-w-4xl text-xs text-muted">{t('updated')}</p>
    </Container>
  );
}
