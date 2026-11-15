import type { AppDeps } from './types';

/**
 * Tell the website to refresh what it cached by tag after staff publish content (design 2026-11-15 items 5, 6, 8;
 * the website's `/api/revalidate`, header secret `REVALIDATE_SECRET`). Best effort: the website's cache also expires
 * on its own within 60 seconds, so a failure here never fails the publish and nothing is retried.
 */
export type WebTag = 'content' | 'site-layout' | 'company';

export type Revalidator = (tags: readonly WebTag[]) => Promise<void>;

export function createRevalidator(
  config: { webBaseUrl: string; revalidateSecret: string | null },
  fetchImpl: typeof fetch = fetch,
): Revalidator {
  return async (tags) => {
    if (!config.revalidateSecret) return;
    try {
      await fetchImpl(new URL('/api/revalidate', config.webBaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': config.revalidateSecret },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // The 60-second cache window is the fallback.
    }
  };
}

/** Revalidate through the injected revalidator (tests) or the configured one. */
export async function revalidateWeb(deps: AppDeps, tags: readonly WebTag[]): Promise<void> {
  await (deps.revalidate ?? createRevalidator(deps.config))(tags);
}
