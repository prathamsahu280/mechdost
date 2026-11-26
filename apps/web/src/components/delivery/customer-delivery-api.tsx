'use client';

import { useLocale } from 'next-intl';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import type { CustomerDeliveryView } from '@/lib/delivery/types';
import { CustomerDeliveryCard } from './customer-delivery';

const Empty: ResponseSchema<null> = { safeParse: () => ({ success: true, data: null }) };

/**
 * The `delivery` block of one part of the customer's order (`GET /v1/me/orders/{code}`, contract
 * `CustomerDeliveryBlock`). The shared order schema does not list it yet (contract gap): read when present.
 */
export function customerDeliveryOf(part: object): CustomerDeliveryView | null {
  if (!('delivery' in part)) return null;
  const d: unknown = part.delivery;
  return typeof d === 'object' && d !== null && 'stage' in d ? (d as CustomerDeliveryView) : null;
}

/**
 * The customer's delivery block on the API (real data). Rating: `PUT /v1/me/orders/{code}/delivery-rating` (the route
 * is not in the contract yet; founder ruling 2026-11-26, backend adds it).
 */
export default function ApiCustomerDelivery({ code, view }: { code: string; view: CustomerDeliveryView }) {
  const locale = useLocale();
  return (
    <CustomerDeliveryCard
      view={view}
      rate={(stars, reasons, note) =>
        adminApi(locale, `/me/orders/${encodeURIComponent(code)}/delivery-rating`, Empty, {
          method: 'PUT',
          body: { stars, reasons, ...(note ? { note } : {}) },
        })
      }
    />
  );
}
