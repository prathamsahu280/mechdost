/**
 * Support inbox tools over HTTP (design 2026-11-15 item 4; spec 09): internal notes never reach the customer
 * (role-leak), assignment rules, canned replies (read for agents, edit for `content:write`).
 */
import { describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildApp>>;

async function person(ctx: Ctx, n: string, role: 'support_agent' | 'ops_manager' | 'super_admin' | null) {
  const phone = `+9198666666${n}`;
  const email = `si-${n}@example.com`;
  const token = ctx.verifier.add(`token-inbox-tools-0000${n}`, {
    firebaseUid: `si-${n}`,
    phone,
    email,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, { firebaseUid: `si-${n}`, phone, email, emailVerified: true });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

async function raise(ctx: Ctx, headers: Record<string, string>) {
  const res = await ctx.app.request('/v1/support/tickets', {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'other', body: 'Need help with my order.' }),
  });
  return ((await res.json()) as { code: string }).code;
}

describe('support inbox API', () => {
  it('role leak: an internal note is in the staff thread and nowhere in the customer’s', async () => {
    const ctx = await buildApp();
    const customer = await person(ctx, '01', null);
    const agent = await person(ctx, '02', 'support_agent');
    const code = await raise(ctx, customer.headers);
    const secret = 'INTERNAL-NOTE-chargeback-risk-4412';
    const note = await ctx.app.request(`/v1/admin/support/tickets/${code}/messages`, {
      method: 'POST',
      headers: agent.headers,
      body: JSON.stringify({ body: secret, internal: true }),
    });
    expect(note.status).toBe(200);
    const mine = await (
      await ctx.app.request(`/v1/support/tickets/${code}`, { headers: customer.headers })
    ).text();
    const list = await (await ctx.app.request('/v1/support/tickets', { headers: customer.headers })).text();
    expect(mine).not.toContain(secret);
    expect(list).not.toContain(secret);
    const staff = await (
      await ctx.app.request(`/v1/admin/support/tickets/${code}`, { headers: agent.headers })
    ).text();
    expect(staff).toContain(secret);
    // The staff-only block (assignee, SLA, masked guest phone) is not part of the customer's answer either.
    expect(mine).not.toContain('"staff"');
  });

  it('an agent may take a request for themselves but not give it to someone else; a manager can', async () => {
    const ctx = await buildApp();
    const customer = await person(ctx, '03', null);
    const agent = await person(ctx, '04', 'support_agent');
    const other = await person(ctx, '05', 'support_agent');
    const manager = await person(ctx, '06', 'ops_manager');
    const code = await raise(ctx, customer.headers);
    const read = async () =>
      (await (
        await ctx.app.request(`/v1/admin/support/tickets/${code}`, { headers: agent.headers })
      ).json()) as {
        version: number;
        staff: { assignee: { id: string } | null };
      };
    const assign = (who: typeof agent, assigneeId: string | null, version: number) =>
      ctx.app.request(`/v1/admin/support/tickets/${code}/assign`, {
        method: 'POST',
        headers: who.headers,
        body: JSON.stringify({ assigneeId, version }),
      });
    let t = await read();
    expect((await assign(agent, other.id, t.version)).status).toBe(403);
    expect((await assign(agent, agent.id, t.version)).status).toBe(200);
    t = await read();
    expect(t.staff.assignee?.id).toBe(agent.id);
    expect((await assign(manager, other.id, t.version)).status).toBe(200);
    t = await read();
    expect(t.staff.assignee?.id).toBe(other.id);
    const stale = await assign(manager, agent.id, t.version - 1);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_TICKET');
    const bad = await assign(manager, customer.id, t.version);
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson).error.code).toBe('ASSIGNEE_INVALID');
    expect((await assign(customer, agent.id, t.version)).status).toBe(403);
    const agents = (await (
      await ctx.app.request('/v1/admin/support/agents', { headers: manager.headers })
    ).json()) as { agents: { id: string }[] };
    expect(agents.agents.map((a) => a.id)).toEqual(expect.arrayContaining([agent.id, other.id, manager.id]));
    const filtered = (await (
      await ctx.app.request('/v1/admin/support/tickets?assignee=me', { headers: other.headers })
    ).json()) as { tickets: { code: string; assignee: { id: string } | null }[] };
    expect(filtered.tickets.map((x) => x.code)).toContain(code);
  });

  it('canned replies: agents read the active ones, only content editors write; both languages are required', async () => {
    const ctx = await buildApp();
    const customer = await person(ctx, '07', null);
    const agent = await person(ctx, '08', 'support_agent');
    const admin = await person(ctx, '09', 'super_admin');
    const body = {
      key: 'api_test_reply',
      titleEn: 'Test',
      titleHi: 'परीक्षण',
      bodyEn: 'English',
      bodyHi: 'हिंदी',
      active: true,
      sortOrder: 7,
    };
    const post = (who: typeof agent, b: unknown) =>
      ctx.app.request('/v1/admin/support/canned-replies', {
        method: 'POST',
        headers: who.headers,
        body: JSON.stringify(b),
      });
    expect(
      (await ctx.app.request('/v1/admin/support/canned-replies', { headers: customer.headers })).status,
    ).toBe(403);
    expect((await post(agent, body)).status).toBe(403);
    expect((await post(admin, { ...body, bodyHi: undefined })).status).toBe(400);
    expect((await post(admin, { ...body, extra: 1 })).status).toBe(400);
    const created = await post(admin, body);
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; version: number };
    const put = (b: unknown) =>
      ctx.app.request(`/v1/admin/support/canned-replies/${row.id}`, {
        method: 'PUT',
        headers: admin.headers,
        body: JSON.stringify(b),
      });
    expect((await put({ ...body, active: false, version: row.version })).status).toBe(200);
    const stale = await put({ ...body, version: row.version });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_CANNED_REPLY');
    const forAgent = (await (
      await ctx.app.request('/v1/admin/support/canned-replies', { headers: agent.headers })
    ).json()) as { replies: { key: string }[]; canEdit: boolean };
    expect(forAgent.canEdit).toBe(false);
    expect(forAgent.replies.map((r) => r.key)).not.toContain('api_test_reply');
    const forAdmin = (await (
      await ctx.app.request('/v1/admin/support/canned-replies', { headers: admin.headers })
    ).json()) as { replies: { key: string }[]; canEdit: boolean };
    expect(forAdmin.canEdit).toBe(true);
    expect(forAdmin.replies.map((r) => r.key)).toContain('api_test_reply');
  });
});
