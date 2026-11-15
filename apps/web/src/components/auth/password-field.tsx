'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type Ref } from 'react';

export const authInput =
  'mt-1 min-h-12 w-full rounded-input border border-input-border bg-surface px-3 text-[16px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';

/**
 * Password input with a show/hide toggle (paste allowed, no composition rules: NIST SP 800-63B-4). The toggle is
 * a real button with a fixed name whose `aria-pressed` carries the state (a changing name plus pressed said the
 * state twice, a11y review 2026-11-09); `autoComplete` tells password managers what to do. `error` shows next to
 * the input and is part of its description, before the hint (WCAG 3.3.1).
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  hint,
  error,
  inputRef,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  /** Error text for this field, or null. */
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-bold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={256}
          spellCheck={false}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          className={`${authInput} pr-14`}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={t('showPassword')}
          aria-controls={id}
          data-inset-control=""
          onClick={() => {
            setVisible((v) => !v);
          }}
          className="absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-button text-muted hover:bg-pill hover:text-ink"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-5" />
          ) : (
            <Eye aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>
      {error ? (
        <p id={errorId} className="mt-1 text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
