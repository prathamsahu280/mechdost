/**
 * Pure helpers that make the usual transient sign-in failures heal themselves (2026-11-23 sign-in speed pass).
 * Unit-tested without the SDK or a browser.
 */

/** Cloudflare tokens live 300 s and work once; one held back from earlier is used only while younger than this. */
export const TOKEN_MAX_AGE_MS = 240_000;

/** True while a pre-fetched Turnstile token is still safe to send. */
export function tokenUsable(issuedAt: number, now: number): boolean {
  return now >= issuedAt && now - issuedAt < TOKEN_MAX_AGE_MS;
}

/** How long an early check started in one form stays worth keeping before a touch starts another. */
export const PREFETCH_REUSE_MS = 60_000;

/**
 * Whether touching a form should start the early Cloudflare check. Keyed by the container element, not by time
 * alone: a form swapped in ("Forgot password?") has a new container that never had a check, however recently the
 * previous form started one (user report 2026-11-24: the reset button felt slow because its check only began on
 * submit). The same, still-mounted container is not started twice inside the reuse window.
 */
export function shouldPrefetch(
  last: { el: unknown; at: number } | null,
  container: { isConnected: boolean } | null,
  now: number,
): boolean {
  if (!container) return false;
  if (last?.el !== container) return true;
  return now - last.at >= PREFETCH_REUSE_MS;
}

/**
 * Steps that finish with a password sign-in of their own (a second single-use Cloudflare token): the staff code
 * step, the end of sign-up and the end of a phone reset. They start the check as they open, so the token is
 * waiting when the code or the button arrives (user report 2026-11-25: the staff code took over 30 s because the
 * check only began after the code was confirmed).
 */
const EARLY_CHECK_STEPS: ReadonlySet<string> = new Set(['staff', 'signup-profile', 'forgot-password']);

export function startsEarlyCheck(step: string): boolean {
  return EARLY_CHECK_STEPS.has(step);
}

/** Run `attempt`; when `shouldRetry` says its result was a transient failure, run it once more and use that. */
export async function retryOnce<T>(
  attempt: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
): Promise<T> {
  const first = await attempt();
  return shouldRetry(first) ? attempt() : first;
}

/**
 * Holds the staff challenge between the password step and the code step (2026-11-25). It is only taken once the phone
 * code is confirmed: a mistyped code must not spend it, or the next try would run a cold Cloudflare check.
 */
export function createChallengeSlot() {
  let held = '';
  return {
    set(value: string | undefined) {
      held = value ?? '';
    },
    has: () => held !== '',
    /** The challenge, once; empty after. */
    take() {
      const value = held;
      held = '';
      return value;
    },
    clear() {
      held = '';
    },
  };
}

/**
 * One sign-in call that may carry earlier proof of the bot check (the staff challenge): the proof is used for the
 * first attempt only, and when the API refuses it as a failed bot check (`refused`) the call is made again with a
 * real check (`withCheck`, which may return null when that check itself failed).
 */
export async function attemptWithProof<R>(opts: {
  proof: string | undefined;
  withProof: (proof: string) => Promise<R>;
  withCheck: () => Promise<R | null>;
  refused: (result: R) => boolean;
}): Promise<R | null> {
  let left = opts.proof;
  return retryOnce(
    async () => {
      if (left) {
        const proof = left;
        left = undefined;
        return opts.withProof(proof);
      }
      return opts.withCheck();
    },
    (result) => result !== null && opts.refused(result),
  );
}

/** Firebase codes that mean "the network blinked": the same call is worth one more try. */
export function isTransientAuthCode(code: string | undefined): boolean {
  return code === 'auth/network-request-failed' || code === 'auth/internal-error';
}
