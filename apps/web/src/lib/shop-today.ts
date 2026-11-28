import { istDateString } from '@mechdost/shared/time';
import { countText } from './partner-kit';

/**
 * Shop "Today" counts (design 2026-11-27 § 5.2) from the three lists the portal already loads — no new API. A paged
 * list says "20+" when it has a next page. Orders on their way count as "Out for delivery"; every other active order
 * is still being packed (agent-mode orders that are packed wait for the partner: "Ready for pickup").
 */
export interface ShopTodayCounts {
  newOrders: string;
  packing: string;
  out: string;
  readyForPickup: string;
  delivered: string;
}

const ON_THE_WAY = new Set(['shipped', 'out_for_delivery']);

export function shopTodayCounts(input: {
  offers: number;
  active: readonly { status: string; deliveryMode?: 'agent' | 'shop' | undefined }[];
  activeMore: boolean;
  done: readonly { status: string; deliveredAt?: string | null | undefined }[];
  doneMore: boolean;
  /** The moment the day is counted in (IST business day, never the device's time zone). */
  now: Date;
}): ShopTodayCounts {
  let packing = 0;
  let out = 0;
  let ready = 0;
  for (const o of input.active) {
    if (ON_THE_WAY.has(o.status)) out += 1;
    else if (o.deliveryMode === 'agent' && o.status === 'packed') ready += 1;
    else packing += 1;
  }
  const today = istDateString(input.now);
  const delivered = input.done.filter(
    (o) => o.status === 'delivered' && o.deliveredAt && istDateString(new Date(o.deliveredAt)) === today,
  ).length;
  return {
    newOrders: String(input.offers),
    packing: countText(packing, input.activeMore),
    out: countText(out, input.activeMore),
    readyForPickup: countText(ready, input.activeMore),
    delivered: countText(delivered, input.doneMore),
  };
}
