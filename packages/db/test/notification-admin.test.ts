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
  listNotificationTemplates,
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
  body: 'आपका ऑर्डर {{1}} रास्ते में है। डिलीवरी कोड {{2}} केवल डिलीवरी पार्टनर को बताएँ।',
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
    await expect(
      save({ body: 'Order {{1}} is on the way, code {{2}}. Get 10% off next time!' }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_PROMO_WORDING' });
    await expect(save({ body: 'Order {{1}} is on the way.' })).rejects.toMatchObject({
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
