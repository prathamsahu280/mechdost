import type { WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';

/** Locale keys shared by the demo and API notification screens (spec 10). */
export const EVENT_LABEL = {
  'order.confirmed': 'notify_ev_order_confirmed',
  'order.out_for_delivery': 'notify_ev_order_out_for_delivery',
  'order.rejected': 'notify_ev_order_rejected',
  'service.estimate_sent': 'notify_ev_service_estimate_sent',
  'ticket.replied': 'notify_ev_ticket_replied',
  'order.routed': 'notify_ev_order_routed',
} as const satisfies Record<WhatsAppTemplateKey, string>;

export const PROBLEM_LABEL = {
  empty: 'notify_problem_empty',
  promo_wording: 'notify_problem_promo_wording',
  too_long: 'notify_problem_too_long',
  missing: 'notify_problem_missing',
  unknown: 'notify_problem_unknown',
} as const;

/** Sample values for the preview; codes are shown as-is in both languages. */
export const SAMPLES: Record<string, string> = {
  orderCode: 'MD-RPR-2026-7K3QWX',
  deliveryCode: '4821',
  requestCode: 'SR-RPR-2026-4M8T2B',
  ticketCode: 'REQ-RPR-2026-9F2KQA',
  acceptMinutes: '15',
};
