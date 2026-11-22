/**
 * Representative demo records ("a busy world"), stored exactly as the demo store writes them: orders waiting for
 * routing, offered to a shop and shipped; service requests new, proposed and declined; a bulk quote; a partner
 * application; reviews; a cart. Shared by the Hindi coverage gate and the state matrix (2026-11-14).
 */
import { DEMO_PRODUCTS } from '../../src/demo/catalogue';
import type {
  CartLine,
  DemoApplication,
  DemoOrder,
  DemoQuote,
  DemoReview,
  DemoServiceRequest,
} from '../../src/demo/store';
import { DEMO_WORKSHOPS } from '../../src/demo/workshops';

export const CODES = {
  routing: 'MD-RPR-2026-HND001',
  offered: 'MD-RPR-2026-HND002',
  shipped: 'MD-RPR-2026-HND003',
  delivered: 'MD-RPR-2026-HND004',
  fresh: 'SR-RPR-2026-HND101',
  proposed: 'SR-RPR-2026-HND102',
  declined: 'SR-RPR-2026-HND103',
  estimate: 'SR-RPR-2026-HND104',
  billed: 'SR-RPR-2026-HND105',
  quote: 'QT-RPR-2026-HND201',
  application: 'PA-RPR-2026-HND301',
};

/** Representative records, stored exactly as the demo store writes them (English snapshots, typed text). */
export function seedData(now: number) {
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();
  const customer = {
    name: 'Ravi Sahu',
    phone: '9876543210',
    address: 'C-605 Salasar Greens, Sarona',
    pincode: '492099',
  };
  const line = (slug: string, qty: number) => {
    const p = DEMO_PRODUCTS.find((x) => x.slug === slug);
    if (!p) throw new Error(`unknown product ${slug}`);
    return { slug, name: p.name, brand: p.brand, qty, unitPaise: p.pricePaise };
  };
  const order = (code: string, lines: DemoOrder['lines'], extra: Partial<DemoOrder>): DemoOrder => {
    const subtotalPaise = lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
    return {
      code,
      createdAt: iso(-90),
      lines,
      subtotalPaise,
      deliveryPaise: 0,
      totalPaise: subtotalPaise,
      customer,
      payment: 'cod',
      stage: 1,
      ...extra,
    };
  };
  const orders: DemoOrder[] = [
    order(
      CODES.routing,
      [line('engine-oil-filter-petrol-car', 2), line('synthetic-engine-oil-5w30-3-5l', 1)],
      {
        declined: [{ slug: 'gupta-lubes-spares', reason: 'out_of_stock', at: iso(-60) }],
        business: { gstin: '22ABVCS4888H1ZL', businessName: 'Sahu Motors' },
      },
    ),
    order(CODES.offered, [line('brake-pad-set-front', 1)], {
      shop: { slug: 'sharma-auto-parts', status: 'offered', offeredAt: iso(-5), expiresAt: iso(24 * 60) },
    }),
    order(CODES.shipped, [line('front-wheel-bearing-kit', 1), line('castrol-activ-4t-20w40-900ml', 2)], {
      stage: 4,
      shop: { slug: 'sharma-auto-parts', status: 'accepted', offeredAt: iso(-80), expiresAt: iso(-65) },
      delivery: { code: '4821', attempts: 0, confirmedAt: null, method: null },
      business: { gstin: '22ABVCS4888H1ZL', businessName: 'Sahu Motors' },
    }),
    // A delivered order: "Order again" (audience entry 2026-11-22) is offered on closed and delivered orders only.
    order(CODES.delivered, [line('brake-pad-set-front', 1), line('engine-oil-filter-petrol-car', 2)], {
      stage: 5,
      shop: { slug: 'sharma-auto-parts', status: 'accepted', offeredAt: iso(-3000), expiresAt: iso(-2990) },
      delivery: { code: '7342', attempts: 0, confirmedAt: iso(-60), method: 'code' },
    }),
  ];
  const workshop = DEMO_WORKSHOPS.find((w) => w.slug === 'telibandha-car-clinic');
  if (!workshop) throw new Error('missing workshop');
  const services = workshop.services
    .slice(0, 2)
    .map((s) => ({ key: s.key, name: s.name, minPaise: s.minPaise, maxPaise: s.maxPaise }));
  const estimateLine = (s: (typeof services)[number] | undefined, id: string) => ({
    id,
    description: s?.name ?? 'Inspection',
    serviceKey: s?.key,
    qty: 1,
    unitPaise: 150_000,
    gstRateBp: 1800,
  });
  const request = (code: string, extra: Partial<DemoServiceRequest>): DemoServiceRequest => ({
    code,
    createdAt: iso(-120),
    workshopSlug: workshop.slug,
    workshopName: workshop.name,
    vehicleType: '4W',
    vehicle: 'Maruti Suzuki Swift VXi',
    services,
    date: iso(2 * 24 * 60).slice(0, 10),
    slot: 'morning',
    concern: 'Brakes squeal when I stop at signals.',
    customer: { name: customer.name, phone: customer.phone },
    stage: 0,
    ...extra,
  });
  const requests: DemoServiceRequest[] = [
    request(CODES.fresh, {}),
    request(CODES.proposed, {
      stage: 1,
      proposal: {
        date: iso(3 * 24 * 60).slice(0, 10),
        slot: 'afternoon',
        minPaise: 250_000,
        maxPaise: 400_000,
        note: 'Bring the service book, please.',
      },
    }),
    request(CODES.declined, { declinedBy: [workshop.slug] }),
    // Estimates and bills (2026-11-14). `flow: 2` = the stage list with estimates (older records are remapped).
    request(CODES.estimate, {
      flow: 2,
      stage: 4, // estimate_sent
      odometerKm: 24_500,
      estimate: {
        version: 2,
        sentAt: iso(-30),
        decidedAt: null,
        lines: [
          { ...estimateLine(services[0], 'v2-1'), decision: 'pending' },
          {
            id: 'v2-2',
            description: 'Brake pads (front), fitted',
            qty: 1,
            unitPaise: 120_000,
            gstRateBp: 1800,
            decision: 'pending',
          },
        ],
      },
    }),
    request(CODES.billed, {
      flow: 2,
      stage: 8, // billed
      odometerKm: 31_200,
      estimate: {
        version: 1,
        sentAt: iso(-200),
        decidedAt: iso(-190),
        lines: [
          { ...estimateLine(services[0], 'v1-1'), decision: 'declined' },
          {
            id: 'v1-2',
            description: 'Brake pads (front), fitted',
            qty: 1,
            unitPaise: 120_000,
            gstRateBp: 1800,
            decision: 'approved',
          },
        ],
      },
      // 1 × ₹1,200 at 18 % → CGST = SGST = ₹108 → ₹1,416 (no round-off).
      bill: {
        lines: [
          {
            id: 'v1-2',
            description: 'Brake pads (front), fitted',
            qty: 1,
            unitPaise: 120_000,
            gstRateBp: 1800,
            taxablePaise: 120_000,
            gstPaise: 21_600,
          },
        ],
        taxablePaise: 120_000,
        cgstPaise: 10_800,
        sgstPaise: 10_800,
        roundOffPaise: 0,
        totalPaise: 141_600,
        billedAt: iso(-20),
        paidAt: null,
      },
    }),
  ];
  const quote: DemoQuote = {
    code: CODES.quote,
    createdAt: iso(-200),
    customer: { name: customer.name, phone: customer.phone },
    pincode: '492099',
    lines: [line('car-starter-battery-45ah', 12), line('engine-oil-filter-petrol-car', 20)].map((l) => ({
      slug: l.slug,
      name: l.name,
      brand: l.brand,
      qty: l.qty,
      listPaise: l.unitPaise,
    })),
    status: 'offered',
    messages: [
      { id: 'm1', from: 'customer', text: 'We run a fleet of taxis. Best price please.', at: iso(-200) },
      { id: 'm2', from: 'admin', text: 'Sure, sending an offer today.', at: iso(-150) },
    ],
    offers: [
      {
        version: 1,
        lines: [
          { slug: 'car-starter-battery-45ah', unitPaise: 490_000 },
          { slug: 'engine-oil-filter-petrol-car', unitPaise: 39_000 },
        ],
        deliveryPaise: 0,
        totalPaise: 12 * 490_000 + 20 * 39_000,
        validUntil: iso(3 * 24 * 60),
        note: 'Delivery in two batches.',
        at: iso(-140),
      },
    ],
    orderCode: null,
  };
  const application: DemoApplication = {
    code: CODES.application,
    createdAt: iso(-300),
    kind: 'seller',
    name: 'Rakesh Sharma',
    phone: '9000000001',
    business: 'Sharma Auto Parts',
    pincode: '492004',
    vehicles: ['2W', '4W'],
    details: 'Spare parts shop since 1998, two delivery bikes.',
    stage: 1,
    rejected: false,
  };
  const review: DemoReview = {
    id: 'rev-hindi-gate',
    createdAt: iso(-30),
    target: 'workshop',
    slug: 'telibandha-car-clinic',
    name: 'Ravi Sahu',
    rating: 4,
    title: 'Good work',
    body: 'Fixed the AC quickly and explained the bill.',
    status: 'pending',
  };
  const cart: CartLine[] = [
    { slug: 'exide-xltz4a-2w-battery', qty: 1 },
    { slug: 'scooter-tubeless-tyre-90-90-12', qty: 2 },
  ];
  return {
    'mechdost-demo-orders': orders,
    'mechdost-demo-requests': requests,
    'mechdost-demo-quotes': [quote],
    'mechdost-demo-applications': [application],
    'mechdost-demo-reviews': [review],
    'mechdost-cart': cart,
  };
}

export const TICKET_CODE = 'REQ-RPR-2026-HND401';

/** An open support ticket from the demo customer about the shipped order (`mechdost-demo-support`). */
export function supportTicket(now: number) {
  const at = new Date(now - 2 * 3_600_000).toISOString();
  return {
    code: TICKET_CODE,
    accountId: 'demo-customer',
    customerName: 'Ravi Sahu',
    kind: 'order_issue',
    orderCode: CODES.shipped,
    status: 'open',
    channel: 'web',
    createdAt: at,
    ackDue: new Date(now + 46 * 3_600_000).toISOString(),
    resolveDue: new Date(now + 30 * 86_400_000).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    messages: [
      {
        id: 'hnd401-1',
        role: 'customer',
        author: 'Ravi Sahu',
        body: 'The battery box arrived dented.',
        internal: false,
        channel: 'web',
        at,
      },
    ],
    version: 1,
  };
}

/** Everything at once: the busy world plus the open ticket, keyed by localStorage key. */
export function busyWorld(now: number): Record<string, unknown> {
  // The support store keeps `{ tickets }` (a bare array would fall back to its seeded WhatsApp ticket).
  return { ...seedData(now), 'mechdost-demo-support': { tickets: [supportTicket(now)] } };
}
