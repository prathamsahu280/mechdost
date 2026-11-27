import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN_HINT, signedInHintCookie, ustaadHiddenOnServer } from '@/lib/signed-in-hint';

// SIM-B1 (live QA 2026-11-27): signed out, /ustaad/* answered 200 with the storefront "page not found" drawn by the
// client gate, and the RSC payload carried the whole `ustaad` catalogue. During the staff preview a request without
// the signed-in hint must get the real 404 from the server (same status, title and body as an unknown path), so no
// network page (and none of its messages) is rendered at all.
describe('signed-out /ustaad answers the real 404 (SIM-B1)', () => {
  it('hidden on the server: staff preview in API mode without the hint', () => {
    expect(ustaadHiddenOnServer('staff_preview', undefined, 'api')).toBe(true);
    expect(ustaadHiddenOnServer('staff_preview', '0', 'api')).toBe(true);
    expect(ustaadHiddenOnServer('staff_preview', '1', 'api')).toBe(false);
    // Open network: signed-out visitors are asked to sign in (spec 23 § 5); demo mode keeps the client gate.
    expect(ustaadHiddenOnServer('open', undefined, 'api')).toBe(false);
    expect(ustaadHiddenOnServer('staff_preview', undefined, 'demo')).toBe(false);
  });

  it('the hint cookie is a plain flag, site-wide, lax, never carrying identity', () => {
    expect(signedInHintCookie(true)).toBe(
      `${SIGNED_IN_HINT}=1; path=/; max-age=31536000; samesite=lax; secure`,
    );
    expect(signedInHintCookie(false)).toBe(`${SIGNED_IN_HINT}=; path=/; max-age=0; samesite=lax; secure`);
  });

  it('the layout reads the cookie and calls notFound() before rendering anything', () => {
    const layout = readFileSync(new URL('../src/app/[locale]/ustaad/layout.tsx', import.meta.url), 'utf8');
    expect(layout).toMatch(
      /ustaadHiddenOnServer\(access, \(await cookies\(\)\)\.get\(SIGNED_IN_HINT\)\?\.value, DATA_MODE\)/,
    );
    const hidden = layout.indexOf('ustaadHiddenOnServer(');
    expect(layout.indexOf('notFound()', hidden)).toBeGreaterThan(hidden);
    expect(layout.indexOf('getTranslations(', hidden)).toBeGreaterThan(hidden);
  });

  it('sign-in sets the hint and sign-out clears it; an older session gets it on first read', () => {
    const session = readFileSync(new URL('../src/demo/session.ts', import.meta.url), 'utf8');
    const state = readFileSync(new URL('../src/demo/session-state.ts', import.meta.url), 'utf8');
    expect(session).toMatch(/function startSession[\s\S]*?writeSignedInHint\(true\)/);
    expect(session).toMatch(/export function signOut\(\) \{[\s\S]*?writeSignedInHint\(false\)/);
    expect(state).toMatch(/syncSignedInHint\(/);
  });
});
