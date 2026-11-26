'use client';

import { Camera } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { preparePhoto } from '@/lib/delivery/photo';
import { useAutoSubmitCode } from '@/lib/auth/use-auto-submit-code';
import { track } from '@/lib/analytics';
import { portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';
import type { PhotoPurpose, Result } from '@/lib/delivery/types';
export { useStatusLine } from './status-line';

/** Big phone targets for the agent screens (48 px, decision 2026-11-26 delivery web). */
export const bigPrimary = `${portalPrimary} min-h-12 text-base`;
export const bigQuiet = `${portalQuiet} min-h-12 text-base`;

/**
 * A reason code as native radios (one choice; L-P23e) and the note, which is required for `other` (rule 16: codes
 * first, free text only as an extra note).
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
        aria-invalid={error === 'reason' ? true : undefined}
        aria-describedby={error === 'reason' ? `${id}-reason-error` : undefined}
      >
        <legend className="text-sm font-bold text-ink">{legend}</legend>
        <div className="mt-2 grid gap-2">
          {codes.map((c) => (
            <label
              key={c}
              className="press flex min-h-12 cursor-pointer items-center gap-3 rounded-button border border-input-border px-3 text-[15px] text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name={`${id}-reason`}
                value={c}
                checked={value === c}
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
          <p id={`${id}-reason-error`} className="mt-1 text-sm font-bold text-error">
            {t('reasonRequired')}
          </p>
        ) : null}
      </fieldset>
      {value === 'other' ? (
        <div>
          <label htmlFor={`${id}-note`} className="text-sm font-bold text-ink">
            {t('note')}
          </label>
          <textarea
            id={`${id}-note`}
            value={note}
            maxLength={300}
            rows={2}
            aria-invalid={error === 'note' ? true : undefined}
            aria-describedby={error === 'note' ? `${id}-note-error` : `${id}-note-hint`}
            onChange={(e) => {
              onNote(e.target.value);
            }}
            className={`${portalField} py-2`}
          />
          {error === 'note' ? (
            <p id={`${id}-note-error`} className="mt-1 text-sm font-bold text-error">
              {t('noteRequired')}
            </p>
          ) : (
            <p id={`${id}-note-hint`} className="mt-1 text-xs text-muted">
              {t('noteHint')}
            </p>
          )}
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
 * Four-digit code entry: sent by itself at 4 digits (like the shop's delivery code, 2026-11-25), the button stays as
 * the fallback. `onCode` resolves to an error text (shown and kept selected) or null.
 */
export function CodeEntry({
  id,
  label,
  hint,
  submitLabel,
  kind,
  disabled = false,
  onCode,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  submitLabel: string;
  /** Analytics click id prefix (`agent_pickup_code`, `shop_return_code` …). */
  kind: string;
  disabled?: boolean;
  onCode: (code: string) => Promise<string | null>;
  /** Extra fields above the button (the photo). */
  children?: ReactNode;
}) {
  const t = useTranslations('deliveryAgent');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { value, checking, inputProps, claimManual } = useAutoSubmitCode({
    length: 4,
    autoComplete: 'off',
    busy: busy || disabled,
    submit: (code, auto) => run(code, auto),
  });

  async function run(code: string, auto: boolean) {
    if (!/^\d{4}$/.test(code)) {
      setError(t('codeFormat'));
      return;
    }
    track('code_submitted', { kind: 'delivery', auto, path: window.location.pathname });
    setBusy(true);
    const problem = await onCode(code);
    setBusy(false);
    setError(problem);
    track('click', { id: `${kind}_${problem ? 'wrong' : 'ok'}`, path: window.location.pathname });
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || disabled || !claimManual()) return;
    void run(value, false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-3" aria-busy={busy || undefined}>
      <div>
        <label htmlFor={id} className="text-sm font-bold text-ink">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
        <input
          id={id}
          {...inputProps}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={`${portalField} min-h-14 w-40 text-center font-heading text-2xl font-extrabold tracking-[0.4em] tabular-nums`}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-bold text-error">
            {error}
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {checking || busy ? t('checking') : ''}
        </p>
      </div>
      {children}
      <button type="submit" aria-disabled={busy || disabled || undefined} className={`${bigPrimary} w-full`}>
        {busy ? t('checking') : submitLabel}
      </button>
    </form>
  );
}

/**
 * Camera photo for a pickup, delivery, failure or document: the phone's camera opens (`capture`), the photo is shrunk
 * and drawn again on the phone (no EXIF: no location, no phone model; L: `prepareImage`) and uploaded; `onMedia`
 * gets the stored media id. One status line says what is happening.
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
      track('click', { id: `agent_photo_${purpose}`, path: window.location.pathname });
    } catch {
      setStatus('failed');
      onMedia(null);
    }
  }

  return (
    <div className="grid gap-2">
      <p id={`${id}-label`} className="text-sm font-bold text-ink">
        {label}
      </p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={id}
          className={`${bigQuiet} cursor-pointer gap-2 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus`}
        >
          <Camera aria-hidden="true" className="size-5" />
          {preview ? t('retakePhoto') : t('takePhoto')}
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*"
            capture="environment"
            aria-describedby={`${id}-label`}
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
        role="status"
        className={`text-sm empty:sr-only ${status === 'failed' ? 'font-bold text-error' : 'text-muted'}`}
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

/** Loading, error with one retry that stays mounted (L-SAV3), or the content. */
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
  if (error) {
    return (
      <div role="alert" className="rounded-card border border-line-card bg-surface p-4 text-sm text-ink">
        <p>{error}</p>
        <button type="button" onClick={onRetry} className={`${portalQuiet} mt-3`}>
          {t('retry')}
        </button>
      </div>
    );
  }
  if (loading) return <div className="skeleton h-40 rounded-card" aria-hidden="true" />;
  return <>{children}</>;
}
