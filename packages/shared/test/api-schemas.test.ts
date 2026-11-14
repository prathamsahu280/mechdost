import { describe, expect, it } from 'vitest';
import {
  AdminContentList,
  AdminSettingList,
  CustomerBlockList,
  NotificationTemplateList,
  WhatsAppUsage,
} from '../src/admin-config-api';
import { SupportInbox, SupportOrderChoices, SupportTicketList } from '../src/support-api';

/** The web validates API answers with these (hard rule 4); samples mirror the API's OpenAPI shapes. */
const at = '2026-11-14T10:00:00.000Z';

describe('support response schemas', () => {
  const ticket = {
    code: 'REQ-RPR-2026-7K3Q9X',
    kind: 'refund',
    status: 'open',
    channel: 'web',
    orderCode: null,
    slaAckDue: at,
    slaResolveDue: at,
    resolvedAt: null,
    createdAt: at,
    version: 1,
    messages: [{ id: 'm1', role: 'customer', body: 'hi', internal: false, channel: 'web', createdAt: at }],
  };

  it('accepts tickets and reads unknown kinds and channels safely', () => {
    const parsed = SupportTicketList.parse({
      tickets: [ticket, { ...ticket, kind: 'new_kind', channel: 'sms' }],
    });
    expect(parsed.tickets[1]?.kind).toBe('other');
    expect(parsed.tickets[1]?.channel).toBe('web');
  });

  it('refuses an unknown status', () => {
    expect(SupportTicketList.safeParse({ tickets: [{ ...ticket, status: 'lost' }] }).success).toBe(false);
  });

  it('accepts the inbox and the order choices', () => {
    const { messages: _m, resolvedAt: _r, ...rest } = ticket;
    expect(SupportInbox.safeParse({ tickets: [{ ...rest, acknowledged: false }] }).success).toBe(true);
    expect(
      SupportOrderChoices.parse({
        orders: [{ checkoutId: 'x', orders: [{ code: 'MD-RPR-2026-AAAAAA', status: 'new' }] }],
      }),
    ).toEqual({ orders: [{ orders: [{ code: 'MD-RPR-2026-AAAAAA' }] }] });
  });
});

describe('admin config response schemas', () => {
  it('accepts templates and usage', () => {
    expect(
      NotificationTemplateList.safeParse({
        templates: [
          {
            key: 'order.confirmed',
            channel: 'whatsapp',
            locale: 'hi',
            subject: null,
            body: 'x {{1}}',
            enabled: true,
            version: 2,
            updatedAt: at,
          },
        ],
        whatsappCatalogue: [
          {
            key: 'order.confirmed',
            metaName: 'order_confirmed',
            category: 'utility',
            params: ['orderCode'],
            audience: 'customer',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      WhatsAppUsage.safeParse({
        budgetPaise: null,
        budgetVersion: null,
        monthStart: at,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        costPaise: 0,
        overBudget: false,
        byCategory: [],
      }).success,
    ).toBe(true);
  });

  it('accepts settings, content (text and policy) and blocks', () => {
    expect(
      AdminSettingList.safeParse({
        settings: [
          {
            key: 'checkout.cod_fee_paise',
            default: 0,
            global: { value: 1000, version: 1 },
            city: null,
            effective: 1000,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      AdminContentList.safeParse({
        entries: [
          { key: 'hero.lead', locale: 'en', draft: { value: 'x', version: 1 }, published: null },
          {
            key: 'policy.privacy',
            locale: 'hi',
            draft: null,
            published: {
              value: {
                title: 't',
                lead: 'l',
                updatedOn: '2026-11-14',
                sections: [{ heading: 'h', body: 'b' }],
              },
              version: 1,
              publishedAt: at,
            },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      CustomerBlockList.safeParse({
        blocks: [
          {
            id: 'b1',
            level: 'cod_only',
            reasonCode: 'fake_orders',
            note: null,
            endsAt: null,
            createdAt: at,
            liftedAt: null,
            liftedReason: null,
            inForce: true,
            version: 1,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
