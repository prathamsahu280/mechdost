/**
 * Staff sign-in, second call without a second Cloudflare check (decision 2026-11-25). The first call (Cloudflare
 * checked, password right, staff) returns a signed, 5-minute, single-use challenge bound to that user; the second
 * call presents it with the phone ID token of the same account. Without a good challenge Cloudflare is required.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { signStaffChallenge, STAFF_CHALLENGE_TTL_SECONDS } from '../src/auth/staff-challenge';
import { bearer, buildApp, FakePasswordAuthority, FakeTurnstile, type ErrorJson } from './helpers';

const k = () => randomBytes(32).toString('base64');
const newKeyring = () =>
  loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${k()}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: k(),
  });
const keyring = newKeyring();
const otherKeyring = newKeyring();

let ctx: Awaited<ReturnType<typeof buildApp>>;
let auth: FakePasswordAuthority;
const HUMAN = 'turnstile-ok-0000000000';
const PASSWORD = 'Raipur@2026';

async function staff(n: string) {
  const firebaseUid = `sc-${n}`;
  const phone = `+9198444444${n}`;
  const email = `sc-${n}@example.com`;
  const user = await ensureUser(ctx.db, { firebaseUid, phone, email, emailVerified: true });
  auth.add(email, firebaseUid, PASSWORD);
  await grantRole(ctx.db, { userId: user.id, role: 'super_admin', grantedBy: null });
  return { user, firebaseUid, phone, email };
}

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  ctx.app.request('/v1/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

type Staff = Awaited<ReturnType<typeof staff>>;
const first = async (a: Staff) => {
  const r = await post({ identifier: a.email, password: PASSWORD, turnstileToken: HUMAN });
  return (await r.json()) as { status: string; phone?: string; staffChallenge?: string };
};
const phoneToken = (a: Staff, id: string) =>
  bearer(ctx.verifier.add(id, { firebaseUid: a.firebaseUid, phone: a.phone }));
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

beforeAll(async () => {
  auth = new FakePasswordAuthority();
  ctx = await buildApp({ passwordAuth: auth, turnstile: new FakeTurnstile([HUMAN]), keyring });
});

describe('staff challenge on POST /v1/auth/password', () => {
  it('the first call returns a challenge; the second needs no Cloudflare token and finishes once', async () => {
    const a = await staff('01');
    const one = await first(a);
    expect(one.status).toBe('staff_code');
    expect(one.staffChallenge).toMatch(/^[\w-]+\.[\w-]+$/);
    const done = await post(
      { identifier: a.email, password: PASSWORD, staffChallenge: one.staffChallenge },
      phoneToken(a, 'sc-01-phone-token-a-00'),
    );
    expect(await done.json()).toEqual({ status: 'signed_in', customToken: 'ct:sc-01:{"staff_2fa":true}' });
  });

  it('a replay of the challenge is refused (a fresh phone code does not help)', async () => {
    const a = await staff('02');
    const one = await first(a);
    const body = { identifier: a.email, password: PASSWORD, staffChallenge: one.staffChallenge };
    expect((await post(body, phoneToken(a, 'sc-02-phone-token-a-00'))).status).toBe(200);
    const replay = await post(body, phoneToken(a, 'sc-02-phone-token-b-00'));
    expect(replay.status).toBe(400);
    expect(await code(replay)).toBe('TURNSTILE_FAILED');
  });

  it('two parallel second calls with the same challenge: exactly one is accepted', async () => {
    const a = await staff('12');
    const one = await first(a);
    const body = { identifier: a.email, password: PASSWORD, staffChallenge: one.staffChallenge };
    // Different phone sessions (auth times), so only the challenge can tell the twins apart.
    const now = Math.floor(Date.now() / 1000);
    const session = (id: string, authTime: number) =>
      bearer(ctx.verifier.add(id, { firebaseUid: a.firebaseUid, phone: a.phone, authTime }));
    const results = await Promise.all([
      post(body, session('sc-12-phone-token-a-00', now - 1)),
      post(body, session('sc-12-phone-token-b-00', now - 2)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('an expired challenge is refused', async () => {
    const a = await staff('03');
    const old = signStaffChallenge(
      keyring,
      { u: a.user.id, f: a.firebaseUid, p: a.phone },
      Date.now() - (STAFF_CHALLENGE_TTL_SECONDS + 5) * 1000,
    );
    const r = await post(
      { identifier: a.email, password: PASSWORD, staffChallenge: old },
      phoneToken(a, 'sc-03-phone-token-a-00'),
    );
    expect(await code(r)).toBe('TURNSTILE_FAILED');
  });

  it("another user's challenge is refused", async () => {
    const a = await staff('04');
    const b = await staff('05');
    const bs = await first(b);
    const r = await post(
      { identifier: a.email, password: PASSWORD, staffChallenge: bs.staffChallenge },
      phoneToken(a, 'sc-04-phone-token-a-00'),
    );
    expect(await code(r)).toBe('TURNSTILE_FAILED');
  });

  it('a forged challenge (signed with another key) is refused', async () => {
    const a = await staff('06');
    const forged = signStaffChallenge(otherKeyring, { u: a.user.id, f: a.firebaseUid, p: a.phone });
    const r = await post(
      { identifier: a.email, password: PASSWORD, staffChallenge: forged },
      phoneToken(a, 'sc-06-phone-token-a-00'),
    );
    expect(await code(r)).toBe('TURNSTILE_FAILED');
  });

  it('without a challenge the second call still needs Cloudflare', async () => {
    const a = await staff('07');
    const tok = phoneToken(a, 'sc-07-phone-token-a-00');
    const bare = await post({ identifier: a.email, password: PASSWORD }, tok);
    expect(await code(bare)).toBe('TURNSTILE_FAILED');
    const checked = await post({ identifier: a.email, password: PASSWORD, turnstileToken: HUMAN }, tok);
    expect(((await checked.json()) as { status: string }).status).toBe('signed_in');
  });

  it('a challenge without the phone token does not skip Cloudflare', async () => {
    const a = await staff('08');
    const one = await first(a);
    const r = await post({ identifier: a.email, password: PASSWORD, staffChallenge: one.staffChallenge });
    expect(await code(r)).toBe('TURNSTILE_FAILED');
  });

  it('a phone token of another account is refused even with a good challenge', async () => {
    const a = await staff('09');
    const b = await staff('10');
    const one = await first(a);
    const r = await post(
      { identifier: a.email, password: PASSWORD, staffChallenge: one.staffChallenge },
      phoneToken(b, 'sc-10-phone-token-a-00'),
    );
    expect(r.status).toBe(403);
    expect(await code(r)).toBe('STAFF_CODE_MISMATCH');
  });

  it('a wrong password with a good challenge still fails', async () => {
    const a = await staff('11');
    const one = await first(a);
    const r = await post(
      { identifier: a.email, password: 'not-the-password', staffChallenge: one.staffChallenge },
      phoneToken(a, 'sc-11-phone-token-a-00'),
    );
    expect(r.status).toBe(401);
    expect(await code(r)).toBe('INVALID_CREDENTIALS');
  });

  it('customers never get a challenge', async () => {
    await ensureUser(ctx.db, {
      firebaseUid: 'sc-cust',
      phone: '+919844444499',
      email: 'sc-cust@example.com',
      emailVerified: true,
    });
    auth.add('sc-cust@example.com', 'sc-cust', PASSWORD);
    const r = await post({ identifier: 'sc-cust@example.com', password: PASSWORD, turnstileToken: HUMAN });
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.status).toBe('signed_in');
    expect(body.staffChallenge).toBeUndefined();
  });

  it('without a keyring no challenge is issued (Cloudflare stays required)', async () => {
    const bare = await buildApp({ passwordAuth: auth, turnstile: new FakeTurnstile([HUMAN]), keyring: null });
    const user = await ensureUser(bare.db, {
      firebaseUid: 'sc-nk',
      phone: '+919844444488',
      email: 'sc-nk@example.com',
      emailVerified: true,
    });
    auth.add('sc-nk@example.com', 'sc-nk', PASSWORD);
    await grantRole(bare.db, { userId: user.id, role: 'super_admin', grantedBy: null });
    const r = await bare.app.request('/v1/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'sc-nk@example.com', password: PASSWORD, turnstileToken: HUMAN }),
    });
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.status).toBe('staff_code');
    expect(body.staffChallenge).toBeUndefined();
  });
});
