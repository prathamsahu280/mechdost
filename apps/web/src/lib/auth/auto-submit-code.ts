/**
 * Pure rules for submitting a one-time code as soon as it is complete (user, 2026-11-25). Only the server can say
 * whether a code is right, so the code is sent once per distinct complete value: never while another request runs,
 * never again for a value that was already tried (right or wrong), and only when the caller says it is `ready`
 * (for example, the bot check has finished).
 */

/** The order delivery code the customer reads out (spec 05); SMS codes are 6 digits. */
export const DELIVERY_CODE_LENGTH = 4;

/** Digits only, cut to the code length (typing and autofill). */
export function cleanCodeInput(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length);
}

/**
 * A pasted "123 456", "123-456" or a whole SMS: the first run of `length` digits once spaces and hyphens are removed.
 * Null when there is none, so the browser pastes as usual.
 */
export function pastedCode(text: string, length: number): string | null {
  return new RegExp(`\\d{${String(length)}}`).exec(text.replace(/[\s-]/g, ''))?.[0] ?? null;
}

export interface AutoSubmitState {
  /** The complete value last sent (or being sent by Submit); null once the field is no longer complete. */
  tried: string | null;
}

export interface AutoSubmitInput {
  value: string;
  length: number;
  /** False while something else must finish first (an unsolved Turnstile). */
  ready: boolean;
  /** A request is running (auto or the Submit button). */
  busy: boolean;
}

export function decideAutoSubmit(
  state: AutoSubmitState,
  { value, length, ready, busy }: AutoSubmitInput,
): { fire: boolean; state: AutoSubmitState } {
  const complete = value.length === length && /^\d+$/.test(value);
  if (!complete) return { fire: false, state: { tried: null } };
  // A press of Submit with this value counts as a try, so a wrong answer is not re-sent when the button frees up.
  if (busy) return { fire: false, state: { tried: value } };
  if (!ready || state.tried === value) return { fire: false, state };
  return { fire: true, state: { tried: value } };
}
