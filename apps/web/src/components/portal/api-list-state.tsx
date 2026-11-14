'use client';

import { useTranslations } from 'next-intl';
import { apiErrorKey } from '@/lib/order-views';
import { portalQuiet } from './portal-guard';

/** An API error in the screen's words (`portal.api_err_*`). */
export function ApiError({ code, id }: { code: string; id?: string }) {
  const t = useTranslations('portal');
  return (
    <p id={id} role="alert" className="text-sm font-bold text-error">
      {t(apiErrorKey(code) as 'api_err_generic')}
    </p>
  );
}

/**
 * Loading, failed and empty states of an API list (real-API screens): a failed load says so with a retry, so an
 * outage never looks like "no orders". Renders nothing once there are items.
 */
export function ApiListState({
  loading,
  error,
  count,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  count: number;
  empty: string;
  onRetry: () => void;
}) {
  const t = useTranslations('portal');
  if (loading) return <p className="mt-3 text-sm text-muted">{t('api_loading')}</p>;
  if (error)
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm font-bold text-error">
          {t('api_loadFailed')} {t(apiErrorKey(error) as 'api_err_generic')}
        </p>
        <button type="button" onClick={onRetry} className={portalQuiet}>
          {t('api_retry')}
        </button>
      </div>
    );
  if (count === 0) return <p className="mt-3 text-sm text-muted">{empty}</p>;
  return null;
}

export function LoadMore({ show, onClick }: { show: boolean; onClick: () => void }) {
  const t = useTranslations('portal');
  if (!show) return null;
  return (
    <button type="button" onClick={onClick} className={`${portalQuiet} mt-3`}>
      {t('api_loadMore')}
    </button>
  );
}
