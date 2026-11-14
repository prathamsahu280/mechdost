'use client';

import { useTranslations } from 'next-intl';
import { homeErrorKey } from '@/lib/home-service-views';
import { serviceErrorKey } from '@/lib/service-views';

/**
 * An API error in the service screens' words (`request.api_err_*`, or `homeService.err_*` for the home servicing
 * codes), for the workshop portal and admin.
 */
export function ServiceApiError({ code, id }: { code: string; id?: string }) {
  const r = useTranslations('request');
  const h = useTranslations('homeService');
  const home = homeErrorKey(code);
  return (
    <p id={id} role="alert" className="text-sm font-bold text-error">
      {home ? h(home as 'err_NO_MOVE') : r(serviceErrorKey(code) as 'api_err_generic')}
    </p>
  );
}
