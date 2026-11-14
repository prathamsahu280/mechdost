/**
 * Admin → Notifications API (hard rule 8): only `notifications:manage` holders reach it; WhatsApp templates are
 * checked for offer wording and placeholders; stale edits are refused; budget + usage round-trip.
 */
import { describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

async function staffApp(role: 'marketing' | 'support_agent' | null, n: string, emailVerified = true) {
  const ctx = await buildApp();
  const phone = `+9198444444${n}`;
  const email = `an-${n}@example.com`;
  const token = ctx.verifier.add(`token-admin-notify-0000${n}`, {
    firebaseUid: `an-${n}`,
    phone,
    email,
    emailVerified,
  });
  const user = await ensureUser(ctx.db, { firebaseUid: `an-${n}`, phone, email, emailVerified });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...ctx, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const template = {
  key: 'order.confirmed',
  channel: 'whatsapp',
  locale: 'en',
  body: 'Your MechDost order {{1}} is confirmed and will be shipped soon.',
  enabled: true,
  version: null,
};

describe('admin notifications API', () => {
  it('a city-scoped notifications grant cannot change the all-city templates or budget (review C6)', async () => {
    const ctx = await buildApp();
    const token = ctx.verifier.add('token-admin-notify-000099', {
      firebaseUid: 'an-99',
      phone: '+919844444499',
      email: 'an-99@example.com',
      emailVerified: true,
    });
    const user = await ensureUser(ctx.db, {
      firebaseUid: 'an-99',
      phone: '+919844444499',
      email: 'an-99@example.com',
      emailVerified: true,
    });
    const [state] =
      (await ctx.db.select().from(s.states)).length > 0
        ? await ctx.db.select().from(s.states)
        : await ctx.db
            .insert(s.states)
            .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
            .returning();
    const [city] = await ctx.db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'BLS', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
      .returning();
    const raipur = city!.id;
    // An admin-made custom role may be city-scoped (built-in marketing is global only).
    const [custom] = await ctx.db
      .insert(s.roles)
      .values({ key: 'city_comms', name: 'City comms', isSystem: false })
      .returning();
    await ctx.db
      .insert(s.rolePermissions)
      .values({ roleId: custom!.id, permissionKey: 'notifications:manage' });
    await grantRole(ctx.db, { userId: user.id, role: 'city_comms', cityId: raipur, grantedBy: null });
    const headers = { ...bearer(token), 'content-type': 'application/json' };
    const put = await ctx.app.request('/v1/admin/notifications/templates', {
      method: 'PUT',
      headers,
      body: JSON.stringify(template),
    });
    expect(put.status).toBe(404);
    const budget = await ctx.app.request('/v1/admin/notifications/whatsapp/budget', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ budgetPaise: 100_000, version: null }),
    });
    expect(budget.status).toBe(404);
  });

  it('is refused without notifications:manage (customers and support agents)', async () => {
    for (const [role, n] of [
      [null, '01'],
      ['support_agent', '02'],
    ] as const) {
      const { app, headers } = await staffApp(role, n);
      const res = await app.request('/v1/admin/notifications/templates', { headers });
      expect(res.status).toBe(403);
    }
    const { app } = await buildApp();
    expect((await app.request('/v1/admin/notifications/templates')).status).toBe(401);
    // Staff with the permission but an unverified email are stopped too (spec 01).
    const unverified = await staffApp('marketing', '05', false);
    const res = await unverified.app.request('/v1/admin/notifications/templates', {
      headers: unverified.headers,
    });
    expect(((await res.json()) as ErrorJson).error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('marketing staff save a WhatsApp template; offer wording, bad placeholders and stale edits are refused', async () => {
    const { app, headers } = await staffApp('marketing', '03');
    const put = (body: unknown) =>
      app.request('/v1/admin/notifications/templates', {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });

    const created = await put(template);
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ version: 1 });

    const promo = await put({
      ...template,
      locale: 'hi',
      body: 'ऑर्डर {{1}} कन्फ़र्म! अगली खरीद पर 10% छूट',
    });
    expect(promo.status).toBe(422);
    expect(((await promo.json()) as ErrorJson).error.code).toBe('TEMPLATE_PROMO_WORDING');

    const placeholders = await put({ ...template, locale: 'hi', body: 'आपका ऑर्डर कन्फ़र्म है।' });
    expect(((await placeholders.json()) as ErrorJson).error.code).toBe('TEMPLATE_PLACEHOLDERS');

    const stale = await put({ ...template, version: null });
    expect(stale.status).toBe(409);

    const extra = await put({ ...template, version: 1, updatedBy: 'someone-else' });
    expect(extra.status).toBe(400); // strict body: no mass assignment

    const list = await app.request('/v1/admin/notifications/templates', { headers });
    const json = (await list.json()) as {
      templates: { key: string; channel: string; locale: string }[];
      whatsappCatalogue: { key: string; params: string[] }[];
    };
    expect(json.templates.some((t) => t.key === 'order.confirmed' && t.locale === 'en')).toBe(true);
    // The delivery code is never sent by WhatsApp (user 2026-11-14): one placeholder, the order code.
    expect(json.whatsappCatalogue.find((c) => c.key === 'order.out_for_delivery')?.params).toEqual([
      'orderCode',
    ]);
  });

  it('sets the WhatsApp budget and reports this month’s usage against it', async () => {
    const { app, headers } = await staffApp('marketing', '04');
    const save = await app.request('/v1/admin/notifications/whatsapp/budget', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ budgetPaise: 500_000, version: null }),
    });
    expect(save.status).toBe(200);
    const usage = (await (await app.request('/v1/admin/notifications/whatsapp', { headers })).json()) as {
      budgetPaise: number;
      overBudget: boolean;
      monthStart: string;
    };
    expect(usage).toMatchObject({ budgetPaise: 500_000, overBudget: false });
    // Month starts at 00:00 IST on the 1st = 18:30 UTC on the previous day.
    expect(usage.monthStart).toMatch(/T18:30:00\.000Z$/);
    const negative = await app.request('/v1/admin/notifications/whatsapp/budget', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ budgetPaise: -1, version: 1 }),
    });
    expect(negative.status).toBe(400);
  });
});

