'use client';

import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';

/**
 * Building blocks of the business application forms (audience entry design 2026-11-22, accessibility requirements):
 * every field has a visible label, required fields say so in text, choices are native radio / checkbox groups in a
 * fieldset with a legend, hints and errors are linked with `aria-describedby`, the error summary links to each field.
 */
export const inputClass =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink aria-[invalid=true]:border-error focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
const labelClass = 'text-sm font-bold text-ink';
const errorClass = 'mt-1 text-xs font-bold text-error';
const hintClass = 'mt-1 text-xs text-muted';

export const fieldId = (name: string) => `biz-${name}`;

export function RequiredMark({ required }: { required: boolean }) {
  const t = useTranslations('business');
  return (
    <span className="ml-1 text-xs font-normal text-muted">({required ? t('required') : t('optional')})</span>
  );
}

const describedBy = (id: string, hint: boolean, error: boolean) =>
  [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

export function TextField({
  name,
  label,
  required,
  hint,
  error,
  value,
  onChange,
  inputMode,
  autoComplete,
  type = 'text',
  maxLength,
}: {
  name: string;
  label: string;
  required: boolean;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'numeric' | 'text' | 'email' | 'tel';
  autoComplete: string;
  type?: 'text' | 'email' | 'tel';
  maxLength: number;
}) {
  const id = fieldId(name);
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        <RequiredMark required={required} />
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        {...(inputMode ? { inputMode } : {})}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={inputClass}
      />
      {hint ? (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
}) {
  const id = fieldId(name);
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        <RequiredMark required={false} />
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={`${inputClass} py-2`}
      />
      {hint ? (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Three whole-number fields (vehicles by type) in one fieldset with one legend, hint and error. */
export function CountGroup({
  name,
  legend,
  hint,
  error,
  fields,
}: {
  name: string;
  legend: string;
  hint: string;
  error?: string;
  fields: readonly { key: string; label: string; value: string; onChange: (v: string) => void }[];
}) {
  const id = fieldId(name);
  return (
    <fieldset id={id} tabIndex={-1} aria-describedby={describedBy(id, true, Boolean(error))}>
      <legend className={labelClass}>
        {legend}
        <RequiredMark required />
      </legend>
      <p id={`${id}-hint`} className={hintClass}>
        {hint}
      </p>
      <div className="mt-2 grid gap-3 min-[480px]:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={`${id}-${f.key}`} className="text-sm text-ink">
              {f.label}
            </label>
            <input
              id={`${id}-${f.key}`}
              name={f.key}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={f.value}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                f.onChange(e.target.value);
              }}
              className={inputClass}
            />
          </div>
        ))}
      </div>
      {error ? (
        <p id={`${id}-error`} className={errorClass}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function ChoiceGroup({
  name,
  legend,
  required,
  hint,
  error,
  type,
  options,
  selected,
  onToggle,
}: {
  name: string;
  legend: string;
  required: boolean;
  hint?: string;
  error?: string;
  type: 'radio' | 'checkbox';
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  const id = fieldId(name);
  return (
    <fieldset id={id} tabIndex={-1} aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}>
      <legend className={labelClass}>
        {legend}
        <RequiredMark required={required} />
      </legend>
      {hint ? (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
          >
            <input
              type={type}
              name={name}
              value={o.value}
              checked={selected.includes(o.value)}
              aria-invalid={error ? true : undefined}
              onChange={() => {
                onToggle(o.value);
              }}
              className="size-5 accent-[var(--color-accent-button)]"
            />
            <span data-user-content>{o.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-error`} className={errorClass}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function ConsentField({
  checked,
  onChange,
  label,
  error,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  error?: string;
}) {
  const id = fieldId('consent');
  return (
    <div>
      <label htmlFor={id} className="flex items-start gap-3 text-sm text-ink">
        <input
          id={id}
          name="consent"
          type="checkbox"
          checked={checked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            onChange(e.target.checked);
          }}
          className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
        />
        <span>
          {label}
          <RequiredMark required />
        </span>
      </label>
      {error ? (
        <p id={`${id}-error`} className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Focus goes here when a submit fails; each item links to its field and moves focus there. */
export function ErrorSummary({
  items,
  summaryRef,
}: {
  items: readonly { name: string; message: string; label: string }[];
  summaryRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('business');
  if (items.length === 0) return null;
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-error bg-warning-bg px-4 py-3 text-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <h2 className="font-bold text-ink">{t('errorSummary')}</h2>
      <ul className="mt-1 list-disc pl-5">
        {items.map((i) => (
          <li key={i.name}>
            <a
              href={`#${fieldId(i.name)}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(fieldId(i.name))?.focus();
              }}
              className="font-bold text-ink underline"
            >
              {i.label}
            </a>
            : {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FormError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
      {text}
    </p>
  );
}

export function SubmitButton({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus min-[600px]:w-auto"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
