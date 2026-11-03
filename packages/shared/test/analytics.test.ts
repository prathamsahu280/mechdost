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

  it('client actions never reuse the name of the server outcome they lead to', () => {
    const outcomes: ServerEvent[] = ['order_cancelled', 'order_delivered', 'seller_order_declined'];
    for (const name of outcomes) expect(Object.keys(CLIENT_EVENT_SCHEMAS)).not.toContain(name);
  });
});
