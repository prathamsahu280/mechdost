/**
 * DEMO REFUNDS (spec 05, 2026-11-23): three sample refunds so the browser demo can show the customer's Refunds page
 * (a Razorpay refund on its way, a cash-on-delivery payout waiting for approval, and a finished one). Real refunds
 * come from `GET /v1/me/refunds`; nothing here is stored or moves money.
 */
import type { MyRefund } from '@mechdost/shared/refunds-api';

export const DEMO_REFUNDS: readonly MyRefund[] = [
  {
    id: 'demo-refund-sent',
    target: { kind: 'order', code: 'MD-RPR-2026-DEMO01' },
    amountPaise: 184_000,
    reasonCode: 'order_rejected',
    method: 'original',
    stage: 'sent',
    requestedAt: '2026-11-18T09:30:00.000Z',
    approvedAt: '2026-11-18T13:10:00.000Z',
    sentAt: '2026-11-18T13:12:00.000Z',
    completedAt: null,
    providerRefundId: 'rfnd_DemoSent0001',
  },
  {
    id: 'demo-refund-requested',
    target: { kind: 'order', code: 'MD-RPR-2026-DEMO02' },
    amountPaise: 62_500,
    reasonCode: 'faulty',
    method: 'manual',
    stage: 'requested',
    requestedAt: '2026-11-21T16:45:00.000Z',
    approvedAt: null,
    sentAt: null,
    completedAt: null,
    providerRefundId: null,
  },
  {
    id: 'demo-refund-completed',
    target: { kind: 'service', code: 'SR-RPR-2026-DEMO03' },
    amountPaise: 95_000,
    reasonCode: 'service_cancelled',
    method: 'original',
    stage: 'completed',
    requestedAt: '2026-11-05T11:00:00.000Z',
    approvedAt: '2026-11-05T15:00:00.000Z',
    sentAt: '2026-11-05T15:02:00.000Z',
    completedAt: '2026-11-07T08:20:00.000Z',
    providerRefundId: 'rfnd_DemoDone0003',
  },
];
