'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import {
  ORDER_ISSUE_CODES,
  SERVICE_ISSUE_CODES,
  SUPPORT_ATTACH_MAX,
  type SupportIssueCode,
} from '@mechdost/shared/support-thread';
import { track } from '@/lib/analytics';
import { openThread, threadErrorKey } from '@/lib/support-thread-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-guard';

const BODY_MAX = 2000;

/** The photo chooser shared by the opener and the reply form: up to four files, each removable, no layout jump. */
export function PhotoPicker({
  files,
  onChange,
  label,
}: {
  files: readonly File[];
  onChange: (files: File[]) => void;
  label: string;
}) {
  const t = useTranslations('supportThread');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [note, setNote] = useState<string | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    const next = [...files, ...picked].slice(0, SUPPORT_ATTACH_MAX);
    setNote(
      files.length + picked.length > SUPPORT_ATTACH_MAX ? t('photoMax', { max: SUPPORT_ATTACH_MAX }) : null,
    );
    onChange(next);
  }

  return (
    <div>
      <p id={`${id}-label`} className="text-xs font-bold text-muted">
        {label}
      </p>
      <p id={`${id}-help`} className="mt-1 text-xs text-muted">
        {t('photosHelp', { max: SUPPORT_ATTACH_MAX })}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={portalQuiet}
          aria-describedby={`${id}-help`}
          disabled={files.length >= SUPPORT_ATTACH_MAX}
          onClick={() => input.current?.click()}
        >
          {t('photosPick')}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          onChange={onPick}
        />
        <span role="status" className="text-xs text-muted">
          {files.length > 0 ? t('photosCount', { count: files.length, max: SUPPORT_ATTACH_MAX }) : null}
          {note ? ` ${note}` : null}
        </span>
      </div>
      {files.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${String(i)}`}>
              <button
                type="button"
                className="press inline-flex min-h-11 items-center gap-2 rounded-pill bg-pill px-3 text-xs font-bold text-ink"
                aria-label={t('photoRemove', { name: file.name })}
                onClick={() => {
                  onChange(files.filter((_, j) => j !== i));
                }}
              >
                <span data-user-content className="max-w-40 truncate">
                  {file.name}
                </span>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "Talk to MechDost support about this order / job": quick issue chips, the message and up to four photos. One
 * conversation per order or job: asking again continues it (the API says so). Customers talk to MechDost support
 * only; nothing here names or contacts a shop or workshop (design 2026-11-15, user ruling).
 */
export function ThreadOpenerApi({
  subject,
  onOpened,
}: {
  subject: { kind: 'order' | 'service'; code: string };
  onOpened: () => Promise<void>;
}) {
  const t = useTranslations('supportThread');
  const locale = useLocale();
  const codes = subject.kind === 'order' ? ORDER_ISSUE_CODES : SERVICE_ISSUE_CODES;
  const [issue, setIssue] = useState<SupportIssueCode>(codes[0] ?? 'other');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ code: string; reopened: boolean } | null>(null);
  const bodyId = useId();
  const nameKey = (code: SupportIssueCode) => `issue_${code}` as const;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = body.trim();
    if (text.length === 0) {
      setError('err_empty');
      document.getElementById(bodyId)?.focus();
      return;
    }
    setBusy(true);
    const res = await openThread(
      locale,
      {
        issueCode: issue,
        orderCode: subject.kind === 'order' ? subject.code : null,
        serviceCode: subject.kind === 'service' ? subject.code : null,
        body: text,
      },
      files,
    );
    setBusy(false);
    if (!res.ok) {
      setError(threadErrorKey(res.code));
      document.getElementById(bodyId)?.focus();
      return;
    }
    setError(null);
    setBody('');
    setFiles([]);
    setSent(res.data);
    track('support_ticket', {
      action: res.data.reopened ? 'thread_reopened' : 'thread_opened',
      issue,
      channel: 'web',
    });
    if (files.length > 0) track('support_ticket', { action: 'photos_attached', issue, channel: 'web' });
    await onOpened();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      noValidate
      className={portalCard}
      aria-labelledby={`${bodyId}-title`}
    >
      <h3 id={`${bodyId}-title`} className="font-heading text-base font-extrabold text-ink">
        {t(subject.kind === 'order' ? 'openTitleOrder' : 'openTitleService', { code: subject.code })}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-muted">{t('openIntro')}</p>
      <fieldset className="mt-3">
        <legend className="text-xs font-bold text-muted">{t('issueLegend')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {codes.map((code) => (
            <label
              key={code}
              className="press inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-line-card bg-pill px-4 text-sm font-bold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-soft-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
            >
              <input
                type="radio"
                name={`${bodyId}-issue`}
                value={code}
                checked={issue === code}
                onChange={() => {
                  setIssue(code);
                }}
                className="sr-only"
              />
              {t(nameKey(code))}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={bodyId} className="mt-3 block text-xs font-bold text-muted">
        {t('messageLabel')}
      </label>
      <textarea
        id={bodyId}
        rows={4}
        maxLength={BODY_MAX}
        value={body}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${bodyId}-error` : `${bodyId}-help`}
        onChange={(e) => {
          setBody(e.target.value);
          setSent(null);
        }}
        className={`${portalField} py-2`}
      />
      <p id={`${bodyId}-help`} className="mt-1 text-xs text-muted">
        {t('messageHelp', { max: BODY_MAX })}
      </p>
      <div className="mt-3">
        <PhotoPicker files={files} onChange={setFiles} label={t('photosLabel')} />
      </div>
      {error ? (
        <p id={`${bodyId}-error`} role="alert" className="mt-2 text-sm font-bold text-error">
          {t(error as 'err_generic')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {busy ? t('sending') : t('send')}
        </button>
        <p role="status" className="text-sm font-bold text-success">
          {sent ? t(sent.reopened ? 'sentContinued' : 'sentNew', { code: sent.code }) : null}
        </p>
      </div>
    </form>
  );
}
