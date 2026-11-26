/**
 * SERVER ONLY (reads the locale files): the name of a usage metric for a bell notice or an email, in the person's
 * language, from the same `adminUsage` keys the admin page shows (hard rule 10). The website uses next-intl instead.
 */
import en from './i18n/en.json';
import hi from './i18n/hi.json';
import { USAGE_METRICS, type UsageMetricCode } from './usage';

type Copy = Record<string, string>;
const tree = (locale: 'en' | 'hi'): Copy => (locale === 'hi' ? hi.adminUsage : en.adminUsage);

/** "Cloudflare R2 (Ustaad media): Storage" / "Cloudflare R2 (उस्ताद मीडिया): स्टोरेज". */
export function usageMetricName(code: UsageMetricCode, locale: 'en' | 'hi'): string {
  const c = tree(locale);
  const provider = c[`provider_${USAGE_METRICS[code].provider}`] ?? USAGE_METRICS[code].provider;
  const metric = c[`metric_${code}`] ?? code;
  return `${provider}: ${metric}`;
}