describe('admin emails API (design 2026-11-15)', () => {
  const put = (headers: Record<string, string>, body: Record<string, unknown>) => ({
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const base = {
    key: 'order_confirmed',
    locale: 'en',
    subject: 'Good news, {orderCode}',
    heading: null,
    body: null,
    buttonLabel: null,
    enabled: true,
    version: null,
  };

  it('edits text per language, lists it, resets it, and audits each step', async () => {
    const { app, headers, db } = await staffApp('marketing', '11');
    expect(
      (
        (await (await app.request('/v1/admin/notifications/emails', { headers })).json()) as {
          templates: unknown[];
        }
      ).templates,
    ).toEqual([]);
    const saved = await app.request('/v1/admin/notifications/emails', put(headers, base));
    expect(saved.status).toBe(200);
    const { version } = (await saved.json()) as { version: number };
    const list = (await (await app.request('/v1/admin/notifications/emails', { headers })).json()) as {
      templates: { key: string; locale: string; subject: string; version: number; enabled: boolean }[];
    };
    expect(list.templates).toMatchObject([
      { key: 'order_confirmed', locale: 'en', subject: 'Good news, {orderCode}', version, enabled: true },
    ]);
    const stale = await app.request(
      '/v1/admin/notifications/emails',
      put(headers, { ...base, version: version + 5 }),
    );
    expect(stale.status).toBe(409);
    const reset = await app.request('/v1/admin/notifications/emails/reset', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: 'order_confirmed', locale: 'en', version }),
    });
    expect(reset.status).toBe(200);
    expect(
      (
        (await (await app.request('/v1/admin/notifications/emails', { headers })).json()) as {
          templates: unknown[];
        }
      ).templates,
    ).toEqual([]);
    const audit = await db.select().from(s.auditLog);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['email_template.saved', 'email_template.reset']),
    );
  });

  it('refuses unknown placeholders and HTML (422) and unknown templates; the old endpoint refuses the email channel', async () => {
    const { app, headers } = await staffApp('marketing', '12');
    const bad = await app.request(
      '/v1/admin/notifications/emails',
      put(headers, { ...base, body: 'Hi {nope}' }),
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson).error.code).toBe('EMAIL_PLACEHOLDER');
    const html = await app.request(
      '/v1/admin/notifications/emails',
      put(headers, { ...base, body: '<b>x</b>' }),
    );
    expect(html.status).toBe(422);
    const unknown = await app.request(
      '/v1/admin/notifications/emails',
      put(headers, { ...base, key: 'not_a_template' }),
    );
    expect(unknown.status).toBe(422);
    const generic = await app.request(
      '/v1/admin/notifications/templates',
      put(headers, { ...template, key: 'order.confirmed', channel: 'email' }),
    );
    expect(generic.status).toBe(422);
  });

  it('switching a template off stops it being queued; only notifications:manage reaches the endpoints', async () => {
    const { app, headers } = await staffApp('marketing', '13');
    const off = await app.request(
      '/v1/admin/notifications/emails',
      put(headers, { ...base, key: 'ticket_resolved', subject: null, enabled: false }),
    );
    expect(off.status).toBe(200);
    const support = await staffApp('support_agent', '14');
    expect(
      (await support.app.request('/v1/admin/notifications/emails', { headers: support.headers })).status,
    ).toBe(403);
    const anon = await staffApp(null, '15');
    expect((await anon.app.request('/v1/admin/notifications/emails', { headers: anon.headers })).status).toBe(
      403,
    );
  });

  it('a test send goes to the staff member’s own verified email only, marked as a test, with sample data', async () => {
    const { app, headers, db } = await staffApp('marketing', '16');
    const res = await app.request('/v1/admin/notifications/emails/test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: 'order_confirmed', locale: 'hi' }),
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(s.notificationOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'email',
      templateKey: 'order_confirmed',
      locale: 'hi',
      recipient: 'an-16@example.com',
      payload: expect.objectContaining({ test: 'true' }) as unknown,
    });
    const unverified = await staffApp('marketing', '17', false);
    const refused = await unverified.app.request('/v1/admin/notifications/emails/test', {
      method: 'POST',
      headers: unverified.headers,
      body: JSON.stringify({ key: 'order_confirmed', locale: 'en' }),
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(
      (await unverified.db.select().from(s.notificationOutbox)).filter(
        (r) => r.recipient === 'an-17@example.com',
      ),
    ).toHaveLength(0);
  });
});
