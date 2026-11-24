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

/** Run `attempt`; when `shouldRetry` says its result was a transient failure, run it once more and use that. */
export async function retryOnce<T>(
  attempt: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
): Promise<T> {
  const first = await attempt();
  return shouldRetry(first) ? attempt() : first;
}

/** Firebase codes that mean "the network blinked": the same call is worth one more try. */
export function isTransientAuthCode(code: string | undefined): boolean {
  return code === 'auth/network-request-failed' || code === 'auth/internal-error';
}
