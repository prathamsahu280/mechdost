'use client';

import { useEffect, useState } from 'react';
import { customerDelivery, rateDelivery, subscribeDelivery } from '@/demo/delivery-store';
import type { CustomerDeliveryView } from '@/lib/delivery/types';
import { CustomerDeliveryCard } from './customer-delivery';

/**
 * The customer's delivery block in the browser demo (spec 24): read from the demo delivery store and refreshed on
 * every change. Loaded with `next/dynamic` by the order page, so storefront pages never carry the demo store.
 */
export default function DemoCustomerDelivery({ code }: { code: string }) {
  const [view, setView] = useState<CustomerDeliveryView | null>(null);
  useEffect(() => {
    const read = () => {
      setView(customerDelivery(code));
    };
    read();
    return subscribeDelivery(read);
  }, [code]);
  if (!view) return null;
  return (
    <div className="mt-5">
      <CustomerDeliveryCard
        view={view}
        rate={(stars, reasons, note) => {
          const r = rateDelivery(code, stars, reasons, note);
          return Promise.resolve(r.ok ? r : { ok: false, status: 409, code: r.code });
        }}
      />
    </div>
  );
}
