import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS, type ServerEvent } from '../src/analytics';

describe('client event registry', () => {
  const cancel = CLIENT_EVENT_SCHEMAS.order_cancel_submitted;

  it('order_cancel_submitted takes only a cancel reason code (ML-ready, hard rule 16)', () => {
    expect(
      cancel.safeParse({ code: 'MD-RPR-2026-ABC123', by: 'customer', reasonCode: 'changed_mind' }).success,
    ).toBe(true);
    expect(
      cancel.safeParse({ code: 'MD-RPR-2026-ABC123', by: 'customer', reasonCode: 'he was rude' }).success,
    ).toBe(false);
    expect(
      cancel.safeParse({ code: 'MD-RPR-2026-ABC123', by: 'shop', reasonCode: 'changed_mind' }).success,
    ).toBe(false);
    // No extra fields (no free-text note sneaks in).
    expect(
      cancel.safeParse({ code: 'MD-RPR-2026-ABC123', by: 'staff', reasonCode: 'other', note: 'call me' })
        .success,
    ).toBe(false);
  });

  it('paths keep only the pathname and ids are short codes (no personal data, hard rule 16)', () => {
    const view = CLIENT_EVENT_SCHEMAS.page_view;
    expect(view.parse({ path: '/track?phone=9876543210&email=a@b.in#x', locale: 'en' }).path).toBe('/track');
    expect(view.parse({ path: '/account/9876543210', locale: 'en' }).path).toBe('/account/_');
    expect(view.safeParse({ path: 'https://evil.example/', locale: 'en' }).success).toBe(false);
    const click = CLIENT_EVENT_SCHEMAS.click;
    expect(click.safeParse({ id: 'shop_order_declined', path: '/partner/shop' }).success).toBe(true);
    expect(click.safeParse({ id: 'MD-RPR-2026-ABC123', path: '/' }).success).toBe(true);
    expect(click.safeParse({ id: 'call me on 98765 43210', path: '/' }).success).toBe(false);
    expect(click.safeParse({ id: '9876543210', path: '/' }).success).toBe(false);
    expect(click.safeParse({ id: 'ravi@example.com', path: '/' }).success).toBe(false);
  });

  it('client actions never reuse the name of the server outcome they lead to', () => {
    const outcomes = Object.keys({
      purchase: 0,
      order_cancelled: 0,
      order_delivered: 0,
      seller_order_declined: 0,
    } satisfies Partial<Record<ServerEvent, 0>>);
    for (const name of outcomes) expect(Object.keys(CLIENT_EVENT_SCHEMAS)).not.toContain(name);
  });
});

describe('admin settings events (design 2026-11-24)', () => {
  it('carry codes and counts only', () => {
    const nav = CLIENT_EVENT_SCHEMAS.admin_settings_nav;
    expect(nav.safeParse({ category: 'orders', via: 'search' }).success).toBe(true);
    expect(nav.safeParse({ category: 'Orders and more', via: 'list' }).success).toBe(false);
    const search = CLIENT_EVENT_SCHEMAS.admin_settings_search;
    expect(search.safeParse({ results: 3 }).success).toBe(true);
    // The words typed are never part of the event.
    expect(search.safeParse({ results: 3, query: 'cod' }).success).toBe(false);
    expect(CLIENT_EVENT_SCHEMAS.admin_settings_discard.safeParse({ fields: 2 }).success).toBe(true);
    const confirm = CLIENT_EVENT_SCHEMAS.admin_settings_confirm;
    expect(confirm.safeParse({ outcome: 'saved', risky: 1 }).success).toBe(true);
    expect(confirm.safeParse({ outcome: 'maybe', risky: 1 }).success).toBe(false);
  });
});
