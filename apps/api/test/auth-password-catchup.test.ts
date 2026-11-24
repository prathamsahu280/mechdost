/**
 * Server-side catch-up for the "your password was changed" notice (decision 2026-11-24, security review): the page
 * call can be blocked or never made, so the first password sign-in after a change queues the same notice (same dedupe
 * key as the page call, so one mail per change). Firebase and Resend are fakes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { buildApp, FakeEmailActions, FakePasswordAuthority, FakeTurnstile } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let auth: FakePasswordAuthority;
let links: FakeEmailActions;
const HUMAN = 'turnstile-ok-0000000000';
const MIN = 60_000;

async function account(n: string) {
  const firebaseUid = `cu-${n}`;
  const email = `cu-${n}@example.com`;
  await ensureUser(ctx.db, { firebaseUid, phone: `+9198444444${n}`, email, emailVerified: true });
  auth.add(email, firebaseUid, 'Raipur@2026');
  return { firebaseUid, email };
}
const changed = (a: { firebaseUid: string; email: string }, agoMs: number, createdAgoMs = 86_400_000) => {
  links.changes.set(a.email, {
    uid: a.firebaseUid,
    changedAt: new Date(Date.now() - agoMs),
    createdAt: new Date(Date.now() - createdAgoMs),
  });
};
const signIn = (identifier: string, password = 'Raipur@2026') =>
  ctx.app.request('/v1/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password, turnstileToken: HUMAN }),
  });
const notices = async (email: string) =>
  (await ctx.db.select().from(s.notificationOutbox)).filter(
    (r) => r.recipient === email && r.templateKey === 'auth_password_changed',
  );
/** The catch-up runs after the answer is sent: wait for it to land. */
async function settled(email: string, count: number) {
  for (let i = 0; i < 100; i++) {
    if ((await notices(email)).length >= count) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 60));
  return notices(email);
}

beforeAll(async () => {
  auth = new FakePasswordAuthority();
  links = new FakeEmailActions();
  ctx = await buildApp({ passwordAuth: auth, turnstile: new FakeTurnstile([HUMAN]), emailActions: links });
});

describe('password sign-in catch-up for the password-changed notice', () => {
  it('queues the notice at the first sign-in after a recent change, without any page call', async () => {
    const a = await account('01');
    changed(a, 2 * MIN);
    const res = await signIn(a.email);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'signed_in' });
    expect(await settled(a.email, 1)).toHaveLength(1);
  });

  it('shares the dedupe key with the page call: one mail per change, whichever comes first', async () => {
    const a = await account('02');
    changed(a, 2 * MIN);
    await ctx.app.request('/v1/auth/password-changed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: a.email, locale: 'en' }),
    });
    await signIn(a.email);
    expect(await settled(a.email, 2)).toHaveLength(1);
  });

  it('sends nothing for an old change, a failed sign-in, or an account created minutes ago', async () => {
    const old = await account('03');
    changed(old, 11 * MIN);
    await signIn(old.email);
    const wrong = await account('04');
    changed(wrong, MIN);
    await signIn(wrong.email, 'not-the-password');
    const fresh = await account('05');
    changed(fresh, 2 * MIN, 5 * MIN); // sign-up set the password a few minutes ago
    await signIn(fresh.email);
    for (const a of [old, wrong, fresh]) expect(await settled(a.email, 1)).toHaveLength(0);
  });

  it('never slows or breaks the sign-in when Firebase cannot answer the catch-up', async () => {
    const a = await account('06');
    changed(a, MIN);
    links.fail = true;
    const res = await signIn(a.email);
    links.fail = false;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'signed_in' });
    expect(await notices(a.email)).toHaveLength(0);
  });
});
