'use client';

import { WaitlistDemandDto, type WaitlistDemand } from '@mechdost/shared/waitlist';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { portalCard } from './portal-styles';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; demand: WaitlistDemand };

/**
 * Admin -> Settings -> "Waiting for a PIN code" (spec 15 launch checklist, design 2026-11-15 item 7; real sign-in).
 * How many signed-in customers asked to be told when MechDost reaches each PIN, most wanted first, within the staff
 * member's cities. Read only: the PINs are switched on in "Service area" next to it, and the customers are told by the
 * worker within minutes. Needs `cities:manage`; the API checks it again.
 */
export function AdminDemandApi() {
  const t = useTranslations('adminDemand');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const titleId = useId();

  useEffect(() => {
    let live = true;
    void adminApi(locale, '/admin/pincode-waitlist', WaitlistDemandDto).then((res) => {
      if (live) setLoad(res.ok ? { kind: 'ok', demand: res.data } : { kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [locale]);

  return (
    <section aria-labelledby={titleId} className={`${portalCard} space-y-3`}>
      <h2 id={titleId} className="font-heading text-lg font-extrabold text-ink">
        {t('title')}
      </h2>
      <p className="max-w-prose text-sm text-muted">{t('intro')}</p>
      {load.kind === 'loading' ? <div className="skeleton h-24 rounded-card" aria-hidden="true" /> : null}
      {load.kind === 'error' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('loadError')}
        </p>
      ) : null}
      {load.kind === 'ok' && load.demand.rows.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : null}
      {load.kind === 'ok' && load.demand.rows.length > 0 ? (
        <>
          <p className="text-sm font-bold text-ink">{t('total', { count: load.demand.totalWaiting })}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-[13px] text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t('pincode')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t('city')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-bold">
                    {t('area')}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    {t('waiting')}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">
                    {t('told')}
                  </th>
                  <th scope="col" className="py-2 font-bold">
                    {t('status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {load.demand.rows.map((r) => (
                  <tr key={r.pincode}>
                    <td className="py-2 pr-3 font-bold text-ink">{r.pincode}</td>
                    <td className="py-2 pr-3 text-ink">{r.cityCode ?? t('noCity')}</td>
                    <td data-user-content className="py-2 pr-3 text-ink">
                      {(locale === 'hi' ? r.areaHi : r.area) ?? ''}
                    </td>
                    <td className="py-2 pr-3 text-right font-bold text-ink">{r.waiting}</td>
                    <td className="py-2 pr-3 text-right text-ink">{r.notified}</td>
                    <td className="py-2 text-ink">{r.servedNow ? t('served') : t('notServed')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
