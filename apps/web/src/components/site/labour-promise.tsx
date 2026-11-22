import { getTranslations } from 'next-intl/server';
import { DATA_MODE } from '@/lib/data-mode';
import { DemoLabourPromise } from './trust-overrides';

/**
 * The labour promise (user 2026-11-15, Q105): "{days}-day labour promise" on workshop pages, and the longer sentence
 * in the booking card. Shown only while the admin has it on. Real data mode gets the days from the API (admin
 * setting `service.labour_promise_days`, passed as `days`; null = off); the demo build reads the browser-stored demo
 * setting in a tiny island. Server Component, so nothing ships to the browser in real mode.
 */
export async function LabourPromise({
  days,
  variant = 'short',
  as = 'li',
  className,
}: {
  /** Real data mode: the API's days, or null/undefined when the promise is off. Ignored in the demo build. */
  days?: number | null;
  variant?: 'short' | 'full';
  as?: 'p' | 'li' | 'span';
  className?: string;
}) {
  const t = await getTranslations('trust');
  const key = variant === 'short' ? 'labourPromise' : 'labourPromiseBody';
  if (DATA_MODE === 'api') {
    if (!days) return null;
    const Tag = as;
    return <Tag className={className}>{t(key, { days })}</Tag>;
  }
  // The value `{days}` keeps the placeholder in the text for the browser to fill from the demo setting (`raw` would
  // return the precompiled message, spec 16 incident 2026-11-22).
  return <DemoLabourPromise template={t(key, { days: '{days}' })} as={as} className={className} />;
}
