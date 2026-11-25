'use client';

import { WaitlistDemandDto, type WaitlistDemand } from '@mechdost/shared/waitlist';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { adminApi } from '@/lib/admin-api';

import { adminCard, adminNum, AdminTable, adminTableClass, adminTd, adminTh } from './admin-ui';

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
    <section aria-labelledby={titleId} className={`${adminCard} space-y-3`}>
      <h3 id={titleId} className="font-heading text-lg font-extrabold text-ink">
        {t('title')}
      </h3>
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
          <AdminTable label={t('title')}>
            <table className={adminTableClass}>
              <thead>
                <tr>
                  <th scope="col" className={adminTh}>
                    {t('pincode')}
                  </th>
                  <th scope="col" className={adminTh}>
                    {t('city')}
                  </th>
                  <th scope="col" className={adminTh}>
                    {t('area')}
                  </th>
                  <th scope="col" className={`${adminTh} ${adminNum}`}>
                    {t('waiting')}
                  </th>
                  <th scope="col" className={`${adminTh} ${adminNum}`}>
                    {t('told')}
                  </th>
                  <th scope="col" className={adminTh}>
                    {t('status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {load.demand.rows.map((r) => (
                  <tr key={r.pincode}>
                    <td className={adminTd}>{r.pincode}</td>
                    <td className={adminTd}>{r.cityCode ?? t('noCity')}</td>
                    <td data-user-content className={adminTd}>
                      {(locale === 'hi' ? r.areaHi : r.area) ?? ''}
                    </td>
                    <td className={`${adminTd} ${adminNum}`}>{r.waiting}</td>
                    <td className={`${adminTd} ${adminNum}`}>{r.notified}</td>
                    <td className={adminTd}>{r.servedNow ? t('served') : t('notServed')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
        </>
      ) : null}
    </section>
  );
}
