/**
 * Admin control over notifications (hard rule 8, user 2026-11-02): template text with WhatsApp guards, channel
 * switches, budget setting, usage/cost report. Compare-and-set + audit on every change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  WHATSAPP_BUDGET_KEY,
  applyDeliveryReceipt,
  claimOutboxBatch,
  enqueueNotification,
  getGlobalSetting,
  listEmailTemplates,
  listNotificationTemplates,
  resetEmailTemplate,
  saveEmailTemplate,
  getWhatsAppTemplateStatuses,
  saveWhatsAppTemplateStatuses,
  markOutboxSent,
  notificationChannelEnabled,
  putGlobalSetting,
  saveNotificationTemplate,
  whatsAppUsage,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-admin-notify' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

const base = {
  key: 'order.out_for_delivery',
  channel: 'whatsapp' as const,
  locale: 'hi' as const,
  // One placeholder: the delivery code is never sent by WhatsApp (user 2026-11-14).
  body: 'आपका ऑर्डर {{1}} डिलीवरी के लिए निकल चुका है। डिलीवरी कोड ऑर्डर पेज पर है।',
  enabled: true,
};

describe('notification templates (admin)', () => {
  it('WhatsApp stays off for an event until staff enable a template for it', async () => {
    expect(await notificationChannelEnabled(t(), base.key, 'whatsapp')).toBe(false);
    const { version } = await saveNotificationTemplate(t(), {
      ...base,
      expectedVersion: null,
      staffUserId: staff,
    });
    expect(version).toBe(1);
    expect(await notificationChannelEnabled(t(), base.key, 'whatsapp')).toBe(true);
    await saveNotificationTemplate(t(), { ...base, enabled: false, expectedVersion: 1, staffUserId: staff });
    expect(await notificationChannelEnabled(t(), base.key, 'whatsapp')).toBe(false);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'notification_template.saved'))).toBe(2);
  });

  it('refuses offer wording, wrong placeholders and unknown events for WhatsApp', async () => {
    const save = (over: Partial<typeof base>) =>
      saveNotificationTemplate(t(), {
        ...base,
        locale: 'en',
        ...over,
        expectedVersion: null,
        staffUserId: staff,
      });
    await expect(save({ body: 'Order {{1}} is on the way. Get 10% off next time!' })).rejects.toMatchObject({
      code: 'TEMPLATE_PROMO_WORDING',
    });
    await expect(save({ body: 'Order {{1}} is on the way, code {{2}}.' })).rejects.toMatchObject({
      code: 'TEMPLATE_PLACEHOLDERS',
    });
    await expect(save({ key: 'promo.oil_week', body: 'x {{1}}' })).rejects.toMatchObject({
      code: 'TEMPLATE_UNKNOWN_EVENT',
    });
    expect(
      (await listNotificationTemplates(t())).filter((r) => r.locale === 'en' && r.key === base.key),
    ).toHaveLength(0);
  });

  it('a stale editor cannot overwrite a newer save', async () => {
    const [current] = (await listNotificationTemplates(t())).filter(
      (r) => r.key === base.key && r.locale === 'hi',
    );
    await saveNotificationTemplate(t(), { ...base, expectedVersion: current!.version, staffUserId: staff });
    await expect(
      saveNotificationTemplate(t(), { ...base, expectedVersion: current!.version, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'STALE_TEMPLATE' });
    await expect(
      saveNotificationTemplate(t(), { ...base, expectedVersion: null, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'STALE_TEMPLATE' });
  });
});

describe('budget setting and usage report', () => {
  it('saves the WhatsApp budget with compare-and-set', async () => {
    expect(await getGlobalSetting(t(), WHATSAPP_BUDGET_KEY)).toBeNull();
    await putGlobalSetting(t(), {
      key: WHATSAPP_BUDGET_KEY,
      value: 500_000,
      expectedVersion: null,
      staffUserId: staff,
    });
    expect(await getGlobalSetting(t(), WHATSAPP_BUDGET_KEY)).toEqual({ value: 500_000, version: 1 });
    await expect(
      putGlobalSetting(t(), {
        key: WHATSAPP_BUDGET_KEY,
        value: 1,
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SETTING' });
  });

  it('counts delivered billable messages per Meta category and estimates cost in paise', async () => {
    const since = new Date(Date.now() - 3600_000);
    for (const [i, category] of ['utility', 'utility', 'marketing'].entries()) {
      await enqueueNotification(t(), {
        dedupeKey: `usage-${String(i)}`,
        channel: 'whatsapp',
        recipient: '+919876543210',
        templateKey: 'order.confirmed',
        payload: { orderCode: 'MD-RPR-2026-7K3QWX' },
      });
      const [row] = await claimOutboxBatch(t(), { channels: ['whatsapp'] });
      await markOutboxSent(t(), row!, `wamid.usage${String(i)}`);
      await applyDeliveryReceipt(t(), {
        channel: 'whatsapp',
        providerId: `wamid.usage${String(i)}`,
        status: 'delivered',
        at: new Date(),
        pricingCategory: category,
        billable: true,
      });
    }
    const usage = await whatsAppUsage(t(), { since });
    expect(usage).toMatchObject({ sent: 3, delivered: 3, failed: 0 });
    // 2 × 11.5 paise + 1 × 86.31 paise = 109.31 → 109 paise.
    expect(usage.costPaise).toBe(109);
    expect(usage.byCategory.find((c) => c.category === 'utility')).toEqual({
      category: 'utility',
      billable: 2,
      costPaise: 23,
    });
  });
});

describe('email templates (admin, design 2026-11-15)', () => {
  const email = { key: 'order_confirmed', locale: 'en' as const, enabled: true };

  it('saves text overrides, keeps blank fields on the code default, and audits the change', async () => {
    const { version } = await saveEmailTemplate(t(), {
      ...email,
      subject: 'Great news about {orderCode}',
      heading: '',
      body: 'A seller in {shopArea} confirmed {orderCode}.',
      buttonLabel: 'Track it',
      expectedVersion: null,
      staffUserId: staff,
    });
    const [row] = (await listEmailTemplates(t())).filter((r) => r.key === 'order_confirmed');
    expect(row).toMatchObject({
      locale: 'en',
      subject: 'Great news about {orderCode}',
      heading: null,
      buttonLabel: 'Track it',
      enabled: true,
      version,
    });
    const [log] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'email_template.saved'));
    expect(log).toMatchObject({ actorUserId: staff, entityId: 'order_confirmed:en' });
  });

  it('refuses unknown placeholders, HTML, and the generic endpoint for the email channel', async () => {
    const save = (body: string) =>
      saveEmailTemplate(t(), {
        ...email,
        key: 'order_placed',
        body,
        expectedVersion: null,
        staffUserId: staff,
      });
    await expect(save('Hi {nope}')).rejects.toMatchObject({ code: 'EMAIL_PLACEHOLDER' });
    await expect(save('<b>Hi</b>')).rejects.toMatchObject({ code: 'EMAIL_HTML' });
    await expect(
      saveNotificationTemplate(t(), {
        key: 'order_placed',
        channel: 'email',
        locale: 'en',
        body: 'Hi',
        enabled: true,
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_EMAIL_ENDPOINT' });
  });

  it('a stale version is a conflict', async () => {
    await expect(
      saveEmailTemplate(t(), { ...email, expectedVersion: 99, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'STALE_TEMPLATE' });
  });

  it('reset returns to the default text; an on template loses its row, an off one stays off', async () => {
    const [row] = (await listEmailTemplates(t())).filter((r) => r.key === 'order_confirmed');
    const out = await resetEmailTemplate(t(), {
      key: 'order_confirmed',
      locale: 'en',
      expectedVersion: row!.version,
      staffUserId: staff,
    });
    expect(out.version).toBeNull();
    expect((await listEmailTemplates(t())).filter((r) => r.key === 'order_confirmed')).toEqual([]);
    const off = await saveEmailTemplate(t(), {
      key: 'order_delivered',
      locale: 'hi',
      enabled: false,
      body: 'ऑर्डर {orderCode} मिल गया।',
      expectedVersion: null,
      staffUserId: staff,
    });
    const reset = await resetEmailTemplate(t(), {
      key: 'order_delivered',
      locale: 'hi',
      expectedVersion: off.version,
      staffUserId: staff,
    });
    expect(reset.version).toBeGreaterThan(off.version);
    const [after] = (await listEmailTemplates(t())).filter((r) => r.key === 'order_delivered');
    expect(after).toMatchObject({ enabled: false, body: '', subject: null });
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'email_template.reset'))).toBe(2);
  });
});

describe('WhatsApp template approval status (Meta sync, `pnpm wa:templates --status --save`)', () => {
  it('changes nothing before the first sync; afterwards only approved templates can be switched on', async () => {
    const key = 'ticket.replied';
    const body = 'MechDost सपोर्ट ने आपकी रिक्वेस्ट {{1}} का जवाब दिया है। जवाब पढ़ने के लिए खोलें।';
    await saveNotificationTemplate(t(), {
      key,
      channel: 'whatsapp',
      locale: 'hi',
      body,
      enabled: true,
      expectedVersion: null,
      staffUserId: staff,
    });
    expect(await getWhatsAppTemplateStatuses(t())).toBeNull();
    expect(await notificationChannelEnabled(t(), key, 'whatsapp')).toBe(true);

    await saveWhatsAppTemplateStatuses(t(), { 'ticket.replied': { hi: 'pending', en: 'approved' } });
    expect(await getWhatsAppTemplateStatuses(t())).toMatchObject({
      templates: { 'ticket.replied': { hi: 'pending' } },
    });
    // The enabled row is Hindi and Meta has not approved the Hindi template yet.
    expect(await notificationChannelEnabled(t(), key, 'whatsapp')).toBe(false);

    await saveWhatsAppTemplateStatuses(t(), { 'ticket.replied': { hi: 'approved', en: 'approved' } });
    expect(await notificationChannelEnabled(t(), key, 'whatsapp')).toBe(true);
    // Other channels are never gated by Meta status.
    expect(await notificationChannelEnabled(t(), key, 'email')).toBe(false);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'whatsapp.template_status_synced'))).toBe(2);
  });
});
