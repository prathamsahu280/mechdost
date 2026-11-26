'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { deliveryErrorKey } from '@/lib/delivery/view';

/** Error copy for an API code: the contract's `delivery.errors.*` when it has one, else a generic line. */
export function useDeliveryErrorText(): (code: string) => string {
  const t = useTranslations('deliveryAgent');
  const e = useTranslations('delivery.errors');
  return useCallback(
    (code: string) => {
      const key = deliveryErrorKey(code);
      return key ? e(key, { attemptsLeft: 0 }) : code === 'NOT_FOUND' ? t('noJob') : t('genericError');
    },
    [e, t],
  );
}
