import { describe, expect, it } from 'vitest';
import { isBlockedOriginNoise } from '../e2e/state-audit/console-noise.ts';

/**
 * The audit blocks every third-party origin (`page.route(...abort)`), so the page logs the failures it caused itself:
 * "Failed to load resource: net::ERR_FAILED" for a blocked image or font, and MapLibre's "AJAXError: Failed to fetch
 * (0)" for a blocked style. Those are the harness, not the site (batch 2c, 2026-11-16, runbook § 9.10). A failure of
 * the site's own origin is never noise.
 */
describe('console lines caused by the audit blocking third-party origins', () => {
  it('drops a failed load whose URL is a blocked third-party origin', () => {
    expect(
      isBlockedOriginNoise('Failed to load resource: net::ERR_FAILED', 'https://tiles.openfreemap.org/a.pbf'),
    ).toBe(true);
  });

  it("drops MapLibre's style fetch error for a blocked origin", () => {
    expect(
      isBlockedOriginNoise(
        'tV: AJAXError: Failed to fetch (0): https://tiles.openfreemap.org/styles/positron',
        'http://localhost:3101/_next/static/chunks/map.js',
      ),
    ).toBe(true);
  });

  it('keeps failures of the site itself and of the mocked API', () => {
    expect(
      isBlockedOriginNoise('Failed to load resource: net::ERR_FAILED', 'http://localhost:3101/_next/x.js'),
    ).toBe(false);
    expect(
      isBlockedOriginNoise(
        'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
        'http://localhost:3101/shop/x?_rsc=1',
      ),
    ).toBe(false);
    expect(
      isBlockedOriginNoise('Failed to load resource: net::ERR_FAILED', 'http://127.0.0.1:4100/v1/me'),
    ).toBe(false);
    expect(isBlockedOriginNoise('TypeError: x is not a function', '')).toBe(false);
  });

  it('keeps a resource failure with no known URL (it may be the site)', () => {
    expect(isBlockedOriginNoise('Failed to load resource: net::ERR_FAILED', '')).toBe(false);
  });
});
