/**
 * Password sign-in (spec 01 "Password sign-in", decision 2026-11-01): phone or email + password → Firebase
 * custom token. One message for an unknown account and a wrong password (and the same work for both);
 * 5 failures per identifier in 15 minutes lock it; Turnstile first; staff need a second step with a fresh phone
 * code, and staff routes refuse a session made without it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakePasswordAuthority, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let auth: FakePasswordAuthority;
const HUMAN = 'turnstile-ok-0000000000';

async function account(n: string, opts: { staff?: boolean } = {}) {
  const firebaseUid = `pw-${n}`;
  const phone = `+9198555555${n}`;
  const email = `Pw-${n}@Example.com`;
  const user = await ensureUser(ctx.db, { firebaseUid, phone, email, emailVerified: true });
  auth.add(email, firebaseUid, 'Raipur@2026');
  if (opts.staff) await grantRole(ctx.db, { userId: user.id, role: 'super_admin', grantedBy: null });
  return { user, firebaseUid, phone, email };
}

const signIn = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  ctx.app.request('/v1/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ turnstileToken: HUMAN, ...body }),
  });

beforeAll(async () => {
  auth = new FakePasswordAuthority();
  const turnstile = new FakeTurnstile([HUMAN]);
  ctx = await buildApp({ passwordAuth: auth, turnstile });
});

describe('POST /v1/auth/password', () => {
  it('signs a customer in by phone (any way it is typed) or by email, with a custom token', async () => {
    const a = await account('01');
    const byPhone = await signIn({ identifier: '98555 55501', password: 'Raipur@2026' });
    expect(byPhone.status).toBe(200);
    expect(await byPhone.json()).toEqual({ status: 'signed_in', customToken: 'ct:pw-01:{}' });
    const byEmail = await signIn({ identifier: a.email.toUpperCase(), password: 'Raipur@2026' });
    expect(await byEmail.json()).toEqual({ status: 'signed_in', customToken: 'ct:pw-01:{}' });
  });

  it('answers a wrong password and an unknown account identically, after the same check', async () => {
    const a = await account('02');
    const wrong = await signIn({ identifier: a.phone, password: 'not-the-password' });
    const checksBefore = auth.checks.length;
    const unknown = await signIn({ identifier: '+919000000001', password: 'whatever-1' });
    expect(auth.checks.length).toBe(checksBefore + 1); // constant work: Firebase is asked either way
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    const strip = (b: ErrorJson) => ({ ...b.error, requestId: '' });
    expect(strip((await wrong.json()) as ErrorJson)).toEqual(strip((await unknown.json()) as ErrorJson));
    const audits = (await ctx.db.select().from(s.auditLog)).filter(
      (r) => r.action === 'auth.password_failed',
    );
    expect(audits.some((r) => r.actorUserId === a.user.id)).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(a.phone); // never the identifier in clear text
  });

  it('locks an identifier after 5 failures in 15 minutes, known or not, even for the right password', async () => {
    const a = await account('03');
    for (let i = 0; i < 5; i++) await signIn({ identifier: a.email, password: `wrong-${String(i)}` });
    const locked = await signIn({ identifier: a.email, password: 'Raipur@2026' });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as ErrorJson).error.code).toBe('ACCOUNT_LOCKED');
    expect(locked.headers.get('retry-after')).toBeTruthy();
    // The phone of the same account is its own identifier key, but an unknown one locks the same way.
    for (let i = 0; i < 5; i++)
      await signIn({ identifier: 'ghost@example.com', password: `wrong-${String(i)}` });
    const ghost = await signIn({ identifier: 'ghost@example.com', password: 'x-password' });
    expect(((await ghost.json()) as ErrorJson).error.code).toBe('ACCOUNT_LOCKED');
  });

  it('parallel guesses cannot pass the lock: 10 at once reach Firebase at most 5 times (security review)', async () => {
    const a = await account('09');
    const before = auth.checks.length;
    const results = await Promise.all(
      Array.from({ length: 10 }, async (_, i) =>
        signIn({ identifier: a.phone, password: `guess-${String(i)}` }),
      ),
    );
    expect(auth.checks.length - before).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
  });

  it('a successful sign-in clears the failures of that identifier', async () => {
    const a = await account('10');
    for (let i = 0; i < 4; i++) await signIn({ identifier: a.email, password: `wrong-${String(i)}` });
    expect((await signIn({ identifier: a.email, password: 'Raipur@2026' })).status).toBe(200);
    for (let i = 0; i < 4; i++) await signIn({ identifier: a.email, password: `wrong-again-${String(i)}` });
    expect((await signIn({ identifier: a.email, password: 'Raipur@2026' })).status).toBe(200);
  });

  it('right after sign-up the profile has no email yet: the password is checked against the Firebase email', async () => {
    // Phone sign-up made the row (phone only); the password was just linked in Firebase under this email.
    await ensureUser(ctx.db, {
      firebaseUid: 'pw-11',
      phone: '+919855555511',
      email: null,
      emailVerified: false,
    });
    auth.add('fresh-11@example.com', 'pw-11', 'Raipur@2026');
    const r = await signIn({ identifier: '9855555511', password: 'Raipur@2026' });
    expect(await r.json()).toEqual({ status: 'signed_in', customToken: 'ct:pw-11:{}' });
  });

  it('refuses without a valid Turnstile token, before asking Firebase', async () => {
    await account('04');
    const before = auth.checks.length;
    const bot = await signIn({
      identifier: '+919855555504',
      password: 'Raipur@2026',
      turnstileToken: 'robot',
    });
    expect(bot.status).toBe(400);
    expect(((await bot.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
    expect(auth.checks.length).toBe(before);
  });

  it('staff: the password alone returns the phone step; a fresh phone code of the same account finishes it', async () => {
    const a = await account('05', { staff: true });
    const first = await signIn({ identifier: a.email, password: 'Raipur@2026' });
    expect(await first.json()).toEqual({ status: 'staff_code', phone: a.phone });

    const fresh = ctx.verifier.add('phone-token-staff-05-fresh', {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
    });
    const done = await signIn({ identifier: a.email, password: 'Raipur@2026' }, bearer(fresh));
    expect(await done.json()).toEqual({ status: 'signed_in', customToken: 'ct:pw-05:{"staff_2fa":true}' });

    const stale = ctx.verifier.add('phone-token-staff-05-stale', {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
      authTime: Math.floor(Date.now() / 1000) - 600,
    });
    const late = await signIn({ identifier: a.email, password: 'Raipur@2026' }, bearer(stale));
    expect(((await late.json()) as ErrorJson).error.code).toBe('STAFF_CODE_EXPIRED');

    const other = await account('06');
    const wrongPerson = ctx.verifier.add('phone-token-other-06', {
      firebaseUid: other.firebaseUid,
      phone: other.phone,
    });
    const mismatch = await signIn({ identifier: a.email, password: 'Raipur@2026' }, bearer(wrongPerson));
    expect(((await mismatch.json()) as ErrorJson).error.code).toBe('STAFF_CODE_MISMATCH');
  });

  // Security review 2026-11-14 ("2FA code replay"): one phone code finishes one staff sign-in, not several.
  it('staff: a phone code is used once; a replay within its 5 minutes is refused', async () => {
    const a = await account('12', { staff: true });
    const phone = ctx.verifier.add('phone-token-staff-12-once', {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
    });
    const first = await signIn({ identifier: a.email, password: 'Raipur@2026' }, bearer(phone));
    expect(((await first.json()) as { status: string }).status).toBe('signed_in');
    const replay = await signIn({ identifier: a.email, password: 'Raipur@2026' }, bearer(phone));
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as ErrorJson).error.code).toBe('STAFF_CODE_USED');
  });

  it('is unavailable (503), not open, when Firebase cannot answer', async () => {
    await account('07');
    auth.failNext = true;
    const r = await signIn({ identifier: '+919855555507', password: 'Raipur@2026' });
    expect(r.status).toBe(503);
    expect(((await r.json()) as ErrorJson).error.code).toBe('AUTH_UNAVAILABLE');
  });
});

describe('staff routes need the two-step session', () => {
  it('a phone-only session of a staff member keeps customer access but not staff permissions', async () => {
    const a = await account('08', { staff: true });
    const phoneOnly = ctx.verifier.add('phone-only-staff-08-token', {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
      email: a.email,
      emailVerified: true,
      staff2fa: false,
    });
    expect((await ctx.app.request('/v1/me', { headers: bearer(phoneOnly) })).status).toBe(200);
    const refused = await ctx.app.request('/v1/admin/settings', { headers: bearer(phoneOnly) });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as ErrorJson).error.code).toBe('STAFF_2FA_REQUIRED');

    const twoStep = ctx.verifier.add('two-step-staff-08-token', {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
      email: a.email,
      emailVerified: true,
      signInProvider: 'custom',
      staff2fa: true,
    });
    expect((await ctx.app.request('/v1/admin/settings', { headers: bearer(twoStep) })).status).toBe(200);

    const yesterday = ctx.verifier.add('two-step-staff-08-old-token', {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
      email: a.email,
      emailVerified: true,
      signInProvider: 'custom',
      staff2fa: true,
      authTime: Math.floor(Date.now() / 1000) - 13 * 3600,
    });
    const expired = await ctx.app.request('/v1/admin/settings', { headers: bearer(yesterday) });
    expect(((await expired.json()) as ErrorJson).error.code).toBe('STAFF_2FA_REQUIRED');
  });
});

describe('without the sign-in services configured', () => {
  it('answers 503 AUTH_UNAVAILABLE', async () => {
    const bare = await buildApp({ passwordAuth: null, turnstile: null });
    const r = await bare.app.request('/v1/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: '9855555501', password: 'Raipur@2026', turnstileToken: HUMAN }),
    });
    expect(r.status).toBe(503);
  });
});
