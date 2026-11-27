/**
 * DC-P4 (QA 2026-11-27): right after accepting a delivery invite the new agent saw "Sign in to continue" on the
 * portal until they signed out and in, because the web session's landing role is computed once at sign-in
 * (`demoRoleFor`). After a real acceptance the web refreshes `/v1/me` with a fresh ID token and re-adopts the account,
 * so the next screen is the agent portal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoRoleFor } from '../src/lib/auth/real-account';

describe('accepting an invite refreshes the session (DC-P4)', () => {
  it('a customer who just became an agent lands on the agent portal', () => {
    const me = {
      roles: [{ role: 'delivery_agent', shopId: null, workshopId: null, cityId: null }],
    } as unknown as Parameters<typeof demoRoleFor>[0];
    expect(demoRoleFor(me)).toBe('delivery_agent');
  });

  it('the invite screen refreshes /v1/me and the session after a real acceptance', () => {
    const src = readFileSync(new URL('../src/components/delivery/agent-invite.tsx', import.meta.url), 'utf8');
    const accept = src.slice(src.indexOf('async function accept()'), src.indexOf('setDone(true)'));
    expect(accept).toContain('fetchMe(true)');
    expect(accept).toContain('adoptRealAccount(');
  });
});
