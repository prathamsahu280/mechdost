import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { companyFactsFor } from '@/lib/company-facts';

/**
 * Server-only pieces of the footer's legal block, filled from the admin's company details (design 2026-11-15 item
 * 8; Consumer Protection (E-Commerce) Rules 2020). Zero client JavaScript: each one is plain HTML from the server.
 * The CIN and the grievance officer appear only once the admin has filled them in.
 */
export async function CompanyLegal({ locale }: { locale: Locale }) {
  const [t, c, facts] = await Promise.all([
    getTranslations({ locale, namespace: 'footer' }),
    getTranslations({ locale, namespace: 'siteCompany' }),
    companyFactsFor(locale),
  ]);
  const g = facts.grievance;
  return (
    <p className="text-xs leading-relaxed text-muted">
      {t('operatedBy')} <span className="font-bold text-ink uppercase">{facts.company}</span>
      <br />
      {t('gstin', { gstin: facts.gstin })}
      {facts.cin ? (
        <>
          <br />
          {c('cin', { cin: facts.cin })}
        </>
      ) : null}
      <br />
      {t('registered', { address: facts.registeredAddress })}
      {g ? (
        <>
          <br />
          <span className="font-bold text-ink">{c('grievanceTitle')}</span>
          {g.name ? <> {g.name}</> : null}
          {g.email ? (
            <>
              {' · '}
              <a
                href={`mailto:${g.email}`}
                data-track="footer_grievance_email"
                className="underline-offset-4 hover:underline"
              >
                {g.email}
              </a>
            </>
          ) : null}
          {g.phone ? (
            <>
              {' · '}
              <a
                href={`tel:${g.phone}`}
                data-track="footer_grievance_phone"
                className="underline-offset-4 hover:underline"
              >
                {g.phone}
              </a>
            </>
          ) : null}
        </>
      ) : null}
    </p>
  );
}

/** The copyright line with the operator's name as the admin set it. */
export async function CompanyCopyright({ locale }: { locale: Locale }) {
  const [t, facts] = await Promise.all([
    getTranslations({ locale, namespace: 'footer' }),
    companyFactsFor(locale),
  ]);
  return (
    <p className="mt-2 text-xs text-muted">
      {t('copyright', { year: new Date().getFullYear(), company: facts.company })}
    </p>
  );
}

/** The grievance officer card under a policy page; renders nothing until the admin fills a detail. */
export async function GrievanceOfficer({ locale }: { locale: Locale }) {
  const [c, facts] = await Promise.all([
    getTranslations({ locale, namespace: 'siteCompany' }),
    companyFactsFor(locale),
  ]);
  const g = facts.grievance;
  if (!g) return null;
  return (
    <section
      aria-labelledby="grievance-officer"
      className="mt-6 max-w-4xl rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
    >
      <h2 id="grievance-officer" className="font-heading text-lg font-extrabold text-ink">
        {c('grievanceTitle')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{c('grievanceLead')}</p>
      <ul className="mt-3 grid gap-1 text-sm text-ink">
        {g.name ? <li className="font-bold">{g.name}</li> : null}
        {g.email ? (
          <li>
            <a
              href={`mailto:${g.email}`}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              {g.email}
            </a>
          </li>
        ) : null}
        {g.phone ? (
          <li>
            <a
              href={`tel:${g.phone}`}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              {g.phone}
            </a>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
