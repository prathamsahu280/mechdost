'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AUTH_MODE } from '@/lib/auth/mode';

/** Real sign-in builds read the slip through the API; demo builds have no slip. Loaded only on this page. */
const PackingSlipApi = dynamic(() => import('./shop-slip-api').then((m) => m.PackingSlipApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 max-w-xl rounded-card" aria-hidden="true" />,
});

export function SlipScreen({ code }: { code: string }) {
  const t = useTranslations('shopTier2');
  if (AUTH_MODE !== 'firebase' || code === '')
    return <p className="text-sm text-muted">{t('slipDemoOnly')}</p>;
  return <PackingSlipApi code={code} />;
}
