'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ServiceChangedDto, type ServiceRequestDetail } from '@mechdost/shared/service-api';
import { SERVICE_SLOTS } from '@mechdost/shared/service-requests';
import { useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { isTier1Error, Tier1Error } from './tier1-error';

/**
 * Change the date or part of the day of a booking before the vehicle arrives (spec 06, workshops tier 1). The workshop
 * answers the new time like any request; the held hour goes back at once. Shown by the request page while the booking
 * is proposed or confirmed. Loaded with the request page's other real-mode screens.
 */
export function RescheduleRequestApi({
  req,
  onChanged,
}: {
  req: ServiceRequestDetail;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('workshopTier1');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = req.reschedule.max - req.reschedule.count;
  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const rawDate = data.get('date');
    const date = typeof rawDate === 'string' ? rawDate : '';
    const slot = SERVICE_SLOTS.find((s) => s === data.get('slot')) ?? req.preferredSlot;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('DATE_OUT_OF_RANGE');
      document.getElementById('reschedule-date')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await adminApi(
      locale,
      `/service-requests/${encodeURIComponent(req.code)}/reschedule`,
      ServiceChangedDto,
      { method: 'POST', body: { date, slot, version: req.version } },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      if (res.code === 'STALE_REQUEST' || res.code === 'WRONG_STEP') await onChanged();
      return;
    }
    track('booking_rescheduled', { code: req.code, workshop: req.workshop?.slug ?? 'mechdost', slot });
    setSent(true);
    setOpen(false);
    await onChanged();
  }

  if (left <= 0) return null;
  if (!open)
    return (
      <div className="mt-3">
        {sent ? (
          <p role="status" className="mb-2 text-sm font-bold text-ink">
            {t('rescheduleSent')}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-ink underline-offset-4 hover:underline"
        >
          {t('rescheduleAction')}
        </button>
      </div>
    );
  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-labelledby="reschedule-title"
      className="mt-3 space-y-3 rounded-tile bg-pill p-4"
    >
      <h3 id="reschedule-title" className="font-heading text-base font-extrabold text-ink">
        {t('rescheduleTitle')}
      </h3>
      <p className="text-sm text-ink">{t('rescheduleNote', { max: req.reschedule.max })}</p>
      <p className="text-xs text-muted">{t('rescheduleLeft', { left })}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="reschedule-date" className="text-xs font-bold text-muted">
            {t('rescheduleDate')}
          </label>
          <input
            id="reschedule-date"
            name="date"
            type="date"
            min={today}
            defaultValue={req.preferredDate.slice(0, 10)}
            className="min-h-11 w-full rounded-tile border border-line bg-surface px-3 text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor="reschedule-slot" className="text-xs font-bold text-muted">
            {t('rescheduleSlot')}
          </label>
          <select
            id="reschedule-slot"
            name="slot"
            defaultValue={req.preferredSlot}
            className="min-h-11 w-full rounded-tile border border-line bg-surface px-3 text-sm text-ink"
          >
            {SERVICE_SLOTS.map((s) => (
              <option key={s} value={s}>
                {t(`slot_${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        isTier1Error(error) || error === 'DATE_OUT_OF_RANGE' ? (
          <Tier1Error code={error} />
        ) : (
          <Tier1Error code="generic" />
        )
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-pill bg-accent-button px-5 text-sm font-extrabold text-white disabled:opacity-70"
        >
          {t('rescheduleConfirm')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-ink underline-offset-4 hover:underline"
        >
          {t('rescheduleKeep')}
        </button>
      </div>
    </form>
  );
}
