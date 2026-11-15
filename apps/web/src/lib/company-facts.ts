import { companyFor, type CompanyFacts } from '@mechdost/shared/company';
import { publishedCompany } from '@/lib/site-config-content';
import { companyFacts, site } from '@/lib/site';

/**
 * The company facts a Server Component shows in one language: the admin's company details (Admin -> Settings ->
 * Company details) where filled, the built-in facts of `lib/site.ts` otherwise. The CIN and the grievance officer
 * are `null` until the admin fills them, so nothing is shown for them (design 2026-11-15 item 8).
 */
export async function companyFactsFor(locale: string): Promise<CompanyFacts> {
  return companyFor(await publishedCompany(), locale, { ...companyFacts(locale), gstin: site.gstin });
}
