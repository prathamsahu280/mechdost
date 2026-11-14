'use client';

import { useTranslations } from 'next-intl';
import { serviceErrorKey } from '@/lib/service-views';

/** An API error in the service screens' words (`request.api_err_*`), for the workshop portal and admin. */
export function ServiceApiError({ code, id }: { code: string; id?: string }) {
  const r = useTranslations('request');
  return (
    <p id={id} role="alert" className="text-sm font-bold text-error">
      {r(serviceErrorKey(code) as 'api_err_generic')}
    </p>
  );
}
