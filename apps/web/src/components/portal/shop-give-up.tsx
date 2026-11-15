'use client';

import { OrderChanged, type ShopOrderDto } from '@mechdost/shared/order-views';
import { ASSIGNMENT_GIVE_UP_REASONS, type AssignmentGiveUpReason } from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { ApiError } from './api-list-state';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';

const GIVE_UP_ERRORS = new Set(['GIVE_UP_REASON', 'GIVE_UP_NOTE']);

/**
 * "Can't fulfil this order" (spec 04, user ruling 2026-11-15): an order the shop accepted and has not packed can be
 * given back to MechDost, which finds another shop. One quiet button; it opens an inline form (reason code, optional
 * note) with one primary action to confirm — no modal. The customer is not told; the order returns to admin.
 */
export function GiveUpOrder({ order, onChanged }: { order: ShopOrderDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('shopGiveUp');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AssignmentGiveUpReason | ''>('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `give-up-${order.code}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason) {
      setMissing(true);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop/orders/${order.code}/give-up`, OrderChanged, {
      method: 'POST',
      body: { reasonCode: reason, version: order.version, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      if (res.code !== 'NETWORK') await onChanged();
      return;
    }
    track('click', { id: 'shop_order_given_up', path: window.location.pathname });
    await onChanged();
  }

  if (!open)
    return (
      <button
        data-disclosure-trigger={`give-up-${order.code}`}
        type="button"
        data-track="shop_order_give_up_open"
        onClick={() => {
          setOpen(true);
        }}
        className={`${portalQuiet} mt-3 w-full`}
      >
        {t('action')}
      </button>
    );

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-4 space-y-3 rounded-lg bg-pill p-3"
    >
      <h3 className="text-sm font-extrabold text-ink">{t('title')}</h3>
      <p className="text-xs text-muted">{t('explain')}</p>
      <label htmlFor={`${id}-reason`} className="block text-sm font-bold text-ink">
        {t('reasonLabel')}
      </label>
      <select
        id={`${id}-reason`}
        value={reason}
        aria-invalid={missing ? true : undefined}
        aria-describedby={missing ? `${id}-reason-error` : undefined}
        onChange={(e) => {
          setReason(ASSIGNMENT_GIVE_UP_REASONS.find((r) => r === e.target.value) ?? '');
          setMissing(false);
        }}
        className={portalField}
      >
        <option value="">{t('choose')}</option>
        {ASSIGNMENT_GIVE_UP_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`reason_${r}`)}
          </option>
        ))}
      </select>
      {missing ? (
        <p id={`${id}-reason-error`} className="text-xs font-bold text-error">
          {t('reasonRequired')}
        </p>
      ) : null}
      <label htmlFor={`${id}-note`} className="block text-sm font-bold text-ink">
        {t('noteLabel')}
      </label>
      <textarea
        id={`${id}-note`}
        value={note}
        maxLength={300}
        rows={2}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        data-user-content
        className={`${portalField} py-2`}
      />
      {error ? (
        GIVE_UP_ERRORS.has(error) ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t(`err_${error}` as 'err_GIVE_UP_REASON')}
          </p>
        ) : (
          <ApiError code={error} />
        )
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('confirm')}
        </button>
        <button
          data-panel-cancel={`give-up-${order.code}`}
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className={portalQuiet}
        >
          {t('keep')}
        </button>
      </div>
    </form>
  );
}
