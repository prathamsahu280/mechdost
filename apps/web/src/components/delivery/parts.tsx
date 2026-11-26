'use client';

import { Camera, Phone } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { preparePhoto } from '@/lib/delivery/photo';
import { telNumber } from '@/lib/delivery/view';
import { useAutoSubmitCode } from '@/lib/auth/use-auto-submit-code';
import { track } from '@/lib/analytics';
import { site } from '@/lib/site';
import { portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';
import type { PhotoPurpose, Result } from '@/lib/delivery/types';
export { useStatusLine } from './status-line';

/** Big phone targets for the agent screens (48 px, decision 2026-11-26 delivery web). */
export const bigPrimary = `${portalPrimary} min-h-12 text-base`;
export const bigQuiet = `${portalQuiet} min-h-12 text-base`;

/** "1234" → "1 2 3 4": a code read digit by digit by screen readers (a11y review 2026-11-27, COG-009). */
export const spacedDigits = (code: string) => code.split('').join(' ');

/** A big 4-digit code as shown to the shop or the agent: digits for the eye, spaced digits for screen readers. */
export function BigCode({ code, className = '' }: { code: string; className?: string }) {
  return (
    <p className={`font-heading text-4xl font-extrabold tracking-[0.3em] text-ink tabular-nums ${className}`}>
      <span aria-hidden="true">{code}</span>
      <span className="sr-only">{spacedDigits(code)}</span>
    </p>
  );
}

/** A large call-support link, next to every "call MechDost support" message (a11y review COG-004). */
export function CallSupport({ label }: { label: string }) {
  return (
    <a
      href={`tel:${telNumber(site.supportPhone)}`}
      onClick={() => {
        track('delivery_contact_tapped', { target: 'support', action: 'call' });
      }}
      className={`${bigQuiet} mt-2 gap-2`}
    >
      <Phone aria-hidden="true" className="size-4" />
      {label}
    </a>
  );
}

/**
 * A reason code as native radios (one choice; L-P23e) and the note, which is required for `other` (rule 16: codes
 * first, free text only as an extra note). The first radio carries `data-disclosure-field={id}` so an opened form
 * takes focus there (`useDisclosureFocus`).
 */
export function ReasonFields<C extends string>({
  id,
  legend,
  codes,
  label,
  value,
  onChange,
  note,
  onNote,
  error,
}: {
  id: string;
  legend: string;
  codes: readonly C[];
  label: (code: C) => string;
  value: C | '';
  onChange: (code: C) => void;
  note: string;
  onNote: (note: string) => void;
  error: 'reason' | 'note' | null;
}) {
  const t = useTranslations('deliveryAgent');
  return (
    <div className="grid gap-3">
      <fieldset
        id={`${id}-reasons`}
        tabIndex={-1}
        aria-describedby={error === 'reason' ? `${id}-reason-error` : undefined}
      >
        <legend className="text-base font-bold text-ink">{legend}</legend>
        <div className="mt-2 grid gap-2">
          {codes.map((c, i) => (
            <label
              key={c}
              className="press flex min-h-12 cursor-pointer items-center gap-3 rounded-button border border-input-border px-3 text-[15px] text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name={`${id}-reason`}
                value={c}
                checked={value === c}
                aria-invalid={error === 'reason' ? true : undefined}
                {...(i === 0 ? { 'data-disclosure-field': id } : {})}
                onChange={() => {
                  onChange(c);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {label(c)}
            </label>
          ))}
        </div>
        {error === 'reason' ? (
          <p id={`${id}-reason-error`} role="alert" className="mt-1 text-sm font-bold text-error">
            {t('reasonRequired')}
          </p>
        ) : null}
      </fieldset>
      {value === 'other' ? (
        <div>
          <label htmlFor={`${id}-note`} className="text-sm font-bold text-ink">
            {t('noteRequiredLabel')}
          </label>
          <textarea
            id={`${id}-note`}
            value={note}
            maxLength={300}
            rows={2}
            aria-required="true"
            aria-invalid={error === 'note' ? true : undefined}
            aria-describedby={error === 'note' ? `${id}-note-error ${id}-note-hint` : `${id}-note-hint`}
            onChange={(e) => {
              onNote(e.target.value);
            }}
            className={`${portalField} py-2`}
          />
          {error === 'note' ? (
            <p id={`${id}-note-error`} role="alert" className="mt-1 text-sm font-bold text-error">
              {t('noteRequired')}
            </p>
          ) : null}
          <p id={`${id}-note-hint`} className="mt-1 text-sm text-muted">
            {t('noteHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Checks a reason form; focuses the first problem and returns it (null = fine). */
export function reasonProblem(id: string, value: string, note: string): 'reason' | 'note' | null {
  const problem = value === '' ? 'reason' : value === 'other' && note.trim() === '' ? 'note' : null;
  if (problem === 'reason') document.getElementById(`${id}-reasons`)?.focus();
  if (problem === 'note') document.getElementById(`${id}-note`)?.focus();
  return problem;
}

/**
 * Four-digit code entry: sent by itself at 4 digits (like the shop's delivery code, 2026-11-25; the hint says so,
 * WCAG 3.2.2), the button stays as the fallback. `before` (the photo) comes first, and while `ready` is false (a
 * required photo is missing) the code waits instead of being sent. `onCode` resolves to an error text or null. The
 * error line is always mounted and cleared before each try, so a repeated message is read again. `locked`: too many
 * wrong codes — the field is disabled, the message stays with a call-support link.
 */
export function CodeEntry({
  id,
  label,
  hint,
  submitLabel,
  ready = true,
  notReadyText,
  notReadyFocus,
  locked = null,
  onCode,
  before,
}: {
  id: string;
  label: string;
  hint: string;
  submitLabel: string;
  ready?: boolean;
  /** What to say (and where to move focus) when the button is pressed while not ready. */
  notReadyText?: string;
  notReadyFocus?: string;
  /** The lock message when the code is locked (null = open). */
  locked?: string | null;
  onCode: (code: string) => Promise<string | null>;
  /** Fields before the code (the photo). */
  before?: ReactNode;
}) {
  const t = useTranslations('deliveryAgent');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { value, checking, inputProps, claimManual } = useAutoSubmitCode({
    length: 4,
    autoComplete: 'off',
    ready,
    busy: busy || locked !== null,
    submit: (code, auto) => run(code, auto),
  });

  async function run(code: string, auto: boolean) {
    setError(null);
    if (!/^\d{4}$/.test(code)) {
      setError(t('codeFormat'));
      return;
    }
    track('code_submitted', { kind: 'delivery', auto, path: window.location.pathname });
    setBusy(true);
    const problem = await onCode(code);
    setBusy(false);
    setError(problem);
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || locked !== null) return;
    if (!ready) {
      setError(null);
      setTimeout(() => {
        setError(notReadyText ?? null);
      }, 60);
      if (notReadyFocus) document.getElementById(notReadyFocus)?.focus();
      return;
    }
    if (!claimManual()) return;
    void run(value, false);
  }

  const shown = locked ?? error;
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4" aria-busy={busy || undefined}>
      {before}
      <div>
        <label htmlFor={id} className="text-base font-bold text-ink">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-sm text-ink">
          {hint} {t('codeAutoNote')}
        </p>
        <input
          id={id}
          {...inputProps}
          spellCheck={false}
          disabled={locked !== null}
          aria-invalid={error ? true : undefined}
          aria-describedby={shown ? `${id}-error ${id}-hint` : `${id}-hint`}
          className={`${portalField} min-h-14 w-40 text-center font-heading text-2xl font-extrabold tracking-[0.4em] tabular-nums disabled:opacity-60`}
        />
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-bold text-error empty:hidden">
          {shown ?? ''}
        </p>
        {locked !== null ? <CallSupport label={t('helpLabel')} /> : null}
        <p role="status" className="sr-only">
          {checking || busy ? t('checking') : ''}
        </p>
      </div>
      {locked === null ? (
        <button type="submit" aria-disabled={busy || undefined} className={`${bigPrimary} w-full`}>
          {busy ? t('checking') : submitLabel}
        </button>
      ) : null}
    </form>
  );
}

/**
 * Camera photo for a pickup, delivery, failure or document: the phone's camera opens (`capture`), the photo is shrunk
 * and drawn again on the phone (no EXIF: no location, no phone model; `lib/delivery/photo.ts`) and uploaded; `onMedia`
 * gets the stored media id. The file input is named by the field label and the button text; one status line says what
 * is happening (an alert when it failed).
 */
export function PhotoCapture({
  id,
  label,
  hint,
  purpose,
  upload,
  onMedia,
}: {
  id: string;
  label: string;
  hint?: string;
  purpose: PhotoPurpose;
  upload: (file: Blob, purpose: PhotoPurpose) => Promise<Result<{ mediaId: string }>>;
  onMedia: (mediaId: string | null) => void;
}) {
  const t = useTranslations('deliveryAgent');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [status, setStatus] = useState<'preparing' | 'uploading' | 'ready' | 'failed' | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function pick(file: File | undefined) {
    if (!file) return;
    onMedia(null);
    setStatus('preparing');
    try {
      const img = await preparePhoto(file);
      setPreview({ url: URL.createObjectURL(img.blob), width: img.width, height: img.height });
      setStatus('uploading');
      const res = await upload(img.blob, purpose);
      if (!res.ok) throw new Error(res.code);
      setStatus('ready');
      onMedia(res.data.mediaId);
      track('delivery_photo_taken', { purpose });
    } catch {
      setStatus('failed');
      onMedia(null);
    }
  }

  return (
    <div className="grid gap-2">
      <p id={`${id}-label`} className="text-base font-bold text-ink">
        {label}
      </p>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink">
          {hint}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className={`${bigQuiet} file-pick cursor-pointer gap-2`}>
          <Camera aria-hidden="true" className="size-5" />
          <span id={`${id}-btn`}>{preview ? t('retakePhoto') : t('takePhoto')}</span>
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*"
            capture="environment"
            aria-labelledby={`${id}-label ${id}-btn`}
            aria-describedby={`${hint ? `${id}-hint ` : ''}${id}-status`}
            className="sr-only"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
        {preview ? (
          <Image
            src={preview.url}
            alt={t('photoAlt')}
            width={preview.width}
            height={preview.height}
            unoptimized
            className="h-20 w-auto rounded-lg border border-line-card object-cover"
          />
        ) : null}
      </div>
      <p
        id={`${id}-status`}
        role={status === 'failed' ? 'alert' : 'status'}
        className={`text-sm empty:sr-only ${status === 'failed' ? 'font-bold text-error' : 'text-ink'}`}
      >
        {status === 'preparing'
          ? t('photoPreparing')
          : status === 'uploading'
            ? t('photoUploading')
            : status === 'ready'
              ? t('photoReady')
              : status === 'failed'
                ? t('photoFailed')
                : ''}
      </p>
    </div>
  );
}

/** Loading (announced), error with one retry that stays mounted (L-SAV3), or the content. */
export function LoadGate({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('deliveryAgent');
  return (
    <>
      <p role="status" className="sr-only">
        {loading ? t('loading') : ''}
      </p>
      <div role="alert" className="empty:hidden">
        {error ? (
          <div className="rounded-card border border-line-card bg-surface p-4 text-sm text-ink">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className={`${portalQuiet} mt-3`}>
              {t('retry')}
            </button>
          </div>
        ) : null}
      </div>
      {error ? null : loading ? <div className="skeleton h-40 rounded-card" aria-hidden="true" /> : children}
    </>
  );
}
