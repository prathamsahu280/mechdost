/**
 * Support API (spec 09): own requests only (404 otherwise), staff inbox needs verified staff with ticket
 * permissions, replies/notes/status go through the API with strict bodies.
 */
import { describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

async function person(
  ctx: Awaited<ReturnType<typeof buildApp>>,
  n: string,
  role: 'support_agent' | 'marketing' | null,
  verified = true,
) {
  const phone = `+9198555555${n}`;
  const email = `sp-${n}@example.com`;
  const token = ctx.verifier.add(`token-support-00000${n}`, {
    firebaseUid: `sp-${n}`,
    phone,
    email,
    emailVerified: verified,
  });
  const user = await ensureUser(ctx.db, { firebaseUid: `sp-${n}`, phone, email, emailVerified: verified });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

describe('support API', () => {
  it('a customer raises, reads and answers their own request; others get 404', async () => {
    const ctx = await buildApp();
    const asha = await person(ctx, '01', null);
    const ravi = await person(ctx, '02', null);
    const created = await ctx.app.request('/v1/support/tickets', {
      method: 'POST',
      headers: asha,
      body: JSON.stringify({ kind: 'fitment', body: 'Will XLTZ4A fit my Activa 6G?' }),
    });
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    expect(code).toMatch(/^REQ-RPR-/);

    const mine = (await (await ctx.app.request(`/v1/support/tickets/${code}`, { headers: asha })).json()) as {
      status: string;
      messages: { body: string }[];
    };
    expect(mine).toMatchObject({ status: 'open', messages: [{ body: 'Will XLTZ4A fit my Activa 6G?' }] });
    expect((await ctx.app.request(`/v1/support/tickets/${code}`, { headers: ravi })).status).toBe(404);
    expect((await ctx.app.request('/v1/support/tickets')).status).toBe(401);

    const mass = await ctx.app.request('/v1/support/tickets', {
      method: 'POST',
      headers: asha,
      body: JSON.stringify({ kind: 'other', body: 'x', status: 'resolved' }),
    });
    expect(mass.status).toBe(400); // strict body: no mass assignment
  });

  it('the inbox is for verified staff with ticket permissions; replies and status go through it', async () => {
    const ctx = await buildApp();
    const customer = await person(ctx, '03', null);
    const agent = await person(ctx, '04', 'support_agent');
    const marketing = await person(ctx, '05', 'marketing');
    const unverified = await person(ctx, '06', 'support_agent', false);
    const { code } = (await (
      await ctx.app.request('/v1/support/tickets', {
        method: 'POST',
        headers: customer,
        body: JSON.stringify({ kind: 'order_issue', body: 'Wrong part delivered.' }),
      })
    ).json()) as { code: string };

    expect((await ctx.app.request('/v1/admin/support/tickets', { headers: customer })).status).toBe(403);
    expect((await ctx.app.request('/v1/admin/support/tickets', { headers: marketing })).status).toBe(403);
    const blocked = await ctx.app.request('/v1/admin/support/tickets', { headers: unverified });
    expect(((await blocked.json()) as ErrorJson).error.code).toBe('VERIFICATION_REQUIRED');

    const list = (await (await ctx.app.request('/v1/admin/support/tickets', { headers: agent })).json()) as {
      tickets: { code: string; acknowledged: boolean }[];
    };
    expect(list.tickets.find((x) => x.code === code)).toMatchObject({ acknowledged: false });

    const note = await ctx.app.request(`/v1/admin/support/tickets/${code}/messages`, {
      method: 'POST',
      headers: agent,
      body: JSON.stringify({ body: 'Ask the shop for the invoice.', internal: true }),
    });
    expect(await note.json()).toEqual({ status: 'open' });
    const answer = await ctx.app.request(`/v1/admin/support/tickets/${code}/messages`, {
      method: 'POST',
      headers: agent,
      body: JSON.stringify({ body: 'We will replace it. Please keep the box.', internal: false }),
    });
    expect(await answer.json()).toEqual({ status: 'awaiting_customer' });

    // The customer never sees the internal note.
    const seen = (await (
      await ctx.app.request(`/v1/support/tickets/${code}`, { headers: customer })
    ).json()) as {
      messages: { body: string }[];
    };
    expect(seen.messages.map((m) => m.body)).not.toContain('Ask the shop for the invoice.');

    const full = (await (
      await ctx.app.request(`/v1/admin/support/tickets/${code}`, { headers: agent })
    ).json()) as {
      version: number;
    };
    const resolve = await ctx.app.request(`/v1/admin/support/tickets/${code}/status`, {
      method: 'POST',
      headers: agent,
      body: JSON.stringify({ to: 'resolved', version: full.version }),
    });
    expect(resolve.status).toBe(200);
    const stale = await ctx.app.request(`/v1/admin/support/tickets/${code}/status`, {
      method: 'POST',
      headers: agent,
      body: JSON.stringify({ to: 'closed', version: full.version }),
    });
    expect(stale.status).toBe(409);
  });
});
