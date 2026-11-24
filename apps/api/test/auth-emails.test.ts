/**
 * Account emails we send ourselves (decision 2026-11-24, spec 01 "Account emails", spec 10): the reset email is
 * public (Turnstile, per-IP and per-address limits, one answer for every address), the verification email needs a
 * sign-in and goes to the Firebase account's own address. The link in the mail points at our /auth/action page.
 * Firebase and Resend are fakes.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, events, openPayload, type OutboxRow } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { createEmailAdapter } from '../src/notify/email';
import { bearer, buildApp, FakeEmailActions, FakeTurnstile, type ErrorJson } from './helpers';

const HUMAN = 'turnstile-ok-0000000000';
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

async function setup(opts: { configured?: boolean } = {}) {
  const links = new FakeEmailActions();
  const ctx = await buildApp({
    emailActions: opts.configured === false ? null : links,
    turnstile: new FakeTurnstile([HUMAN]),
    keyring,
  });
  return { ...ctx, links };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const reset = (ctx: Ctx, body: Record<string, unknown>) =>
  ctx.app.request('/v1/auth/password-reset-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'en', turnstileToken: HUMAN, ...body }),
  });

const outboxFor = async (ctx: Ctx, email: string) =>
  (await ctx.db.select().from(s.notificationOutbox)).filter((r) => r.recipient === email);

const strip = (b: unknown) => JSON.stringify(b);

describe('POST /v1/auth/password-reset-email', () => {
  it('queues the reset email for a known address, with the code sealed and no code in the dedupe key', async () => {
    const ctx = await setup();
    ctx.links.resets.set('asha@example.com', 'reset-code-0123456789');
    const res = await reset(ctx, { email: ' Asha@Example.com ', locale: 'hi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'accepted' });
    const [row] = await outboxFor(ctx, 'asha@example.com');
    expect(row).toMatchObject({ channel: 'email', templateKey: 'auth_password_reset', locale: 'hi' });
    expect(row?.dedupeKey).not.toContain('reset-code');
    expect(JSON.stringify(row?.payload)).not.toContain('reset-code-0123456789'); // encrypted at rest
    expect(row?.payload).toMatchObject({ mode: 'resetPassword', lang: 'hi' });
    const queued = await ctx.db.select().from(events).where(eq(events.event, 'auth_email_action_requested'));
    expect(queued.some((e) => JSON.stringify(e.props) === '{"mode":"resetPassword","queued":true}')).toBe(
      true,
    );
    expect(JSON.stringify(queued)).not.toContain('asha@example.com');
  });

  it('the mail links to our own action page, in both languages (link building through the real sender)', async () => {
    const ctx = await setup();
    for (const [locale, prefix] of [
      ['en', ''],
      ['hi', '/hi'],
    ] as const) {
      const email = `link-${locale}@example.com`;
      ctx.links.resets.set(email, `code-${locale}-0123456789`);
      await reset(ctx, { email, locale });
      const [row] = await outboxFor(ctx, email);
      const sent: string[] = [];
      const adapter = createEmailAdapter(
        {
          apiKey: 're_test_0123456789abcdefghij',
          domain: 'mechdost.com',
          webBaseUrl: 'https://mechdost.com',
        },
        {
          fetchImpl: ((_url: string, init: RequestInit) => {
            sent.push(init.body as string);
            return Promise.resolve(new Response(JSON.stringify({ id: 'e1' }), { status: 200 }));
          }) as unknown as typeof fetch,
        },
      );
      await adapter.send({
        ...(row as unknown as OutboxRow),
        payload: openPayload(row?.payload as Record<string, unknown>, keyring),
      });
      const mail = JSON.parse(sent[0] ?? '{}') as { text: string; from: string };
      expect(mail.text).toContain(
        `https://mechdost.com${prefix}/auth/action?mode=resetPassword&oobCode=code-${locale}-0123456789&lang=${locale}`,
      );
      expect(mail.from).toBe('MechDost <noreply@mechdost.com>');
    }
  });

  it('answers an unknown address, a known one, an over-limit one and a Firebase failure identically', async () => {
    const ctx = await setup();
    ctx.links.resets.set('known@example.com', 'reset-code-aaaaaaaaaa');
    const known = await reset(ctx, { email: 'known@example.com' });
    const unknown = await reset(ctx, { email: 'nobody@example.com' });
    ctx.links.fail = true;
    const broken = await reset(ctx, { email: 'broken@example.com' });
    ctx.links.fail = false;
    for (let i = 0; i < 3; i++) await reset(ctx, { email: 'known@example.com' });
    const limited = await reset(ctx, { email: 'known@example.com' });
    const answers = [known, unknown, broken, limited];
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const bodies = await Promise.all(answers.map(async (r) => strip(await r.json())));
    expect(new Set(bodies).size).toBe(1);
    expect(await outboxFor(ctx, 'nobody@example.com')).toHaveLength(0);
    expect(await outboxFor(ctx, 'broken@example.com')).toHaveLength(0);
  });

  it('asks Firebase for every address at most 3 times an hour (counted before any lookup)', async () => {
    const ctx = await setup();
    ctx.links.resets.set('three@example.com', 'reset-code-bbbbbbbbbb');
    for (let i = 0; i < 6; i++) await reset(ctx, { email: 'THREE@example.com' });
    for (let i = 0; i < 4; i++) await reset(ctx, { email: 'ghost@example.com' });
    expect(ctx.links.asked.filter((a) => a === 'reset:three@example.com')).toHaveLength(3);
    expect(ctx.links.asked.filter((a) => a === 'reset:ghost@example.com')).toHaveLength(3); // unknown: same cap
    expect(await outboxFor(ctx, 'three@example.com')).toHaveLength(3);
  });

  it('limits one address of the network to 10 requests an hour, then 429 with Retry-After', async () => {
    const ctx = await setup();
    for (let i = 0; i < 10; i++)
      expect((await reset(ctx, { email: `ip-${String(i)}@example.com` })).status).toBe(200);
    const res = await reset(ctx, { email: 'ip-10@example.com' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorJson).error.code).toBe('RATE_LIMITED');
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('limits the address length before trimming the spaces around it', async () => {
    const ctx = await setup();
    expect((await reset(ctx, { email: `${' '.repeat(250)}a@example.com` })).status).toBe(400);
  });

  it('refuses a failed bot check before touching Firebase, and a malformed address or extra field', async () => {
    const ctx = await setup();
    const bot = await reset(ctx, { email: 'a@example.com', turnstileToken: 'turnstile-bad-0000000000' });
    expect(bot.status).toBe(400);
    expect(((await bot.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
    expect((await reset(ctx, { email: 'not-an-email' })).status).toBe(400);
    expect((await reset(ctx, { email: 'a@example.com', admin: true })).status).toBe(400);
    expect(ctx.links.asked).toEqual([]);
  });

  it('fails closed (503) when Firebase links or the bot check are not configured', async () => {
    const noLinks = await setup({ configured: false });
    expect((await reset(noLinks, { email: 'a@example.com' })).status).toBe(503);
    const noBotCheck = await buildApp({ emailActions: new FakeEmailActions(), keyring });
    expect((await reset(noBotCheck as unknown as Ctx, { email: 'a@example.com' })).status).toBe(503);
  });
});

describe('POST /v1/auth/verification-email', () => {
  const verify = (ctx: Ctx, token?: string, body: Record<string, unknown> = {}) =>
    ctx.app.request('/v1/auth/verification-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) },
      body: JSON.stringify(body),
    });

  it('needs a sign-in', async () => {
    const ctx = await setup();
    const res = await verify(ctx);
    expect(res.status).toBe(401);
    expect(ctx.links.asked).toEqual([]);
  });

  it('queues the mail to the Firebase account address (never one from the request), in the account language', async () => {
    const ctx = await setup();
    const user = await ensureUser(ctx.db, {
      firebaseUid: 'ver-1',
      phone: '+919855550001',
      email: null,
      emailVerified: false,
    });
    const token = ctx.verifier.add('token-verify-000000000001', {
      firebaseUid: 'ver-1',
      phone: '+919855550001',
    });
    ctx.links.verifications.set('ver-1', { email: 'ver1@example.com', code: 'verify-code-0123456789' });
    const res = await verify(ctx, token, { locale: 'hi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent' });
    const [row] = await outboxFor(ctx, 'ver1@example.com');
    expect(row).toMatchObject({
      templateKey: 'auth_verify_email',
      locale: 'hi',
      recipientUserId: user.id,
    });
    expect(row?.payload).toMatchObject({ mode: 'verifyEmail', lang: 'hi' });
    expect(ctx.links.asked).toEqual(['verify:ver-1']);
    // An address in the body is refused (strict), so it cannot redirect the mail.
    expect((await verify(ctx, token, { email: 'evil@example.com' })).status).toBe(400);
  });

  it('says not_needed when there is nothing to verify, and limits sends to 5 an hour per account', async () => {
    const ctx = await setup();
    await ensureUser(ctx.db, {
      firebaseUid: 'ver-2',
      phone: '+919855550002',
      email: null,
      emailVerified: false,
    });
    const token = ctx.verifier.add('token-verify-000000000002', {
      firebaseUid: 'ver-2',
      phone: '+919855550002',
    });
    const none = await verify(ctx, token);
    expect(await none.json()).toEqual({ status: 'not_needed' });
    ctx.links.verifications.set('ver-2', { email: 'ver2@example.com', code: 'verify-code-aaaaaaaaaa' });
    for (let i = 0; i < 4; i++) expect((await verify(ctx, token)).status).toBe(200);
    const sixth = await verify(ctx, token);
    expect(sixth.status).toBe(429);
    expect(await outboxFor(ctx, 'ver2@example.com')).toHaveLength(4);
  });

  it('answers 503 when Firebase cannot make the link, and when it is not configured', async () => {
    const ctx = await setup();
    await ensureUser(ctx.db, {
      firebaseUid: 'ver-3',
      phone: '+919855550003',
      email: null,
      emailVerified: false,
    });
    const token = ctx.verifier.add('token-verify-000000000003', {
      firebaseUid: 'ver-3',
      phone: '+919855550003',
    });
    ctx.links.fail = true;
    expect((await verify(ctx, token)).status).toBe(503);
    const off = await setup({ configured: false });
    await ensureUser(off.db, {
      firebaseUid: 'ver-4',
      phone: '+919855550004',
      email: null,
      emailVerified: false,
    });
    const t2 = off.verifier.add('token-verify-000000000004', {
      firebaseUid: 'ver-4',
      phone: '+919855550004',
    });
    expect((await verify(off, t2)).status).toBe(503);
  });
});
