'use client';

import { useLocale } from 'next-intl';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import type { CustomerDeliveryView } from '@/lib/delivery/types';
import { CustomerDeliveryCard } from './customer-delivery';

const Empty: ResponseSchema<null> = { safeParse: () => ({ success: true, data: null }) };

/**
 * The customer's delivery block on the API (real data): `TrackedOrder.delivery` of `GET /v1/me/orders/{code}`
 * (contract `CustomerDeliveryBlock`, spec 24 § 16 G2). Rating: `PUT /v1/me/orders/{code}/delivery-rating`; an edit
 * sends the rating's `version` back (conditional update, hard rule 3).
 */
export default function ApiCustomerDelivery({ code, view }: { code: string; view: CustomerDeliveryView }) {
  const locale = useLocale();
  const version = view.rating?.version;
  return (
    <CustomerDeliveryCard
      view={view}
      rate={(stars, reasons, note) =>
        adminApi(locale, `/me/orders/${encodeURIComponent(code)}/delivery-rating`, Empty, {
          method: 'PUT',
          body: { stars, reasons, ...(note ? { note } : {}), ...(version === undefined ? {} : { version }) },
        })
      }
    />
  );
}
