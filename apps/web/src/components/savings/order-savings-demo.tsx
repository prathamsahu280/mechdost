'use client';

import { findProduct } from '@/demo/catalogue';
import { isClosed, ORDER_STAGES, type DemoOrder } from '@/demo/store';
import { demoOrderSavings } from '@/lib/savings-view';
import { OrderSavingsPanel, shown, type Figures } from './order-savings';

/**
 * Demo store "Your savings" on the order page (decision 2026-11-26): the same maths as the API on the browser's order.
 * The demo keeps no MRP snapshot or ledger, so it reads the demo catalogue's MRP for each line (its prices never move).
 */
export function OrderSavingsDemo({ order, override }: { order: DemoOrder; override: string | null }) {
  const figures: Figures = {
    ...demoOrderSavings({
      at: new Date(order.createdAt),
      delivered: order.stage === ORDER_STAGES.length - 1,
      live: !isClosed(order),
      lines: order.lines.map((l) => {
        const p = findProduct(l.slug);
        const size = l.sku ? p?.sizes?.find((x) => x.sku === l.sku) : undefined;
        return { qty: l.qty, unitPaise: l.unitPaise, mrpPaise: size?.mrpPaise ?? p?.mrpPaise ?? null };
      }),
      coinsPaise: order.coins?.discountPaise ?? 0,
    }),
    refunded: false,
  };
  return shown(figures) ? <OrderSavingsPanel figures={figures} override={override} /> : null;
}
