/**
 * Guest tickets over HTTP (design 2026-11-15 item 6; spec 13): Turnstile on the form, rate limits on every public
 * route (per IP, per phone, per reference), strict bodies, wrong key = unknown reference = 404, the key shown once,
 * internal notes hidden, nothing queued to the typed contact details.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as schema from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

const HUMAN = 'turnstile-ok';
let ctx: Awaited<ReturnType<typeof buildApp>>;
let n = 0;
const phone = () => `+91970000${String(++n).padStart(4, '0')}`;
/** In-process requests share one client address ('unknown'), so each test builds a fresh app (fresh rate limiter). */
const post = (path: string, body: unknown, _ip?: string) =>
  ctx.app.request(`/v1/support-guest${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const form = (over: Record<string, unknown> = {}) => ({
  name: 'Mohan Lal',
  phone: phone(),
  kind: 'other',
  body: 'Where is my parcel?',
  turnstileToken: HUMAN,
  ...over,
});
async function open(ip?: string) {
  const res = await post('/tickets', form(), ip);
  expect(res.status).toBe(201);
  return (await res.json()) as { code: string; accessKey: string };
}

beforeEach(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile([HUMAN]) });
});

describe('guest support API', () => {
  it('needs Turnstile, validates strictly and shows the key once', async () => {
    const bot = await post('/tickets', form({ turnstileToken: 'robot' }), '10.2.0.1');
    expect(bot.status).toBe(400);
    expect(((await bot.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
    expect((await post('/tickets', { ...form(), role: 'staff' }, '10.2.0.2')).status).toBe(400);
    expect((await post('/tickets', form({ kind: 'labour_redo' }), '10.2.0.3')).status).toBe(400);
    expect((await post('/tickets', form({ phone: '1234567890' }), '10.2.0.4')).status).toBe(422);
    const made = await open('10.2.0.5');
    expect(made.code).toMatch(/^REQ-/);
    expect(made.accessKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    // The key is not in what a lookup returns.
    const view = await (await post('/lookup', { code: made.code, key: made.accessKey })).text();
    expect(view).not.toContain(made.accessKey);
  });

  it('views and replies with reference + key; wrong key and unknown reference are the same 404', async () => {
    const made = await open('10.3.0.1');
    const ok = await post('/lookup', { code: made.code, key: made.accessKey });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { messages: { body: string }[] }).messages[0]?.body).toBe(
      'Where is my parcel?',
    );
    expect((await post('/reply', { code: made.code, key: made.accessKey, body: 'Any news?' })).status).toBe(
      200,
    );
    const wrong = await post('/lookup', { code: made.code, key: 'AAAA-AAAA-AAAA-AAAA' });
    const unknown = await post('/lookup', { code: 'REQ-RPR-2026-ZZZZZZ', key: made.accessKey });
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    const a = ((await wrong.json()) as ErrorJson).error;
    const b = ((await unknown.json()) as ErrorJson).error;
    expect([a.code, a.message]).toEqual([b.code, b.message]);
    expect((await post('/reply', { code: made.code, key: 'AAAA-AAAA-AAAA-AAAA', body: 'x' })).status).toBe(
      404,
    );
    expect((await post('/lookup', { code: 'not-a-code', key: made.accessKey })).status).toBe(400);
  });

  it('role leak: internal notes never reach the guest', async () => {
    const made = await open('10.4.0.1');
    const token = ctx.verifier.add('token-guest-agent-0000001', {
      firebaseUid: 'guest-agent',
      phone: '+919866666601',
      email: 'ga@example.com',
      emailVerified: true,
    });
    const agent = await ensureUser(ctx.db, {
      firebaseUid: 'guest-agent',
      phone: '+919866666601',
      email: 'ga@example.com',
      emailVerified: true,
    });
    await grantRole(ctx.db, { userId: agent.id, role: 'support_agent', grantedBy: null });
    const secret = 'INTERNAL-guest-note-9931';
    const note = await ctx.app.request(`/v1/admin/support/tickets/${made.code}/messages`, {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ body: secret, internal: true }),
    });
    expect(note.status).toBe(200);
    const view = await (await post('/lookup', { code: made.code, key: made.accessKey })).text();
    expect(view).not.toContain(secret);
    expect(view).not.toContain('"staff"');
    // Nothing is queued to the typed number or any email: only the staff bell exists.
    expect(await ctx.db.select().from(schema.notificationOutbox)).toHaveLength(0);
  });

  it('is rate limited per IP for new tickets', async () => {
    for (let i = 0; i < 5; i += 1) expect((await post('/tickets', form())).status).toBe(201);
    const sixth = await post('/tickets', form());
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('retry-after')).not.toBeNull();
  });

  it('is rate limited per phone number, whatever the address', async () => {
    const same = phone();
    for (let i = 0; i < 3; i += 1) expect((await post('/tickets', form({ phone: same }))).status).toBe(201);
    expect((await post('/tickets', form({ phone: same }))).status).toBe(429);
    expect((await post('/tickets', form())).status).toBe(201);
  });

  it('limits key guessing per reference: the budget is spent even for the right key', async () => {
    const made = await open();
    let last = 0;
    for (let i = 0; i < 11; i += 1)
      last = (await post('/lookup', { code: made.code, key: 'AAAA-AAAA-AAAA-AAAA' })).status;
    expect(last).toBe(429);
    expect((await post('/lookup', { code: made.code, key: made.accessKey })).status).toBe(429);
  });
});
