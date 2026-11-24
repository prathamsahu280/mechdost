/**
 * "Your password was changed" notice (decision 2026-11-24, spec 01 "Account emails"). The browser changes the
 * password with Firebase, so the API never sees it: the page tells us afterwards, and we believe only Firebase's own
 * record (`tokensValidAfterTime`, moved by every password change). Firebase and Resend are fakes.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { events } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { buildApp, FakeEmailActions, type ErrorJson } from './helpers';

const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const MIN = 60_000;

async function setup(opts: { configured?: boolean } = {}) {
  const links = new FakeEmailActions();
  const ctx = await buildApp({ emailActions: opts.configured === false ? null : links, keyring });
  return { ...ctx, links };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const notify = (ctx: Ctx, body: Record<string, unknown>) =>
  ctx.app.request('/v1/auth/password-changed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'en', ...body }),
  });
const outboxFor = async (ctx: Ctx, email: string) =>
  (await ctx.db.select().from(s.notificationOutbox)).filter((r) => r.recipient === email);
const changedAgo = (ctx: Ctx, email: string, ms: number) => {
  ctx.links.changes.set(email, { uid: `uid-${email}`, changedAt: new Date(Date.now() - ms) });
};
const outcomes = async (ctx: Ctx) =>
  (await ctx.db.select().from(events).where(eq(events.event, 'auth_password_changed_notified')))
    .map((e) => JSON.stringify(e.props))
    .sort();

describe('POST /v1/auth/password-changed', () => {
  it('queues one notice for a password changed a minute ago, in the asked language, with no secret', async () => {
    const ctx = await setup();
    changedAgo(ctx, 'asha@example.com', MIN);
    const res = await notify(ctx, { email: ' Asha@Example.com ', locale: 'hi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'accepted' });
    const rows = await outboxFor(ctx, 'asha@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'email', templateKey: 'auth_password_changed', locale: 'hi' });
    expect(JSON.stringify(rows[0]?.payload)).toBe('{}');
    expect(rows[0]?.dedupeKey).toMatch(/^auth_password_changed:uid-asha@example\.com:\d+:email$/);
    expect(await outcomes(ctx)).toEqual(['{"outcome":"queued"}']);
  });

  it('sends one email per change however many times the page calls, and another for a later change', async () => {
    const ctx = await setup();
    changedAgo(ctx, 'once@example.com', MIN);
    const before = await outcomes(ctx); // the database is shared by the tests of this file
    for (let i = 0; i < 4; i++) await notify(ctx, { email: 'once@example.com' });
    expect(await outboxFor(ctx, 'once@example.com')).toHaveLength(1);
    const after = await outcomes(ctx);
    const count = (list: string[], o: string) => list.filter((x) => x === `{"outcome":"${o}"}`).length;
    expect(count(after, 'duplicate') - count(before, 'duplicate')).toBe(3);
    expect(count(after, 'queued') - count(before, 'queued')).toBe(1);
    changedAgo(ctx, 'once@example.com', 30_000); // changed again, later
    await notify(ctx, { email: 'once@example.com' });
    expect(await outboxFor(ctx, 'once@example.com')).toHaveLength(2);
  });

  it('sends nothing for a stale change, an unknown address or a Firebase failure, and answers all alike', async () => {
    const ctx = await setup();
    changedAgo(ctx, 'fresh@example.com', MIN);
    changedAgo(ctx, 'stale@example.com', 11 * MIN);
    changedAgo(ctx, 'future@example.com', -10 * MIN); // a clock that cannot be right
    ctx.links.fail = true;
    const broken = await notify(ctx, { email: 'broken@example.com' });
    ctx.links.fail = false;
    const answers = [
      await notify(ctx, { email: 'fresh@example.com' }),
      await notify(ctx, { email: 'stale@example.com' }),
      await notify(ctx, { email: 'future@example.com' }),
      await notify(ctx, { email: 'nobody@example.com' }),
      broken,
    ];
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const bodies = await Promise.all(answers.map(async (r) => JSON.stringify(await r.json())));
    expect(new Set(bodies).size).toBe(1);
    for (const e of ['stale', 'future', 'nobody', 'broken'])
      expect(await outboxFor(ctx, `${e}@example.com`)).toHaveLength(0);
    expect(await outboxFor(ctx, 'fresh@example.com')).toHaveLength(1);
  });

  it('asks Firebase about one address at most 5 times an hour, and takes 20 requests per network, then 429', async () => {
    const ctx = await setup();
    for (let i = 0; i < 8; i++) await notify(ctx, { email: 'busy@example.com' });
    expect(ctx.links.asked.filter((a) => a === 'changed:busy@example.com')).toHaveLength(5);
    for (let i = 0; i < 12; i++)
      expect((await notify(ctx, { email: `n${String(i)}@example.com` })).status).toBe(200);
    const res = await notify(ctx, { email: 'last@example.com' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorJson).error.code).toBe('RATE_LIMITED');
  });

  it('refuses a malformed address or an extra field, and answers 503 when Firebase links are not configured', async () => {
    const ctx = await setup();
    expect((await notify(ctx, { email: 'not-an-email' })).status).toBe(400);
    expect((await notify(ctx, { email: 'a@example.com', extra: 1 })).status).toBe(400);
    expect((await notify(ctx, { email: 'a@example.com', locale: 'fr' })).status).toBe(400);
    const off = await setup({ configured: false });
    expect((await notify(off, { email: 'a@example.com' })).status).toBe(503);
  });
});
