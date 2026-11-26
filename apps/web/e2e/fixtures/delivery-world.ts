/**
 * Delivery agents in the browser demo (spec 24): one agent-mode order of Gupta Lubes & Spares picked up by Sunil
 * (out for delivery, customer code 5307), one ready for pickup waiting for an agent, and one returned after a failed
 * delivery — stored exactly as `demo/delivery-store.ts` writes them. Separate from the busy world so the existing
 * suites keep their counts; used by the delivery e2e and the Hindi gate.
 */
import { DEMO_PRODUCTS } from '../../src/demo/catalogue';
import {
  DEMO_AGENT_IDS,
  demoDeliverySeed,
  type DemoJob,
  type DeliveryState,
} from '../../src/demo/delivery-store';
import type { DemoOrder } from '../../src/demo/store';
import { seedData } from './demo-world';

export const DELIVERY_CODES = {
  pickedUp: 'MD-RPR-2026-HND005',
  ready: 'MD-RPR-2026-HND006',
  returned: 'MD-RPR-2026-HND007',
  /** Packed by the shop, not yet ready for pickup (no job). */
  packed: 'MD-RPR-2026-HND008',
} as const;
export const DELIVERY_JOB_IDS = {
  pickedUp: '0193a5d0-0000-7000-8000-0000000b0005',
  ready: '0193a5d0-0000-7000-8000-0000000b0006',
  returned: '0193a5d0-0000-7000-8000-0000000b0007',
} as const;
export const CUSTOMER_DELIVERY_CODE = '5307';
export const PICKUP_CODE_READY = '2468';
export const AGENT_PHONES = { sunil: '9000000005', deepak: '9000000007' } as const;
export const AGENT_SHOP_PHONE = '9000000006';
const SHOP = 'gupta-lubes-spares';

export function deliveryWorld(now: number): Record<string, unknown> {
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();
  const line = (slug: string, qty: number) => {
    const p = DEMO_PRODUCTS.find((x) => x.slug === slug);
    if (!p) throw new Error(`unknown product ${slug}`);
    return { slug, name: p.name, brand: p.brand, qty, unitPaise: p.pricePaise };
  };
  const customer = {
    name: 'Ravi Sahu',
    phone: '9876543210',
    address: 'C-605 Salasar Greens, Sarona',
    pincode: '492099',
  };
  const order = (code: string, stage: number, extra: Partial<DemoOrder> = {}): DemoOrder => {
    const lines = [line('castrol-activ-4t-20w40-900ml', 1)];
    const subtotalPaise = lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
    return {
      code,
      createdAt: iso(-180),
      lines,
      subtotalPaise,
      deliveryPaise: 0,
      totalPaise: subtotalPaise,
      customer,
      payment: 'cod',
      stage,
      shop: { slug: SHOP, status: 'accepted', offeredAt: iso(-170), expiresAt: iso(-160) },
      ...extra,
    };
  };
  const orders: DemoOrder[] = [
    order(DELIVERY_CODES.pickedUp, 4, {
      delivery: { code: CUSTOMER_DELIVERY_CODE, attempts: 0, confirmedAt: null, method: null },
    }),
    order(DELIVERY_CODES.ready, 3),
    order(DELIVERY_CODES.returned, 4, {
      delivery: { code: '9911', attempts: 0, confirmedAt: null, method: null },
      returned: { at: iso(-10), refund: 'parts_only' },
    }),
    order(DELIVERY_CODES.packed, 3),
  ];
  const job = (id: string, orderCode: string, extra: Partial<DemoJob>): DemoJob => ({
    id,
    orderCode,
    shopSlug: SHOP,
    status: 'needs_agent',
    agentId: null,
    offers: [],
    events: [
      {
        at: iso(-60),
        kind: 'ready_for_pickup',
        actorType: 'shop',
        fromStatus: null,
        toStatus: 'needs_agent',
        reasonCode: null,
      },
    ],
    pickupCode: PICKUP_CODE_READY,
    pickupAttempts: 0,
    returnCode: null,
    returnAttempts: 0,
    returnOutcome: null,
    attempt: 1,
    failReason: null,
    photos: [],
    statusAt: iso(-60),
    createdAt: iso(-60),
    version: 0,
    ...extra,
  });
  const accepted = (agentId: string) => ({
    id: `${agentId.slice(0, 30)}offer1`,
    agentId,
    status: 'accepted' as const,
    reasonCode: null,
    createdAt: iso(-50),
    expiresAt: iso(-35),
    decidedAt: iso(-45),
  });
  const seed: DeliveryState = demoDeliverySeed();
  const state: DeliveryState = {
    ...seed,
    jobs: [
      job(DELIVERY_JOB_IDS.pickedUp, DELIVERY_CODES.pickedUp, {
        status: 'picked_up',
        agentId: DEMO_AGENT_IDS.sunil,
        offers: [accepted(DEMO_AGENT_IDS.sunil)],
        pickupCode: '1357',
        statusAt: iso(-20),
        version: 3,
        photos: [{ purpose: 'pickup', at: iso(-20) }],
      }),
      job(DELIVERY_JOB_IDS.ready, DELIVERY_CODES.ready, {}),
      job(DELIVERY_JOB_IDS.returned, DELIVERY_CODES.returned, {
        status: 'returned',
        agentId: DEMO_AGENT_IDS.sunil,
        offers: [accepted(DEMO_AGENT_IDS.sunil)],
        failReason: 'customer_refused',
        returnOutcome: 'close',
        statusAt: iso(-10),
        version: 6,
      }),
    ],
    modeRequests: [
      {
        id: '0193a5d0-0000-7000-8000-0000000c0001',
        shopSlug: 'raipur-battery-point',
        requestedMode: 'agents',
        reasonCode: 'faster_local_delivery',
        note: null,
        status: 'pending',
        decisionReason: null,
        createdAt: iso(-300),
        decidedAt: null,
        version: 0,
      },
    ],
  };
  return {
    'mechdost-demo-orders': [...(seedData(now)['mechdost-demo-orders'] as DemoOrder[]), ...orders],
    'mechdost-demo-delivery': [state],
  };
}
