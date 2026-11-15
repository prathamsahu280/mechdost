'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { commonErrorKey } from '@/lib/api-error-key';
import { portalCard, portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';
import { DELETION_SECTION_ID } from '@/lib/privacy-hooks';

const BLOCKERS = ['OPEN_ORDERS', 'OPEN_SERVICE', 'OPEN_REFUND'] as const;
type Blocker = (typeof BLOCKERS)[number];

const Asked: ResponseSchema<{ code: string; created: boolean }> = {
  safeParse(value: unknown) {
    if (typeof value === 'object' && value !== null && 'code' in value && 'created' in value) {
      const { code, created } = value;
      if (typeof code === 'string' && typeof created === 'boolean')
        return { success: true as const, data: { code, created } };
    }
    return { success: false as const };
  },
};

function blockersOf(details: unknown): Blocker[] {
  if (typeof details !== 'object' || details === null || !('blockers' in details)) return [];
  const list: unknown = details.blockers;
  return Array.isArray(list) ? BLOCKERS.filter((b) => list.includes(b)) : [];
}

/**
 * Account deletion request (design 2026-11-15 item 7; spec 01): the customer asks from Account → Support. One calm
 * step: the card, then an inline confirmation (no modal). The API opens a `deletion_request` request that support
 * confirms; a customer with an open order, service job or refund is told which one. Nothing is deleted here.
 */
export function DeletionRequestApi({ onOpened }: { onOpened: () => Promise<void> }) {
  const t = useTranslations('supportThread');
  const p = useTranslations('portal');
  const locale = useLocale();
  const id = useId();
  const [step, setStep] = useState<'card' | 'confirm'>('card');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string; created: boolean } | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setBlockers([]);
    const res = await adminApi(locale, '/support/deletion-request', Asked, {
      method: 'POST',
      body: note.trim() ? { note: note.trim() } : {},
    });
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'DELETION_BLOCKED') {
        setBlockers(blockersOf(res.details));
        setStep('card');
        return;
      }
      setError(p(commonErrorKey(res.code)));
      return;
    }
    track('support_ticket', { action: 'deletion_requested', kind: 'deletion_request', channel: 'web' });
    setDone(res.data);
    setStep('card');
    await onOpened();
  }

  return (
    <section
      id={DELETION_SECTION_ID}
      aria-labelledby={`${id}-title`}
      className={`${portalCard} scroll-mt-24 space-y-3`}
    >
      <h3 id={`${id}-title`} className="font-heading text-base font-extrabold text-ink">
        {t('deletionTitle')}
      </h3>
      <p className="max-w-prose text-sm text-muted">{t('deletionIntro')}</p>
      {done ? (
        <p role="status" className="text-sm font-bold text-ink">
          {t(done.created ? 'deletionSent' : 'deletionExists', { code: done.code })}
        </p>
      ) : step === 'card' ? (
        <>
          {blockers.length > 0 ? (
            <div role="alert" className="text-sm text-error">
              <p className="font-bold">{t('deletionBlockedTitle')}</p>
              <ul className="mt-1 list-disc ps-5">
                {blockers.map((b) => (
                  <li key={b}>{t(`deletion_blocker_${b}`)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            data-disclosure-trigger="deletion-request"
            type="button"
            className={portalQuiet}
            data-track="support_deletion_ask"
            onClick={() => {
              setStep('confirm');
            }}
          >
            {t('deletionAsk')}
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`${id}-note`} className="text-xs font-bold text-muted">
            {t('deletionNoteLabel')}
          </label>
          <textarea
            id={`${id}-note`}
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            className={`${portalField} py-2`}
          />
          <p className="text-sm font-bold text-ink">{t('deletionConfirmPrompt')}</p>
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={portalPrimary}
              data-track="support_deletion_confirm"
              onClick={() => {
                void send();
              }}
            >
              {t('deletionConfirm')}
            </button>
            <button
              data-panel-cancel="deletion-request"
              type="button"
              className={portalQuiet}
              onClick={() => {
                setStep('card');
              }}
            >
              {t('deletionCancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
