'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type RefObject } from 'react';
import { cleanCodeInput, decideAutoSubmit, pastedCode, type AutoSubmitState } from './auto-submit-code';

interface Options {
  /** Digits in the code (6 for SMS codes, 4 for the delivery code). */
  length: number;
  /** Runs once per distinct complete value; `auto` is true for this hook's own call (analytics). */
  submit: (code: string, auto: boolean) => Promise<unknown> | undefined;
  /** False while something must finish first (an unsolved Turnstile): the hook waits, then sends. */
  ready?: boolean;
  /** A request is running (the Submit button or an earlier auto-submit): nothing is sent meanwhile. */
  busy?: boolean;
  /** `off` for a code that is not an SMS to this device (the delivery code). */
  autoComplete?: 'one-time-code' | 'off';
}

export interface CodeInputProps {
  ref: RefObject<HTMLInputElement | null>;
  value: string;
  inputMode: 'numeric';
  autoComplete: 'one-time-code' | 'off';
  pattern: string;
  maxLength: number;
  onChange: (e: { target: { value: string } }) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
}

/**
 * One code field for every place a fixed-length code is typed. Typing, pasting ("123 456", "123-456", a whole SMS)
 * or the phone's autofill fills it; at full length the code is submitted by itself, once per distinct value. A wrong
 * code keeps focus in the field with the text selected, so typing again replaces it. The Submit button stays as the
 * fallback; the caller shows it busy while its own `busy` is true. `checking` is true during the auto-submit, for the
 * "Checking code…" status line.
 */
export function useAutoSubmitCode({
  length,
  submit,
  ready = true,
  busy = false,
  autoComplete = 'one-time-code',
}: Options) {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const state = useRef<AutoSubmitState>({ tried: null });
  const flying = useRef(false);
  const latest = useRef(submit);
  useEffect(() => {
    latest.current = submit;
  });

  useEffect(() => {
    if (flying.current) return;
    const decision = decideAutoSubmit(state.current, { value, length, ready, busy });
    state.current = decision.state;
    if (!decision.fire) return;
    flying.current = true;
    setChecking(true);
    void Promise.resolve(latest.current(value, true)).finally(() => {
      flying.current = false;
      setChecking(false);
      const el = input.current;
      if (el?.isConnected) {
        el.focus();
        el.select();
      }
    });
  }, [value, length, ready, busy, checking]);

  const inputProps: CodeInputProps = {
    ref: input,
    value,
    inputMode: 'numeric',
    autoComplete,
    pattern: `\\d{${String(length)}}`,
    maxLength: length,
    onChange: (e) => {
      setValue(cleanCodeInput(e.target.value, length));
    },
    onPaste: (e) => {
      const code = pastedCode(e.clipboardData.getData('text'), length);
      if (code) {
        e.preventDefault();
        setValue(code);
      }
    },
  };
  return { value, setValue, checking, inputProps };
}
