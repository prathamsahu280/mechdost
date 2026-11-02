/**
 * Admin → Notifications API (hard rule 8): only `notifications:manage` holders reach it; WhatsApp templates are
 * checked for offer wording and placeholders; stale edits are refused; budget + usage round-trip.
 */
import { describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
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
    expect(json.whatsappCatalogue.find((c) => c.key === 'order.out_for_delivery')?.params).toEqual([
      'orderCode',
      'deliveryCode',
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
