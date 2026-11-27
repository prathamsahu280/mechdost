import { Suspense } from 'react';
import { ShopPortal } from '@/components/portal/shop-portal';

/** Shop portal, Orders tab: lanes with counts; `?lane=` and `?order=` keep the place (design 2026-11-27 § 5.1). */
export default function ShopOrdersPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-card" aria-hidden="true" />}>
      <ShopPortal tab="orders" />
    </Suspense>
  );
}
