'use client';

import { useLocale } from 'next-intl';
import { useState } from 'react';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import type { CustomerDeliveryView } from '@/lib/delivery/types';
import { CustomerDeliveryCard } from './customer-delivery';

type Rating = NonNullable<CustomerDeliveryView['rating']>;

/** `PUT …/delivery-rating` answers the stored stars, the end of the edit window and the new version. */
const Saved: ResponseSchema<{ stars: number; editableUntil: string; version: number } | null> = {
  safeParse: (v) => {
    if (typeof v !== 'object' || v === null) return { success: true, data: null };
    const o = v as Record<string, unknown>;
    return typeof o.stars === 'number' && typeof o.editableUntil === 'string' && typeof o.version === 'number'
      ? { success: true, data: { stars: o.stars, editableUntil: o.editableUntil, version: o.version } }
      : { success: true, data: null };
  },
};

/**
 * The customer's delivery block on the API (real data): `TrackedOrder.delivery` of `GET /v1/me/orders/{code}`
 * (contract `CustomerDeliveryBlock`, spec 24 § 16 G2). Rating: `PUT /v1/me/orders/{code}/delivery-rating`; an edit
 * sends the rating's `version` back (conditional update, hard rule 3). What was just saved is kept here so the block
 * shows the new stars and the next edit carries the new version, without a reload (DC-P12).
 */
export default function ApiCustomerDelivery({ code, view }: { code: string; view: CustomerDeliveryView }) {
  const locale = useLocale();
  const [saved, setSaved] = useState<Rating | null>(null);
  const rating = saved ?? view.rating ?? null;
  const version = rating?.version;
  return (
    <CustomerDeliveryCard
      view={{ ...view, rating }}
      rate={async (stars, reasons, note) => {
        const res = await adminApi(locale, `/me/orders/${encodeURIComponent(code)}/delivery-rating`, Saved, {
          method: 'PUT',
          body: { stars, reasons, ...(note ? { note } : {}), ...(version === undefined ? {} : { version }) },
        });
        if (!res.ok) return res;
        if (res.data) {
          setSaved({
            stars: res.data.stars,
            reasons,
            note: note ?? null,
            editableUntil: res.data.editableUntil,
            version: res.data.version,
          });
        }
        return { ok: true, data: null };
      }}
    />
  );
}
