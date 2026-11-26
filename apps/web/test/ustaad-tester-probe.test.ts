/**
 * Preview testers on the web (founder 2026-11-27; spec 23 § 3): the browser cannot see the testers list, so during
 * `staff_preview` a signed-in non-staff viewer asks the gated `GET /v1/ustaad/me`. Only answers that prove the API's
 * gate let the caller through count; the gate's generic 404, any other error and sample (demo) data never do.
 */
import { describe, expect, it } from 'vitest';
import { passedUstaadGate } from '../src/lib/ustaad/tester-probe';

describe('passedUstaadGate', () => {
  it('a membership answer, or a member-level refusal behind the gate, means the gate let the caller in', () => {
    expect(passedUstaadGate({ ok: true, data: { member: null, staffPreview: false } }, false)).toBe(true);
    expect(passedUstaadGate({ ok: false, status: 404, code: 'USTAAD_NOT_MEMBER' }, false)).toBe(true);
    expect(passedUstaadGate({ ok: false, status: 403, code: 'USTAAD_BANNED' }, false)).toBe(true);
  });
  it("the gate's generic 404, a network failure or any other error keeps the network hidden", () => {
    expect(passedUstaadGate({ ok: false, status: 404, code: 'NOT_FOUND' }, false)).toBe(false);
    expect(passedUstaadGate({ ok: false, status: 0, code: 'NETWORK' }, false)).toBe(false);
    expect(passedUstaadGate({ ok: false, status: 500, code: 'INTERNAL' }, false)).toBe(false);
  });
  it('sample (demo) data never makes anyone a tester', () => {
    expect(passedUstaadGate({ ok: true, data: { member: null, staffPreview: true } }, true)).toBe(false);
  });
});
