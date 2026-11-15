import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Live pings for service requests (design 2026-11-16, spec 06/10): the customer's request page, the workshop portal and
 * the admin service queue refresh on a `request` ping, and keep their polling as the fallback. Checked from the source
 * (no browser): the wiring, the light hook, and that polling was not removed.
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

describe('service request screens listen for live pings', () => {
  it('the customer request page refreshes on a request ping and still polls', () => {
    const text = read('components/workshops/request-view-api.tsx');
    expect(text).toMatch(/useLivePings\(\s*\['request'\]/);
    expect(text).toMatch(/setInterval/);
  });

  it('the workshop portal feeds (new and active) listen for request pings and still poll', () => {
    const text = read('components/portal/workshop-portal-api.tsx');
    expect(text).toMatch(/useApiList\(newPage, NEW_POLL_MS, \['request'\]\)/);
    expect(text).toMatch(/useApiList\(activePage, NEW_POLL_MS, \['request'\]\)/);
  });

  it('the admin service queue listens for request pings in every view', () => {
    const text = read('components/portal/admin-services-api.tsx');
    expect(text).toMatch(
      /useApiList\(page, view === 'needs_routing' \? POLL_MS : undefined, \['request'\]\)/,
    );
  });

  it('useApiList subscribes only when asked, through the light hook', () => {
    const text = read('components/portal/use-api-list.ts');
    expect(text).toMatch(/useLivePings\(\s*liveKinds \?\? \[\]/);
    expect(text).toMatch(/liveKinds\?: readonly LiveKind\[\]/);
    expect(text).toMatch(/window\.setInterval/);
  });

  it('the hook is light (hub only, no database SDK) and does nothing when live is not configured', () => {
    const text = read('lib/live/use-live-pings.ts');
    expect(text).not.toMatch(/@firebase|firebase/i);
    expect(text).toMatch(/from '\.\/live-hub'/);
    const hub = read('lib/live/live-hub.ts');
    // startLive is the single gate: not configured means a no-op release function and no connection.
    expect(hub).toMatch(
      /if \(!liveConfigured\(\) \|\| typeof window === 'undefined'\) return \(\) => undefined;/,
    );
  });

  it('request is one of the kinds the notification bell hub already knows', () => {
    expect(read('components/notices/use-notice-feed.ts')).toMatch(/'request'/);
  });
});
