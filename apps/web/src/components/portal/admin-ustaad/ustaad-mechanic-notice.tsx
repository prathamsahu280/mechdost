'use client';

import { VerificationOpenCountDto } from '@mechdost/shared/ustaad/dto/verification';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { localePath } from '@/lib/locale-path';
import { adminCard } from '../admin-ui';

/**
 * Partners › Applications (spec 23 § 4a): once the Ustaad Network is open, mechanic applications go to the network,
 * so staff see where they went and how many verification requests wait in their cities. Shown only to staff who can
 * verify (`ustaad:verify`; anyone else gets 403 and sees nothing) and only while `ustaad.access` is `open`.
 */
export function UstaadMechanicNotice() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void adminApi(locale, '/admin/ustaad/verifications/open-count', VerificationOpenCountDto).then((res) => {
      if (live && res.ok && res.data.access === 'open') setOpen(res.data.open);
    });
    return () => {
      live = false;
    };
  }, [locale]);

  if (open === null) return null;
  return (
    <section aria-labelledby="ustaad-notice-title" className={`${adminCard} mb-4 border-l-4 border-l-accent`}>
      <h3 id="ustaad-notice-title" className="font-heading text-base font-extrabold text-ink">
        {t('ustaadNoticeTitle')}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">{t('ustaadNoticeBody', { count: open })}</p>
      <Link
        href={`${localePath('/admin/ustaad', locale)}?section=verify`}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-ink underline underline-offset-4 hover:decoration-2"
      >
        {t('ustaadNoticeLink')}
      </Link>
    </section>
  );
}
