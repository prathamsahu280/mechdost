import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { UstaadJoinFlow } from '@/components/ustaad/join/join-flow';
import type { Locale } from '@/i18n/routing';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams?: Promise<{ from?: string }>;
}

const CODE_RE = /^[A-Z0-9-]{6,40}$/;

/**
 * `/ustaad/join` (spec 23 § 4 flow 1, § 5): the 5-step join, the same component as `/partners/apply/mechanic`.
 * `?from=<application code>` comes from an invite for an old mechanic application (§ 4a); the API checks it against
 * the joining phone, so a code alone unlocks nothing.
 */
export default async function UstaadJoinPage({ params, searchParams }: Props) {
  await guardUstaadPage();
  const { locale } = await params;
  const from = (await searchParams)?.from;
  const t = await getTranslations({ locale, namespace: 'ustaad.join' });
  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <div>
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <p className="mt-1 text-base text-ink-muted">{t('lead')}</p>
      </div>
      <div className="rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-7">
        <ClientMessages namespaces={['ustaad.join']}>
          <UstaadJoinFlow via="ustaad" fromApplication={from && CODE_RE.test(from) ? from : undefined} />
        </ClientMessages>
      </div>
    </div>
  );
}
