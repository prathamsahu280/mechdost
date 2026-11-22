/** Types for the deploy warm-up script (`warm-cache.mjs`), so its tests are type-checked. */
export function warmUrls(sitemapXml: string, origin: string): string[];
export function waitBeforeNext(startedAt: number, now: number, gapMs: number): number;
