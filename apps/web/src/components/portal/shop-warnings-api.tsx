'use client';

import { ShopWarningsList } from '@mechdost/shared/partner-warnings';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { adminApi } from '@/lib/admin-api';
import { formatDate } from '@/lib/format';
import { ApiListState } from './api-list-state';
import { portalCard } from './portal-styles';
import { useApiList } from './use-api-list';

/**
 * "Notes from MechDost" in the shop portal (spec 07, user ruling 2026-11-15): the warnings staff gave the shop, each
 * with its reason, optional note and date, and how many fall inside the window. Calm and factual: no threshold, no
 * mention of pausing. Empty is a plain sentence. Real API mode only.
 */
export function ShopWarningsApi() {
  const t = useTranslations('shopGiveUp');
  const locale = useLocale();
  const page = useCallback(
    async (_cursor: string | null) => {
      const res = await adminApi(locale, '/shop/warnings', ShopWarningsList);
      return res.ok ? { ok: true as const, data: { items: res.data.shops, next: null } } : res;
    },
    [locale],
  );
  const list = useApiList(page);

  return (
    <section aria-labelledby="warnings-title" id="warnings">
      <h2 id="warnings-title" className="font-heading text-xl font-extrabold text-ink">
        {t('w_title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('w_intro')}</p>
      <ApiListState
        loading={list.loading}
        error={list.error}
        count={list.items.length}
        empty={t('w_empty', { days: 30 })}
        onRetry={() => void list.reload()}
      />
      {list.items.map((shop) => (
        <div key={shop.shopId} className="mt-3">
          {shop.warnings.length === 0 ? (
            <p className="text-sm text-muted">{t('w_empty', { days: shop.windowDays })}</p>
          ) : (
            <>
              <p className="text-sm font-bold text-ink">
                {t('w_count', { count: shop.counting, days: shop.windowDays })}
              </p>
              <ul className="mt-2 grid gap-3 nav:grid-cols-2">
                {shop.warnings.map((w) => (
                  <li key={w.id} className={portalCard}>
                    <p className="font-bold text-ink">
                      {t(`wr_${w.reasonCode}`)}
                      {w.withdrawn ? (
                        <span className="ml-2 rounded-pill bg-pill px-2 py-0.5 text-[11px] font-extrabold text-muted">
                          {t('w_withdrawn')}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">{formatDate(w.createdAt, locale)}</p>
                    {w.note ? (
                      <p data-user-content className="mt-2 text-sm text-ink">
                        {t('w_note', { note: w.note })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
