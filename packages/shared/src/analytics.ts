/**
 * Server-side analytics events (spec 12; hard rules 9 and 16). Emitted by the API inside the same transaction
 * as the state or money change they describe, so each is stored exactly once. Props carry ids, codes, enums and
 * integer paise only — never names, phone numbers, emails, addresses or free text.
 */
export interface ServerEventProps {
  purchase: {
    orderCode: string;
    subOrders: number;
    items: number;
    totalPaise: number;
    paymentMethod: 'cod' | 'online';
  };
  admin_order_routed: { orderCode: string; shopId: string; attempt: number };
  admin_order_rerouted: { orderCode: string; shopId: string; attempt: number };
  admin_order_rejected: { orderCode: string; reasonCode: string };
  seller_order_accepted: { orderCode: string; shopId: string; secondsToAccept: number };
  seller_order_declined: { orderCode: string; shopId: string; reasonCode: string };
  order_cancelled: { orderCode: string; by: 'customer' | 'staff'; reasonCode: string; fromStatus: string };
  order_delivered: { orderCode: string; shopId: string };
  admin_customer_blocked: { level: string; reasonCode: string };
  admin_customer_unblocked: { level: string };
  admin_product_status_changed: { productSlug: string; from: string; to: string };
  inventory_updated: { shopId: string; sku: string; fields: string[]; by: 'shop' | 'staff' };
}
export type ServerEvent = keyof ServerEventProps;
