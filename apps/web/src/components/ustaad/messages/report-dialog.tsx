'use client';

import { Flag, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { btnPrimary, btnQuiet, fieldClass } from '../common';
import { LiveNote, useAct, useDmErrorText } from './shared';

/** Reasons that fit a conversation or a member (spec 23 § 13; codes from `REPORT_REASONS`). */
const REASONS = [
  'abuse',
  'spam',
  'job_scam',
  'fake',
  'privacy',
  'ncii_impersonation',
  'minor',
  'other',
] as const;

/**
 * Report a conversation (`POST /ustaad/reports`; spec 23 § 13, SR-38): the reason as a radio group and an optional
 * note. The target is the other member's latest message, so the team can open the thread through this report (staff
 * read a conversation only through an open report). A native modal `<dialog>`: Escape closes, focus returns to "More".
 */
export function ReportDialog({
  target,
  onClose,
}: {
  target: { type: 'message' | 'member'; id: string };
  onClose: (sent: boolean) => void;
}) {
  const t = useTranslations('ustaad.messages');
  const errorText = useDmErrorText();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const noteId = useId();
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const { act, busy, error } = useAct();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      d?.close();
    };
  }, []);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy) return;
    if (!reason) {
      setMissing(true);
      return;
    }
    const r = await act('report', (c) =>
      c.report({
        targetType: target.type,
        targetId: target.id,
        reasonCode: reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    );
    if (r) onClose(true);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line-card bg-surface p-0 text-ink shadow-float backdrop:bg-navy/60"
    >
      <form className="grid gap-4 p-5" onSubmit={(e) => void submit(e)} noValidate>
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 font-heading text-xl font-extrabold">
            <Flag aria-hidden="true" className="size-5 text-error" />
            {t('reportTitle')}
          </h2>
          <button
            type="button"
            className={`${btnQuiet} px-3`}
            onClick={() => {
              onClose(false);
            }}
            data-track="ustaad_report_close"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">{t('close')}</span>
          </button>
        </div>
        <p className="text-[15px] leading-relaxed text-muted">{t('reportBody')}</p>
        <fieldset className="grid gap-2" aria-invalid={missing && !reason ? true : undefined}>
          <legend className="mb-1 text-[15px] font-bold">{t('reportReason')}</legend>
          {REASONS.map((r) => (
            <label
              key={r}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line-card px-3 has-[:checked]:border-accent has-[:checked]:bg-accent-pale has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
            >
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setMissing(false);
                }}
                className="size-5 accent-accent-button"
              />
              <span className="text-[15px]">{t(`rsn_${r}`)}</span>
            </label>
          ))}
        </fieldset>
        <LiveNote
          tone="error"
          text={missing && !reason ? t('reportPick') : error ? errorText(error) : null}
        />
        <div className="grid gap-1.5">
          <label htmlFor={noteId} className="text-[15px] font-bold">
            {t('reportNote')}
          </label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            className={fieldClass}
          />
        </div>
        <button
          type="submit"
          className={btnPrimary}
          aria-disabled={busy !== null}
          aria-busy={busy !== null}
          data-track="ustaad_report_send"
        >
          {t('reportSend')}
        </button>
      </form>
    </dialog>
  );
}
