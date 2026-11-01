'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type Ref } from 'react';

export const authInput =
  'mt-1 min-h-12 w-full rounded-input border border-input-border bg-surface px-3 text-[16px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';

/**
 * Password input with a show/hide toggle (paste allowed, no composition rules: NIST SP 800-63B-4). The toggle is
 * a real button with a state the screen reader announces; `autoComplete` tells password managers what to do.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  hint,
  invalid,
  describedBy,
  inputRef,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
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
          aria-invalid={invalid ? true : undefined}
          aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
          className={`${authInput} pr-14`}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          aria-controls={id}
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
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
