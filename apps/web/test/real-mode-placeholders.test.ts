/**
 * Real-API pass 2026-11-16: a real sign-in with phone 9000000001 showed the browser demo's seeded shop owner
 * ("Hello, Rakesh Sharma", "Member since 1 Aug 2026"), because real sign-in reused any stored account with the same
 * phone; and /admin showed the demo-only "stored on this device" note while connected to the API.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('real mode never shows demo placeholders', () => {
  it('real sign-in reuses only accounts made by earlier real sign-ins, never a seeded demo account', () => {
    expect(src('demo/session.ts')).toMatch(
      /const found = findAccount\(phone\);\s*const existing = found\?\.id\.startsWith\('real-'\) \? found : undefined;/,
    );
  });
  it('the portal guard shows the demo note only in demo builds by default', () => {
    expect(src('components/portal/portal-guard.tsx')).toMatch(/demoNote = SHOW_DEMO_CONTROLS,/);
  });
});
