'use client';

import { CouponUsageReportDto, type CouponUsageReport } from '@mechdost/shared/coupon-api';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { formatDate, formatPrice } from '@/lib/format';
import { LocalLink } from '../ui/local-link';
import { AdminTable, adminTableClass, adminTd, adminTh } from './admin-ui';
import { portalQuiet } from './portal-styles';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; report: CouponUsageReport };

/**
 * Admin → Coupons → Usage (spec 08 "Promotions", 2026-11-16): one coupon's orders, uses kept, uses given back, discount
 * given and customers, then the IST days newest first with "Show earlier days" (keyset cursor). Opening it records the
 * event `admin_coupon_usage_viewed` on the server. The panel closes with its own button or Escape (`PanelDismiss`).
 * The full file is the `coupon_usage` export on the Exports screen (one row per use, no personal data).
 */
export function AdminCouponUsage({ couponId, onClose }: { couponId: string; onClose: () => void }) {
  const t = useTranslations('coupons');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void adminApi(locale, `/admin/coupons/${couponId}/usage?limit=31`, CouponUsageReportDto).then((res) => {
      if (live) setLoad(res.ok ? { kind: 'ok', report: res.data } : { kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [couponId, locale]);

  async function more() {
    if (load.kind !== 'ok' || !load.report.nextCursor) return;
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/coupons/${couponId}/usage?limit=31&cursor=${encodeURIComponent(load.report.nextCursor)}`,
      CouponUsageReportDto,
    );
    setBusy(false);
    if (res.ok)
      setLoad({
        kind: 'ok',
        report: { ...res.data, days: [...load.report.days, ...res.data.days] },
      });
  }

  const headingId = `coupon-usage-${couponId}`;
  return (
    <div
      className="mt-3 space-y-3 rounded-card border border-line-card bg-pill/40 p-4"
      aria-labelledby={headingId}
      role="group"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="font-heading text-base font-extrabold text-ink">
          {load.kind === 'ok' ? t('u_title', { code: load.report.code }) : t('u_open')}
        </h4>
        <button
          type="button"
          data-panel-cancel={`usage-${couponId}`}
          className={portalQuiet}
          onClick={onClose}
        >
          {t('u_close')}
        </button>
      </div>
      {load.kind === 'loading' ? <p className="text-sm text-muted">{t('u_loading')}</p> : null}
      {load.kind === 'error' ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('u_err')}
        </p>
      ) : null}
      {load.kind === 'ok' ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ['u_orders', String(load.report.totals.orders)],
                ['u_uses', String(load.report.totals.uses)],
                ['u_released', String(load.report.totals.released)],
                ['u_discount', formatPrice(load.report.totals.discountPaise)],
                ['u_customers', String(load.report.totals.uniqueCustomers)],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-muted">{t(key)}</dt>
                <dd className="font-heading text-lg font-extrabold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {load.report.days.length === 0 ? (
            <p className="text-sm text-muted">{t('u_empty')}</p>
          ) : (
            <AdminTable label={t('u_title', { code: load.report.code })}>
              <table className={adminTableClass}>
                <thead>
                  <tr>
                    <th scope="col" className={adminTh}>
                      {t('u_day')}
                    </th>
                    <th scope="col" className={adminTh}>
                      {t('u_orders')}
                    </th>
                    <th scope="col" className={adminTh}>
                      {t('u_released')}
                    </th>
                    <th scope="col" className={adminTh}>
                      {t('u_discount')}
                    </th>
                    <th scope="col" className={adminTh}>
                      {t('u_customers')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {load.report.days.map((d) => (
                    <tr key={d.day} className="border-t border-line-card text-ink">
                      <th scope="row" className={adminTh}>
                        {formatDate(`${d.day}T06:00:00+05:30`, locale)}
                      </th>
                      <td className={adminTd}>{d.orders}</td>
                      <td className={adminTd}>{d.released}</td>
                      <td className={adminTd}>{formatPrice(d.discountPaise)}</td>
                      <td className={adminTd}>{d.uniqueCustomers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTable>
          )}
          <p className="text-xs text-muted">{t('u_note')}</p>
          <div className="flex flex-wrap gap-2">
            {load.report.nextCursor ? (
              <button type="button" disabled={busy} className={portalQuiet} onClick={() => void more()}>
                {t('u_more')}
              </button>
            ) : null}
            <LocalLink href="/admin/exports" className={portalQuiet}>
              {t('u_export')}
            </LocalLink>
          </div>
        </>
      ) : null}
    </div>
  );
}
