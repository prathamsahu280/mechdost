import { Check, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ButtonLink } from '@/components/ui/button-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor, openGraphFor } from '@/lib/seo';
import { site } from '@/lib/site';
import { SettingValue } from '@/components/site/site-overrides';
import { TrustLine } from '@/components/site/trust-line';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const [t, regions] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'regions' }),
  ]);
  const region = regions(site.defaultRegion);
  const title = t('partnersTitle', { region });
  const description = t('partnersDescription', { region });
  return {
    title,
    description,
    alternates: alternatesFor('/partners', locale),
    openGraph: openGraphFor({ href: '/partners', locale, title, description }),
  };
}

const KINDS = [
  { kind: 'seller', emoji: '🏪' },
  { kind: 'garage', emoji: '🔧' },
  { kind: 'mechanic', emoji: '🛠️' },
] as const;
const POINTS = [1, 2, 3] as const;
const STEPS = [
  { n: 1, emoji: '📝' },
  { n: 2, emoji: '✅' },
  { n: 3, emoji: '⚙️' },
  { n: 4, emoji: '🚀' },
] as const;

/**
 * Partner programme (spec 07): what each partner type gets, then how joining works. Each card opens the
 * application form for that partner type. Server-only; copy moves to admin content blocks in Phase 1 (rule 8).
 */
export default async function PartnersPage() {
  const t = await getTranslations('pages.partners');

  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <ul className="mt-10 grid gap-4 nav:grid-cols-3">
        {KINDS.map(({ kind, emoji }) => (
          <li
            key={kind}
            className="flex flex-col rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-7"
          >
            <span
              aria-hidden="true"
              className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-[28px]"
            >
              {emoji}
            </span>
            <h2 className="mt-5 font-heading text-xl font-extrabold text-ink">{t(`${kind}Title`)}</h2>
            <p className="mt-2 text-sm text-muted">{t(`${kind}Body`)}</p>
            {kind === 'seller' ? (
              <TrustLine placement="partner" className="mt-3 text-sm font-bold text-accent-soft-text" />
            ) : null}
            <ul className="mt-5 flex-1 space-y-3 border-t border-line pt-5">
              {POINTS.map((n) => (
                <li key={n} className="flex gap-3 text-sm text-ink">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={3} />
                  {t.rich(`${kind}Point${n}`, {
                    region,
                    min: (chunks) => <SettingValue setting="acceptMinutes" fallback={chunks} />,
                  })}
                </li>
              ))}
            </ul>
            <ButtonLink
              href={`/partners/apply/${kind}`}
              data-track={`partners_apply_${kind}`}
              className="mt-7 self-start"
            >
              {t(`${kind}Action`)}
            </ButtonLink>
          </li>
        ))}
      </ul>

      <section
        aria-labelledby="partner-steps"
        className="mt-14 rounded-card border border-line-card bg-surface-alt p-6 tab:p-10"
      >
        <h2
          id="partner-steps"
          className="font-heading text-[clamp(24px,2.4vw,32px)] font-extrabold tracking-[-0.03em] text-ink"
        >
          {t('stepsTitle')}
        </h2>
        <ol className="mt-6 grid gap-4 tab:grid-cols-2 nav:grid-cols-4">
          {STEPS.map(({ n, emoji }) => (
            <li key={n} className="rounded-tile border border-line-card bg-surface p-5">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="text-[24px] leading-none">
                  {emoji}
                </span>
                <span className="text-xs font-bold text-accent-soft-text">{t('stepLabel', { n })}</span>
              </div>
              <h3 className="mt-3 font-heading text-lg font-extrabold text-ink">{t(`step${n}Title`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`step${n}Body`, { region })}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 flex flex-wrap items-center gap-x-2 text-sm text-muted">
          {t('helpLine')}
          <a
            href={`tel:${site.supportPhoneE164}`}
            data-track="partners_call"
            className="inline-flex min-h-11 items-center gap-2 font-bold text-ink underline-offset-4 hover:underline"
          >
            <Phone aria-hidden="true" className="size-4" />
            {site.supportPhone}
          </a>
        </p>
      </section>
    </Container>
  );
}
