/**
 * "Sign out of all devices" over HTTP (founder 2026-11-28; spec 01 sessions, spec 13): signed in only, ends every
 * Firebase session of the caller (never someone else's), drops the caller's cached session, writes the audit row and
 * the analytics event, limited per user, and answers 503 when the deployment has no password authority.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, events } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { SESSIONS_REVOKE_ALL_RATE } from '../src/routes/sessions';
import { bearer, buildApp, FakePasswordAuthority, type ErrorJson } from './helpers';

const passwordAuth = new FakePasswordAuthority();
let ctx: Awaited<ReturnType<typeof buildApp>>;
let bare: Awaited<ReturnType<typeof buildApp>>;

async function person(app: typeof ctx, n: string) {
  const identity = {
    firebaseUid: `sess-${n}`,
    phone: `+9198555555${n}`,
    email: `sess-${n}@example.com`,
    emailVerified: true,
  };
  const token = app.verifier.add(`token-sess-00000000${n}`, identity);
  const user = await ensureUser(app.db, identity);
  return { id: user.id, uid: identity.firebaseUid, headers: bearer(token) };
}

const post = (app: typeof ctx, headers: Record<string, string>) =>
  app.app.request('/v1/me/sessions/revoke-all', { method: 'POST', headers });

beforeAll(async () => {
  ctx = await buildApp({ passwordAuth });
  bare = await buildApp({ passwordAuth: null });
});

describe('POST /v1/me/sessions/revoke-all', () => {
  it('needs a signed-in user', async () => {
    expect((await post(ctx, {})).status).toBe(401);
  });

  it('revokes the caller only, audits it and counts it', async () => {
    const me = await person(ctx, '1');
    const other = await person(ctx, '2');
    const res = await post(ctx, me.headers);
    expect(res.status).toBe(200);
    expect(passwordAuth.revoked).toContain(me.uid);
    expect(passwordAuth.revoked).not.toContain(other.uid);
    const rows = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'auth.sessions_revoked'));
    const audit = rows.filter((r) => r.actorUserId === me.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entityId).toBe(me.id);
    const counted = await ctx.db.select().from(events).where(eq(events.event, 'account_signed_out_all'));
    expect(counted.filter((e) => e.userId === me.id)).toHaveLength(1);
  });

  it('is limited per user', async () => {
    const me = await person(ctx, '3');
    for (let i = 0; i < SESSIONS_REVOKE_ALL_RATE.limit; i += 1)
      expect((await post(ctx, me.headers)).status).toBe(200);
    const res = await post(ctx, me.headers);
    expect(res.status).toBe(429);
  });

  it('answers 503 UNAVAILABLE when the deployment cannot revoke, and writes nothing', async () => {
    const me = await person(bare, '4');
    const res = await post(bare, me.headers);
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorJson).error.code).toBe('UNAVAILABLE');
    const audit = await bare.db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'auth.sessions_revoked'));
    expect(audit.filter((r) => r.actorUserId === me.id)).toHaveLength(0);
  });
});
