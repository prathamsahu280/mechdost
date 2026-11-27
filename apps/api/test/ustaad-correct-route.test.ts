/**
 * `POST /v1/ustaad/correct` (spec 23 § 8, § 11; SR-27, SR-28): network gate (off / staff preview → generic 404, even
 * anonymous), members only, suggest / auto / off modes, protected words, per-member limit, LLM only with consent and
 * budget, word list without a key.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, getGlobalSetting, grantRole, putGlobalSetting } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import type { CorrectResponseView } from '@mechdost/shared/ustaad/correction';
import { MemoryRateLimiter } from '../src/rate-limit/limiter';
import { createAnthropicCorrection } from '../src/ustaad/correction/anthropic';
import type { FetchLike } from '../src/ustaad/correction/engine';
import { bearer, buildApp, testDb, type ErrorJson } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildApp>>;
let cityId = '';
let n = 0;

let adminId = '';

async function setSetting(key: string, value: unknown) {
  const db = await testDb();
  const before = await getGlobalSetting(db, key);
  await putGlobalSetting(db, { key, value, expectedVersion: before?.version ?? null, staffUserId: adminId });
}

async function person(
  ctx: Ctx,
  opts: { member?: boolean; consent?: boolean; staff?: boolean; mode?: string } = {},
) {
  n += 1;
  const id = String(n).padStart(2, '0');
  const phone = `+9197333333${id}`;
  const token = ctx.verifier.add(`token-correct-00000${id}`, { firebaseUid: `sc-${id}`, phone });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `sc-${id}`,
    phone,
    email: null,
    emailVerified: false,
  });
  if (opts.staff) await grantRole(ctx.db, { userId: user.id, role: 'super_admin', grantedBy: null });
  if (opts.member !== false) {
    await grantRole(ctx.db, { userId: user.id, role: 'mechanic', grantedBy: null });
    await ctx.db.insert(s.ustaadMembers).values({
      userId: user.id,
      handle: `mistri_sc_${id}`,
      displayName: `Mistri ${id}`,
      track: 'ustaad',
      level: 'ustaad_pending',
      cityId,
      areaLabel: 'Pandri',
      pincode: '492001',
      workPlace: 'shop',
      correctionMode: opts.mode ?? null,
    });
  }
  if (opts.consent)
    await ctx.db.insert(s.consents).values({
      userId: user.id,
      purpose: 'ustaad_correction',
      granted: true,
      noticeVersion: 'test',
      source: 'test',
    });
  return { headers: { ...bearer(token), 'Content-Type': 'application/json' } };
}

const post = (headers: Record<string, string>, body: unknown) => ({
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});
const errCode = async (res: Response) => ((await res.json()) as ErrorJson).error.code;

beforeAll(async () => {
  const db = await testDb();
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .onConflictDoNothing()
    .returning();
  const stateId = state?.id ?? (await db.select().from(s.states)).find((x) => x.code === 'CG')?.id ?? '';
  const [city] = await db
    .insert(s.cities)
    .values({ stateId, code: 'RPR', slug: 'raipur', name: 'Raipur', nameHi: 'रायपुर', status: 'live' })
    .onConflictDoNothing()
    .returning();
  cityId = city?.id ?? (await db.select().from(s.cities)).find((x) => x.code === 'RPR')?.id ?? '';
  const admin = await ensureUser(db, {
    firebaseUid: 'sc-admin',
    phone: '+919733300000',
    email: null,
    emailVerified: false,
  });
  adminId = admin.id;
  await db
    .insert(s.ustaadWordLists)
    .values([
      { list: 'protected', phrase: 'DOT 3', phraseNorm: 'dot 3' },
      { list: 'protected', phrase: 'jugaad', phraseNorm: 'jugaad' },
    ])
    .onConflictDoNothing();
  await setSetting('ustaad.access', 'open');
});

describe('POST /v1/ustaad/correct — gate and membership', () => {
  it('answers the generic 404 when the network is off, for anonymous callers and members alike', async () => {
    await setSetting('ustaad.access', 'off');
    const ctx = await buildApp();
    const m = await person(ctx);
    const anon = await ctx.app.request(
      '/v1/ustaad/correct',
      post({ 'Content-Type': 'application/json' }, { text: 'kr' }),
    );
    expect(anon.status).toBe(404);
    expect(await errCode(anon)).toBe('NOT_FOUND');
    expect((await ctx.app.request('/v1/ustaad/correct', post(m.headers, { text: 'kr' }))).status).toBe(404);
    await setSetting('ustaad.access', 'open');
  });

  it('staff preview: anonymous → 404 (not 401), a non-staff member → 404, staff member → 200', async () => {
    await setSetting('ustaad.access', 'staff_preview');
    const ctx = await buildApp();
    const member = await person(ctx);
    const staff = await person(ctx, { staff: true });
    const anon = await ctx.app.request(
      '/v1/ustaad/correct',
      post({ 'Content-Type': 'application/json' }, { text: 'kr' }),
    );
    expect(anon.status).toBe(404);
    expect((await ctx.app.request('/v1/ustaad/correct', post(member.headers, { text: 'kr' }))).status).toBe(
      404,
    );
    expect((await ctx.app.request('/v1/ustaad/correct', post(staff.headers, { text: 'kr' }))).status).toBe(
      200,
    );
    await setSetting('ustaad.access', 'open');
  });

  it('open: anonymous → 401; a signed-in non-member → 404', async () => {
    const ctx = await buildApp();
    const outsider = await person(ctx, { member: false });
    const anon = await ctx.app.request(
      '/v1/ustaad/correct',
      post({ 'Content-Type': 'application/json' }, { text: 'kr' }),
    );
    expect(anon.status).toBe(401);
    expect((await ctx.app.request('/v1/ustaad/correct', post(outsider.headers, { text: 'kr' }))).status).toBe(
      404,
    );
  });

  it('a member who joined after the session was cached can use correction at once (member row is the authority)', async () => {
    const ctx = await buildApp();
    const p = await person(ctx, { member: false });
    expect((await ctx.app.request('/v1/ustaad/correct', post(p.headers, { text: 'kr h' }))).status).toBe(404);
    // Join: the member row and the mechanic grant, written while the session (without the grant) is cached.
    const userId =
      (await ctx.db.select().from(s.users)).find((u) => u.firebaseUid === `sc-${String(n).padStart(2, '0')}`)
        ?.id ?? '';
    await grantRole(ctx.db, { userId, role: 'mechanic', grantedBy: null });
    await ctx.db.insert(s.ustaadMembers).values({
      userId,
      handle: `mistri_join_${String(n)}`,
      displayName: 'Naya Mistri',
      track: 'ustaad',
      level: 'ustaad_pending',
      cityId,
      areaLabel: 'Pandri',
      pincode: '492001',
      workPlace: 'shop',
    });
    expect((await ctx.app.request('/v1/ustaad/correct', post(p.headers, { text: 'kr h' }))).status).toBe(200);
  });

  it('validates the body strictly (no member id, ≤ 2,000 characters)', async () => {
    const ctx = await buildApp();
    const m = await person(ctx);
    const extra = await ctx.app.request('/v1/ustaad/correct', post(m.headers, { text: 'kr', memberId: 'x' }));
    expect(extra.status).toBe(400);
    const long = await ctx.app.request('/v1/ustaad/correct', post(m.headers, { text: 'a'.repeat(2001) }));
    expect(long.status).toBe(400);
  });
});

describe('POST /v1/ustaad/correct — modes and engines', () => {
  it('suggest mode (default): word list without a key, segments highlight the changes', async () => {
    const ctx = await buildApp();
    const m = await person(ctx);
    const res = await ctx.app.request(
      '/v1/ustaad/correct',
      post(m.headers, { text: 'brek kaam nhi kr rha' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CorrectResponseView;
    expect(body).toMatchObject({
      mode: 'suggest',
      engine: 'wordlist',
      text: 'Brake kaam nahi kar raha.',
      original: 'brek kaam nhi kr rha',
      changed: true,
    });
    expect(body.segments.map((x) => x.text).join('')).toBe(body.text);
    expect(body.changes).toBeGreaterThan(0);
  });

  it('AT-SC-1: in auto mode "DOT 3" and "175/65 R14" come back untouched, the original is kept', async () => {
    await setSetting('ustaad.correction.default_mode', 'auto');
    const ctx = await buildApp();
    const m = await person(ctx);
    const text = 'brek oil DOT 3 dalo aur tyre 175/65 R14';
    const body = (await (
      await ctx.app.request('/v1/ustaad/correct', post(m.headers, { text }))
    ).json()) as CorrectResponseView;
    expect(body.mode).toBe('auto');
    expect(body.text).toContain('DOT 3');
    expect(body.text).toContain('175/65 R14');
    expect(body.original).toBe(text);
    await setSetting('ustaad.correction.default_mode', 'suggest');
  });

  it('SIM-P20: in suggest mode a request asking for auto still only suggests (the author must choose)', async () => {
    const ctx = await buildApp();
    const m = await person(ctx);
    const body = (await (
      await ctx.app.request(
        '/v1/ustaad/correct',
        post(m.headers, { text: 'brek kaam nhi kr rha', mode: 'auto' }),
      )
    ).json()) as CorrectResponseView;
    expect(body.mode).toBe('suggest');
    // The member's own "Fix by itself" choice (where the admin lets members choose) is honoured.
    const own = await person(ctx, { mode: 'auto' });
    const auto = (await (
      await ctx.app.request(
        '/v1/ustaad/correct',
        post(own.headers, { text: 'brek kaam nhi kr rha', mode: 'auto' }),
      )
    ).json()) as CorrectResponseView;
    expect(auto.mode).toBe('auto');
    // A request may always step down from auto to suggest.
    await setSetting('ustaad.correction.default_mode', 'auto');
    const ctx2 = await buildApp();
    const m2 = await person(ctx2);
    const down = (await (
      await ctx2.app.request('/v1/ustaad/correct', post(m2.headers, { text: 'kr h', mode: 'suggest' }))
    ).json()) as CorrectResponseView;
    expect(down.mode).toBe('suggest');
    await setSetting('ustaad.correction.default_mode', 'suggest');
  });

  it("off: the member's own choice returns the text unchanged; a switched-off language too", async () => {
    const ctx = await buildApp();
    const off = await person(ctx, { mode: 'off' });
    const body = (await (
      await ctx.app.request('/v1/ustaad/correct', post(off.headers, { text: 'kr h', mode: 'suggest' }))
    ).json()) as CorrectResponseView;
    expect(body).toMatchObject({ mode: 'off', engine: null, text: 'kr h', changed: false });
    await setSetting('ustaad.correction.langs.cg', false);
    const ctx2 = await buildApp();
    const m = await person(ctx2);
    const cg = (await (
      await ctx2.app.request('/v1/ustaad/correct', post(m.headers, { text: 'kr h', lang: 'cg' }))
    ).json()) as CorrectResponseView;
    expect(cg).toMatchObject({ engine: null, changed: false });
    await setSetting('ustaad.correction.langs.cg', true);
  });

  it('per-member limit: 429 RATE_LIMITED after correction.per_member_per_10min', async () => {
    await setSetting('ustaad.correction.per_member_per_10min', 2);
    const ctx = await buildApp({ rateLimiter: new MemoryRateLimiter() });
    const m = await person(ctx);
    for (let i = 0; i < 2; i++)
      expect((await ctx.app.request('/v1/ustaad/correct', post(m.headers, { text: 'kr h' }))).status).toBe(
        200,
      );
    const third = await ctx.app.request('/v1/ustaad/correct', post(m.headers, { text: 'kr h' }));
    expect(third.status).toBe(429);
    expect(await errCode(third)).toBe('RATE_LIMITED');
    await setSetting('ustaad.correction.per_member_per_10min', 30);
  });

  it('LLM only with the consent; the daily budget falls back to the word list; no phone or member id sent', async () => {
    const bodies: string[] = [];
    const fetchDouble: FetchLike = (_url, init) => {
      const b = typeof init.body === 'string' ? init.body : '';
      bodies.push(b);
      const sent = (
        JSON.parse((JSON.parse(b) as { messages: { content: string }[] }).messages[0]?.content ?? '{}') as {
          text: string;
        }
      ).text;
      return Promise.resolve(
        Response.json({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ text: sent.replace('brek', 'Brake') }) }],
        }),
      );
    };
    const llm = createAnthropicCorrection({
      apiKey: 'sk-test-0123456789abcdef',
      model: 'claude-haiku-5-5',
      fetch: fetchDouble,
    });
    await setSetting('ustaad.correction.llm_daily_calls', 1);
    const ctx = await buildApp({ smartCorrection: llm });
    const noConsent = await person(ctx);
    const r0 = (await (
      await ctx.app.request('/v1/ustaad/correct', post(noConsent.headers, { text: 'brek 9876543210 pe' }))
    ).json()) as CorrectResponseView;
    expect(r0.engine).toBe('wordlist');
    expect(bodies).toHaveLength(0);

    const consented = await person(ctx, { consent: true });
    const r1 = (await (
      await ctx.app.request('/v1/ustaad/correct', post(consented.headers, { text: 'brek 9876543210 pe' }))
    ).json()) as CorrectResponseView;
    expect(r1).toMatchObject({ engine: 'llm_anthropic', text: 'Brake 9876543210 pe' });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain('9876543210');
    // (the only "user" is the message role)
    expect(bodies[0]).not.toMatch(/member|mistri_sc|user_id|userId|metadata|sc-\d/i);

    // Budget of 1 used: a different text goes to the word list, no second call.
    const r2 = (await (
      await ctx.app.request('/v1/ustaad/correct', post(consented.headers, { text: 'brek nhi lagta' }))
    ).json()) as CorrectResponseView;
    expect(r2.engine).toBe('wordlist');
    expect(bodies).toHaveLength(1);
    await setSetting('ustaad.correction.llm_daily_calls', 5000);
  });
});
