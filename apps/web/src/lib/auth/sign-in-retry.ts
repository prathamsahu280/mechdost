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
