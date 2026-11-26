'use client';

import { useEffect, useState } from 'react';
import { shopOrderDelivery, subscribeDelivery } from '@/demo/delivery-store';
import type { ShopOrderDeliveryView } from '@/lib/delivery/types';

/**
 * The browser demo's `ShopOrderDelivery` for one order of this shop (spec 24), kept fresh on every demo change. The API
 * build reads the same block from `GET /v1/shop/orders` instead. Null = the shop delivers this order itself.
 */
export function useDemoShopDelivery(orderCode: string, shopSlug: string): ShopOrderDeliveryView | null {
  const [view, setView] = useState<ShopOrderDeliveryView | null>(() =>
    shopOrderDelivery(orderCode, shopSlug),
  );
  useEffect(() => {
    const read = () => {
      setView(shopOrderDelivery(orderCode, shopSlug));
    };
    read();
    return subscribeDelivery(read);
  }, [orderCode, shopSlug]);
  return view;
}
