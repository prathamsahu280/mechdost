'use client';

import { useTranslations } from 'next-intl';

const ERROR_CODES = [
  'SLOT_FULL',
  'SLOT_CLOSED',
  'SLOT_PAST',
  'RESCHEDULE_LIMIT',
  'RESCHEDULE_SAME',
  'DATE_OUT_OF_RANGE',
  'CAPACITY_BELOW_BOOKED',
  'CHANGE_PENDING',
  'STALE_WORKSHOP',
] as const;

export const isTier1Error = (code: string) => (ERROR_CODES as readonly string[]).includes(code);

/** An API error in the words of the workshops tier 1 screens (hourly slots, reschedule, My workshop). */
export function Tier1Error({ code, id }: { code: string; id?: string }) {
  const t = useTranslations('workshopTier1');
  const known = ERROR_CODES.find((c) => c === code);
  return (
    <p id={id} role="alert" className="text-sm font-bold text-error">
      {known ? t(`err_${known}`) : t('err_generic')}
    </p>
  );
}
