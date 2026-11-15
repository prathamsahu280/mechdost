/**
 * Console lines the audit causes itself. Every third-party origin is blocked during a run (so a case never depends on
 * the internet), and the browser logs those blocked loads as errors: "Failed to load resource: net::ERR_FAILED" for
 * an image or font, and MapLibre's "AJAXError: Failed to fetch (0): <url>" for a map style. Neither says anything
 * about the site. Pure: unit-tested in Node (`test/state-audit-console.test.ts`).
 */

/** The origins that are the site's own or the mocked API's; everything else is blocked by the harness. */
const OWN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/;
const external = (url: string): boolean => /^https?:\/\//.test(url) && !OWN.test(url);

/** True when `text` (logged from `locationUrl`) is the page reporting a load the audit blocked on purpose. */
export function isBlockedOriginNoise(text: string, locationUrl: string): boolean {
  if (text.startsWith('Failed to load resource')) return external(locationUrl);
  const ajax = /AJAXError: Failed to fetch \(0\): (https?:\/\/\S+)/.exec(text);
  return ajax !== null && external(ajax[1] ?? '');
}
