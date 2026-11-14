/**
 * Typed fixtures of the mocked API (`mock-api.ts`) for the API-mode audit rows (`model-api.ts`). Every builder
 * returns a value typed with the shared DTO (`z.infer` of the response schema), so a contract change breaks the
 * build (`pnpm typecheck`), and every mock carries the schema so a fixture that no longer parses fails the case
 * (and `test/state-audit-api-fixtures.test.ts`). Pure data: no Playwright import, so Vitest runs it.
 */
import { AdminContentList, CustomerBlockList } from '@mechdost/shared/admin-config-api';
import {
  AuditPageDto,
  CustomerSearchDto,
  CustomerViewDto,
  StaffListDto,
} from '@mechdost/shared/admin-people-api';
import { AdminErrors } from '@mechdost/shared/admin-errors-api';
import { AdminOverviewDto, AnalyticsDashboardDto } from '@mechdost/shared/admin-analytics-api';
import { AdminCoinActivityDto } from '@mechdost/shared/coins-api';
import { QuotePageDto } from '@mechdost/shared/quote-api';
import { AdminReviewsDto } from '@mechdost/shared/reviews-api';
import { MyOrderDto } from '@mechdost/shared/checkout-api';
import {
  OrderChanged,
  RoutingOrder,
  RoutingQueue,
  ShopOrderList,
  type ShopOrderDto,
} from '@mechdost/shared/order-views';
import {
  type PartnerWarningsView,
  AdminPartnerWarnings,
  ShopWarningsList,
} from '@mechdost/shared/partner-warnings';
import { type MeRoles, ShopAgreement, ShopOffers, PriceRequestPage } from '@mechdost/shared/partner-api';
import { AdminRefundDto, AdminRefundPageDto } from '@mechdost/shared/refunds-api';
import {
  AdminShopDetail,
  AdminShopList,
  MyShops,
  type AdminShopRowDto,
  type MyShopDto,
} from '@mechdost/shared/shop-api';
import type { AuditCase } from '../cases.ts';
import { homeFinderMocks, homeJobMocks, homeRequestMocks } from './home-fixtures.ts';
import type { Mock, MockCtx, Reply } from './mock-api.ts';

const NOW = Date.parse('2026-11-15T10:00:00.000Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SHOP_ID = uuid(1);
const LONG_EN =
  'Sharma Auto Parts and Genuine Lubricants Wholesale Dealers, Telibandha Main Road Opposite Marine Drive Raipur';
const LONG_HI =
  'शर्मा ऑटो पार्ट्स एंड जेनुइन लुब्रिकेंट्स होलसेल डीलर्स, तेलीबांधा मेन रोड, मरीन ड्राइव के सामने, रायपुर छत्तीसगढ़';

const long = (c: AuditCase) => c.state.stress === 'long-text';
const loc = (c: AuditCase) => (c.locale === 'hi' ? LONG_HI : LONG_EN);

/** The type a shared Zod schema parses to (the web app does not depend on zod itself). */
type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

// ── Who is signed in ───────────────────────────────────────────────────────────────────────────────────────────

function meMock(): Mock {
  return {
    method: 'GET',
    path: /^\/me$/,
    reply: ({ c }) => ({
      body: {
        name: 'Audit User',
        phone: '+919876543210',
        email: 'audit@example.com',
        emailVerified: true,
        language: c.locale,
        version: 1,
        roles:
          c.auth === 'shop'
            ? [{ role: 'seller_owner', shopId: SHOP_ID, workshopId: null }]
            : c.auth === 'admin'
              ? [{ role: 'ops_manager', shopId: null, workshopId: null }]
              : [{ role: 'customer', shopId: null, workshopId: null }],
      } satisfies Dto<typeof MeRoles> & Record<string, unknown>,
    }),
  };
}

// ── Refunds (spec 05) ──────────────────────────────────────────────────────────────────────────────────────────

type Refund = Dto<typeof AdminRefundDto>;

function refundBase(over: Partial<Refund>): Refund {
  return {
    id: 'rf-1',
    status: 'requested',
    version: 1,
    source: 'support_claim',
    reasonCode: 'faulty',
    note: 'Customer sent a photo of the cracked seal',
    amountPaise: 489_900,
    orderCode: 'MD-RPR-2026-HND301-1',
    groupCode: 'MD-RPR-2026-HND301',
    paymentMethod: 'online',
    mode: 'source',
    destinationMasked: null,
    manualReference: null,
    requestedBy: 'staff-2',
    approvedBy: null,
    requestedAt: iso(-240),
    decidedAt: null,
    processedAt: null,
    rejectReasonCode: null,
    failureCode: null,
    providerReportedPaise: null,
    providerRefundId: null,
    overdue: false,
    canApprove: true,
    ...over,
  };
}

export function refundVariant(name: string): Refund {
  switch (name) {
    case 'requested-own':
      return refundBase({ requestedBy: 'me', canApprove: false });
    case 'overdue':
      return refundBase({ overdue: true, requestedAt: iso(-60 * 80) });
    case 'approved-razorpay':
      return refundBase({
        status: 'initiated',
        approvedBy: 'staff-3',
        decidedAt: iso(-30),
        providerRefundId: 'rfnd_audit000001',
      });
    case 'approved-cod':
      return refundBase({
        status: 'approved',
        paymentMethod: 'cod',
        mode: 'bank_upi',
        destinationMasked: 'ra***@okhdfc',
        approvedBy: 'staff-3',
        decidedAt: iso(-30),
        canApprove: false,
      });
    case 'processed':
      return refundBase({
        status: 'processed',
        approvedBy: 'staff-3',
        decidedAt: iso(-300),
        processedAt: iso(-20),
        providerRefundId: 'rfnd_audit000002',
        canApprove: false,
      });
    case 'failed':
      return refundBase({
        status: 'failed',
        failureCode: 'BAD_REQUEST_ERROR',
        approvedBy: 'staff-3',
        canApprove: false,
      });
    case 'needs-reconciliation':
      return refundBase({
        status: 'needs_reconciliation',
        providerReportedPaise: 489_000,
        approvedBy: 'staff-3',
        canApprove: false,
      });
    default:
      return refundBase({});
  }
}

function refundMocks(): Mock[] {
  const filler = (n: number): Refund =>
    refundBase({
      id: `rf-f${String(n)}`,
      amountPaise: 99_900 * n,
      orderCode: `MD-RPR-2026-HND30${String(n)}-1`,
      groupCode: `MD-RPR-2026-HND30${String(n)}`,
    });
  return [
    {
      method: 'GET',
      path: /^\/admin\/refunds$/,
      schema: AdminRefundPageDto,
      reply: ({ c }) => ({
        body: {
          items: [refundVariant(c.state.refund ?? 'requested'), filler(2), filler(3)],
          nextCursor: null,
          counts: { waiting: 3, overdue: 1, attention: 1 },
        } satisfies Dto<typeof AdminRefundPageDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/refunds\/[^/]+$/,
      schema: AdminRefundDto,
      reply: ({ c }) => ({ body: refundVariant(c.state.refund ?? 'requested') }),
    },
  ];
}

/** The customer's order with one or two refunds on its part (`ORD-REFUNDLINE`). */
function orderRefundMock(): Mock {
  return {
    method: 'GET',
    path: /^\/orders\/[^/]+$/,
    schema: MyOrderDto,
    reply: ({ c }) => {
      const kind = c.state.refund ?? 'under_review';
      const one = (
        status: 'under_review' | 'processing' | 'refunded' | 'declined' | 'failed',
        amountPaise: number,
      ) => ({
        status,
        amountPaise,
        requestedAt: iso(-2_000),
        processedAt: status === 'refunded' ? iso(-600) : null,
      });
      const refunds =
        kind === 'two-refunds'
          ? [one('refunded', 100_000), one('under_review', 89_900)]
          : [one(kind as 'under_review', 189_900)];
      const title = long(c) ? loc(c) : 'Castrol Activ 4T 20W-40 900 ml';
      return {
        body: {
          code: 'MD-RPR-2026-HND301',
          placedAt: iso(-3_000),
          totalPaise: 289_900,
          placedTotalPaise: 289_900,
          paymentMethod: 'online',
          paymentStatus: 'paid',
          business: null,
          coins: null,
          orders: [
            {
              code: 'MD-RPR-2026-HND301-1',
              status: 'delivered',
              version: 5,
              totalPaise: 289_900,
              shippingPaise: 0,
              seller: 'Sharma Auto Parts',
              items: [{ title, sku: 'CAS-4T-900', qty: 2, unitPaise: 144_950, totalPaise: 289_900 }],
              timeline: [
                { status: 'placed', at: iso(-3_000) },
                { status: 'confirmed', at: iso(-2_900) },
                { status: 'delivered', at: iso(-2_200) },
              ],
              message: null,
              deliveryCode: null,
              canCancel: false,
              refunds,
            },
          ],
        } satisfies Dto<typeof MyOrderDto>,
      };
    },
  };
}

// ── Shop portal (specs 04, 07) ─────────────────────────────────────────────────────────────────────────────────

function myShop(c: AuditCase): MyShopDto {
  const shop = c.state.shop ?? 'open';
  const status = shop === 'paused' ? 'paused' : shop === 'suspended' ? 'suspended' : 'approved';
  return {
    id: SHOP_ID,
    name: long(c) ? LONG_EN : 'Sharma Auto Parts',
    nameHi: long(c) ? LONG_HI : 'शर्मा ऑटो पार्ट्स',
    addressLine: long(c) ? LONG_EN : 'Shop 4, Telibandha Main Road',
    addressLineHi: long(c) ? LONG_HI : 'दुकान 4, तेलीबांधा मेन रोड',
    pincode: '492006',
    status,
    standing:
      status === 'approved'
        ? null
        : {
            reasonCode: status === 'paused' ? 'missed_offers' : 'policy_violation',
            note: long(c) ? loc(c) : 'Three offers missed this week',
            until: status === 'paused' ? iso(60 * 48) : null,
            since: iso(-60 * 5),
          },
    busy: false,
    coverage: { pincodes: 21, minShippingPaise: 0, maxShippingPaise: 9_900 },
    freeDeliveryMinPaise: 99_900,
    hours: { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] },
    openNow: shop !== 'closed-hours',
    version: 4,
    offersOnSale: 38,
    offers30d: { accepted: 41, answered: 48 },
    isOwner: true,
  };
}

function shopOrder(c: AuditCase, n: number, over: Partial<ShopOrderDto>): ShopOrderDto {
  return {
    code: `MD-RPR-2026-HND40${String(n)}-1`,
    status: 'confirmed',
    version: 3,
    totalPaise: 289_900,
    payoutPaise: 264_000,
    collectPaise: n % 2 === 0 ? 289_900 : null,
    pincode: '492001',
    items: [
      {
        title: long(c) ? loc(c) : 'Castrol Activ 4T 20W-40 900 ml',
        titleHi: 'कैस्ट्रॉल एक्टिव 4T',
        sku: 'CAS-4T-900',
        qty: 2,
        unitPaise: 132_000,
      },
      { title: 'Spark plug iridium', titleHi: null, sku: 'SPK-IR', qty: 1, unitPaise: 38_000 },
    ],
    assignmentId: uuid(100 + n),
    expiresAt: null,
    address: {
      contactName: 'Ravi Sahu',
      contactPhone: '9876543210',
      line1: 'C-605 Salasar Greens, Sarona',
      landmark: 'Near Tatibandh chowk',
      pincode: '492099',
    },
    givenUpReason: null,
    ...over,
  };
}

function shopOrders(c: AuditCase, view: string): ShopOrderDto[] {
  const kind = c.state.orders ?? 'none';
  if (kind === 'none') return [];
  if (view === 'offers')
    return kind === 'offer' || kind === 'many'
      ? [shopOrder(c, 1, { status: 'awaiting_shop', expiresAt: iso(25), address: null })]
      : [];
  if (view === 'done')
    return kind === 'given-up-history'
      ? [
          shopOrder(c, 3, {
            status: 'given_up',
            payoutPaise: null,
            collectPaise: null,
            items: [],
            givenUpReason: 'out_of_stock',
            address: null,
          }),
        ]
      : kind === 'many'
        ? [shopOrder(c, 4, { status: 'delivered', address: null })]
        : [];
  if (kind === 'confirmed') return [shopOrder(c, 2, { status: 'confirmed' })];
  if (kind === 'packed') return [shopOrder(c, 2, { status: 'packed' })];
  if (kind === 'many')
    return [
      shopOrder(c, 2, { status: 'confirmed' }),
      shopOrder(c, 5, { status: 'packed' }),
      shopOrder(c, 6, { status: 'shipped' }),
      shopOrder(c, 7, { status: 'out_for_delivery' }),
    ];
  return [];
}

function warningsView(c: AuditCase): Dto<typeof PartnerWarningsView> {
  const w = c.state.warn ?? c.state.warnings ?? 'none';
  const row = (
    n: number,
    reasonCode: 'missed_offers' | 'gave_up_orders' | 'other',
    withdrawn: boolean,
    note: string | null,
  ) => ({
    id: uuid(200 + n),
    reasonCode,
    note,
    createdAt: iso(-60 * 24 * n),
    withdrawn,
  });
  const warnings =
    w === 'one' || w === 'issued'
      ? [row(1, 'missed_offers', false, 'Three offers expired unanswered')]
      : w === 'threshold' || w === 'prompt'
        ? [
            row(1, 'missed_offers', false, null),
            row(2, 'gave_up_orders', false, 'Gave up two confirmed orders'),
            row(3, 'other', false, 'Rude on the phone'),
          ]
        : w === 'withdrawn'
          ? [row(1, 'missed_offers', true, 'Issued by mistake'), row(2, 'gave_up_orders', false, null)]
          : w === 'long-note'
            ? [row(1, 'other', false, long(c) ? loc(c) : `${LONG_EN} ${LONG_EN}`.slice(0, 290))]
            : [];
  return { windowDays: 30, counting: warnings.filter((x) => !x.withdrawn).length, warnings };
}

function shopPortalMocks(): Mock[] {
  const offer = (n: number) => ({
    sku: `SKU-${String(n)}`,
    product: `Engine oil ${String(n)}`,
    productSlug: `engine-oil-${String(n)}`,
    mrpPaise: 99_900,
    sellingPaise: 89_900,
    onHand: 12,
    reserved: 2,
    free: 10,
    leadDays: 1,
    active: true,
    version: 1,
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/shop\/me$/,
      schema: MyShops,
      reply: ({ c }) => ({ body: { shops: [myShop(c)] } satisfies Dto<typeof MyShops> }),
    },
    {
      method: 'GET',
      path: /^\/shop\/orders$/,
      schema: ShopOrderList,
      reply: ({ c, query }) => ({
        body: { orders: shopOrders(c, query.get('view') ?? 'active'), nextCursor: null } satisfies Dto<
          typeof ShopOrderList
        >,
      }),
    },
    {
      method: 'POST',
      path: /^\/shop\/orders\/[^/]+\/give-up$/,
      schema: OrderChanged,
      reply: () => ({ body: { status: 'needs_rerouting', version: 4 } }),
    },
    {
      method: 'GET',
      path: /^\/shop\/warnings$/,
      schema: ShopWarningsList,
      reply: ({ c }): Reply =>
        c.state.warnings === 'error'
          ? { status: 500, code: 'INTERNAL' }
          : {
              body: { shops: [{ shopId: SHOP_ID, ...warningsView(c) }] } satisfies Dto<
                typeof ShopWarningsList
              >,
            },
    },
    {
      method: 'GET',
      path: /^\/shop-onboarding\/[^/]+\/agreement$/,
      schema: ShopAgreement,
      reply: ({ c }) => ({
        body: {
          current: {
            version: 2,
            textEn: 'MechDost partner agreement. Keep stock honest and answer offers on time.',
            textHi: 'मेकदोस्त पार्टनर समझौता। स्टॉक सही रखें और ऑफ़र का समय पर जवाब दें।',
            publishedAt: iso(-60 * 24 * 3),
          },
          acceptedVersions: c.state.agreement === 'new-version' ? [1] : [1, 2],
        } satisfies Dto<typeof ShopAgreement>,
      }),
    },
    {
      method: 'GET',
      path: /^\/shops\/[^/]+\/inventory$/,
      schema: ShopOffers,
      reply: () => ({ body: { offers: [offer(1), offer(2)] } satisfies Dto<typeof ShopOffers> }),
    },
    {
      method: 'GET',
      path: /^\/shop-onboarding\/[^/]+\/price-requests$/,
      schema: PriceRequestPage,
      reply: () => ({ body: { items: [], nextCursor: null } satisfies Dto<typeof PriceRequestPage> }),
    },
  ];
}

// ── Admin: shops, warnings ─────────────────────────────────────────────────────────────────────────────────────

function adminShopRow(c: AuditCase, n: number, over: Partial<AdminShopRowDto> = {}): AdminShopRowDto {
  return {
    id: n === 1 ? SHOP_ID : uuid(n),
    cityId: uuid(900),
    name: long(c) ? LONG_EN : `Sharma Auto Parts ${String(n)}`,
    nameHi: long(c) ? LONG_HI : n % 3 === 0 ? null : `शर्मा ऑटो पार्ट्स ${String(n)}`,
    addressLine: long(c) ? LONG_EN : 'Shop 4, Telibandha Main Road',
    addressLineHi: long(c) ? LONG_HI : null,
    pincode: '492006',
    status: 'approved',
    gstStatus: 'registered',
    busy: false,
    coveragePincodes: 21,
    offersOnSale: 38,
    freeDeliveryMinPaise: 99_900,
    hours: { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] },
    openNow: true,
    version: 4,
    missingHindi: n % 3 === 0 ? ['name'] : [],
    ...over,
  };
}

function shopRows(c: AuditCase): AdminShopRowDto[] {
  switch (c.state.shops ?? 'one') {
    case 'none':
      return [];
    case 'many':
      return Array.from({ length: 12 }, (_, i) => adminShopRow(c, i + 1));
    case 'mixed-status':
      return [
        adminShopRow(c, 1),
        adminShopRow(c, 2, { status: 'pending', gstStatus: 'enrolled', openNow: false }),
        adminShopRow(c, 3, { status: 'paused', busy: true }),
        adminShopRow(c, 4, { status: 'suspended', openNow: false }),
      ];
    default:
      return [adminShopRow(c, 1)];
  }
}

function adminShopsMocks(): Mock[] {
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/shops$/,
      schema: AdminShopList,
      reply: ({ c }): Reply =>
        c.state.shops === 'error'
          ? { status: 500, code: 'INTERNAL' }
          : { body: { items: shopRows(c), nextCursor: null } satisfies Dto<typeof AdminShopList> },
    },
    {
      method: 'GET',
      path: /^\/admin\/shops\/[^/]+$/,
      schema: AdminShopDetail,
      reply: ({ c }) => ({
        body: {
          ...adminShopRow(c, 1),
          legalName: 'Sharma Auto Parts Pvt Ltd',
          gstin: '22ABVCS4888H1ZL',
          phone: '+919876543210',
          email: 'shop@example.com',
          acceptanceTimeoutMin: 30,
          statusReason: null,
          statusReasonCode: null,
          statusChangedAt: null,
          pausedUntil: null,
          coverage: [
            { pincode: '492001', shippingPaise: 0, leadDays: 1, active: true },
            { pincode: '492006', shippingPaise: 4_900, leadDays: 2, active: true },
            { pincode: '492099', shippingPaise: 9_900, leadDays: 3, active: false },
          ],
          history: [],
          members: [{ userId: uuid(7), role: 'seller_owner', phoneLast4: '3210' }],
        } satisfies Dto<typeof AdminShopDetail>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/shops\/[^/]+\/inventory$/,
      schema: ShopOffers,
      reply: () => ({
        body: {
          offers: [
            {
              sku: 'SKU-1',
              product: 'Engine oil 1',
              productSlug: 'engine-oil-1',
              mrpPaise: 99_900,
              sellingPaise: 89_900,
              onHand: 12,
              reserved: 2,
              free: 10,
              leadDays: 1,
              active: true,
              version: 1,
            },
          ],
        } satisfies Dto<typeof ShopOffers>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/shops\/[^/]+\/warnings$/,
      schema: AdminPartnerWarnings,
      reply: ({ c }) => {
        const view = warningsView(c);
        return {
          body: { ...view, threshold: 3, suggestPause: c.state.warn === 'prompt' } satisfies Dto<
            typeof AdminPartnerWarnings
          >,
        };
      },
    },
  ];
}

// ── Admin: reroute queue ───────────────────────────────────────────────────────────────────────────────────────

function queueMocks(): Mock[] {
  const item = (n: number, gaveUp: boolean): Dto<typeof RoutingQueue>['items'][number] => ({
    code: `MD-RPR-2026-HND50${String(n)}-1`,
    status: 'needs_rerouting',
    pincode: '492001',
    placedAt: iso(-120),
    totalPaise: 289_900,
    items: 2,
    version: 3,
    attempts: gaveUp ? 2 : 1,
    gaveUpReason: gaveUp ? 'out_of_stock' : null,
    offer: null,
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/orders$/,
      schema: RoutingQueue,
      reply: ({ c, query }): Reply => {
        if (c.state.queue === 'error') return { status: 500, code: 'INTERNAL' };
        const q = c.state.queue ?? 'empty';
        const items =
          query.get('view') !== 'needs_routing' || q === 'empty'
            ? []
            : q === 'many'
              ? Array.from({ length: 6 }, (_, i) => item(i + 1, i % 2 === 0))
              : [item(1, q === 'reason-line' || q === 'both')];
        return { body: { items, nextCursor: null } satisfies Dto<typeof RoutingQueue> };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/orders\/[^/]+$/,
      schema: RoutingOrder,
      reply: ({ c }) => {
        const q = c.state.queue ?? 'empty';
        const tag = q === 'tag-on-suggestion' || q === 'both';
        const ranked = (n: number, gaveUpBefore: boolean) => ({
          shopId: uuid(n),
          name: long(c) ? LONG_EN : `Shop ${String(n)}`,
          distanceKm: 1.5 * n,
          stockedItems: 2,
          totalItems: 2,
          acceptanceRate: 0.9,
          rating: 4.5,
          pricePaise: 289_900,
          triedBefore: gaveUpBefore,
          gaveUpBefore,
          eligible: true,
          openNow: true,
          opensAt: null,
        });
        return {
          body: {
            code: 'MD-RPR-2026-HND501-1',
            status: 'needs_rerouting',
            version: 3,
            pincode: '492001',
            totalPaise: 289_900,
            items: [
              { sku: 'CAS-4T-900', title: 'Castrol Activ 4T 20W-40 900 ml', qty: 2, unitPaise: 144_950 },
            ],
            history: [
              {
                shop: 'Sharma Auto Parts',
                status: 'given_up',
                offeredAt: iso(-90),
                respondedAt: iso(-60),
                declineReason: null,
                giveUpReason: q === 'reason-line' || q === 'both' ? 'out_of_stock' : null,
              },
            ],
            shops: [ranked(2, tag), ranked(3, false)],
          } satisfies Dto<typeof RoutingOrder>,
        };
      },
    },
  ];
}

// ── Admin: errors ──────────────────────────────────────────────────────────────────────────────────────────────

function errorsMocks(): Mock[] {
  const issue = (n: number, c: AuditCase) => ({
    id: String(1000 + n),
    shortId: `MECHDOST-WEB-${String(n)}`,
    title:
      long(c) || c.state.errors === 'many-long'
        ? `TypeError: ${LONG_EN} is not a function`
        : `TypeError: x${String(n)} is undefined`,
    level: n % 2 === 0 ? ('error' as const) : ('warning' as const),
    count24h: n * 7,
    countTotal: n * 120,
    usersAffected: n,
    firstSeen: iso(-60 * 24 * 9),
    lastSeen: iso(-n * 11),
    link: 'https://sentry.io/organizations/audit/issues/1000/',
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/errors$/,
      schema: AdminErrors,
      reply: ({ c }): Reply => {
        const e = c.state.errors ?? 'none';
        if (e === 'error') return { status: 500, code: 'INTERNAL' };
        const n = e === 'many-long' ? 10 : e === 'issues' || e === 'one-down' ? 3 : 0;
        return {
          body: {
            connected: e !== 'not-connected',
            environment: e === 'not-connected' ? null : 'production',
            fetchedAt: e === 'not-connected' ? null : iso(-1),
            projects:
              e === 'not-connected'
                ? []
                : [
                    {
                      project: 'web',
                      ok: true,
                      issues: Array.from({ length: n }, (_, i) => issue(i + 1, c)),
                    },
                    {
                      project: 'api',
                      ok: e !== 'one-down',
                      issues: e === 'one-down' ? [] : Array.from({ length: n }, (_, i) => issue(i + 4, c)),
                    },
                  ],
          } satisfies Dto<typeof AdminErrors>,
        };
      },
    },
  ];
}

// ── Admin: analytics, coins, reviews, bulk quotes ─────────────────────────────────────────────────────────────

function analyticsMocks(): Mock[] {
  const day = (i: number) => new Date(NOW - (29 - i) * 86_400_000).toISOString().slice(0, 10);
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/overview$/,
      schema: AdminOverviewDto,
      reply: () => ({
        body: {
          ordersNeedRouting: 3,
          ordersAwaitingShop: 2,
          ordersInProgress: 9,
          servicesNeedRouting: 1,
          ticketsOpen: 4,
          reviewsPending: 5,
          applicationsPending: 2,
          priceRequestsPending: 1,
          ordersToday: 12,
          gmvTodayPaise: 4_589_900,
        } satisfies Dto<typeof AdminOverviewDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/analytics\/dashboard$/,
      schema: AnalyticsDashboardDto,
      reply: ({ c, query }): Reply => {
        const mode = c.state.analytics ?? 'full';
        if (mode === 'error') return { status: 503, code: 'QUERY_TIMEOUT' };
        const full = mode === 'full' || mode === 'long-text';
        const name = mode === 'long-text' ? LONG_EN : 'Castrol Activ 4T 20W-40 900 ml';
        const n = (v: number) => (full ? v : 0);
        return {
          body: {
            range: { from: query.get('from') ?? day(0), to: query.get('to') ?? day(29), days: 30 },
            city: null,
            cities: [{ code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' }],
            traffic:
              mode === 'city-scoped'
                ? null
                : {
                    visitors: n(5_400),
                    sessions: n(7_100),
                    productViews: n(21_000),
                    searches: n(1_900),
                    cartVisitors: n(640),
                    checkoutVisitors: n(310),
                  },
            kpis: {
              ordersPlaced: n(180),
              gmvPaise: n(52_890_000),
              aovPaise: full ? 293_833 : null,
              codOrders: n(70),
              onlineOrders: n(110),
              paymentsNotCompleted: n(14),
              cancelled: n(9),
              cancelReasons: full
                ? [
                    { code: 'changed_mind', count: 6 },
                    { code: 'wrong_item', count: 3 },
                  ]
                : [],
              rejected: n(4),
              rejectReasons: full ? [{ code: 'out_of_stock', count: 4 }] : [],
              customers: n(150),
              newCustomers: n(90),
              repeatCustomers: n(30),
              serviceRequests: n(44),
              bookingsConfirmed: n(31),
              bookingsCompleted: n(22),
              bookingsCancelled: n(5),
              offersAnswered: n(190),
              offersAccepted: n(171),
              medianSecondsToAccept: full ? 540 : null,
            },
            daily: Array.from({ length: 30 }, (_, i) => ({
              date: day(i),
              visitors: mode === 'city-scoped' ? null : n(150 + i * 3),
              orders: n(4 + (i % 7)),
              gmvPaise: n(1_200_000 + i * 20_000),
              bookings: n(i % 3),
            })),
            funnel: [
              { step: 'product_view', count: n(5_400) },
              { step: 'add_to_cart', count: n(640) },
              { step: 'checkout_started', count: n(310) },
              { step: 'order_placed', count: n(180) },
              { step: 'order_delivered', count: n(160) },
            ],
            topViewed:
              mode === 'city-scoped'
                ? null
                : full
                  ? [{ slug: 'castrol-activ-4t-20w40-900ml', name, nameHi: 'कैस्ट्रॉल एक्टिव', views: 920 }]
                  : [],
            topOrdered: full
              ? [{ slug: 'castrol-activ-4t-20w40-900ml', name, nameHi: null, orders: 61, units: 88 }]
              : [],
            topSearches:
              mode === 'city-scoped'
                ? null
                : full
                  ? [
                      { query: 'engine oil', count: 120, matches: true },
                      { query: 'ev charger 22kw', count: 9, matches: false },
                    ]
                  : [],
            areas: full
              ? [
                  {
                    pincode: '492001',
                    locality: 'Shankar Nagar',
                    localityHi: 'शंकर नगर',
                    orders: 40,
                    bookings: 9,
                  },
                ]
              : [],
            shops: full
              ? [
                  {
                    id: SHOP_ID,
                    name: long(c) ? LONG_EN : 'Sharma Auto Parts',
                    nameHi: null,
                    offers: 80,
                    accepted: 71,
                    declined: 5,
                    expired: 4,
                    medianSecondsToAccept: 420,
                  },
                ]
              : [],
            workshops: full
              ? [
                  {
                    id: uuid(5),
                    name: 'Telibandha Car Clinic',
                    nameHi: 'तेलीबांधा कार क्लिनिक',
                    requests: 30,
                    confirmed: 22,
                    completed: 18,
                    cancelled: 3,
                    medianMinutesToPropose: 25,
                  },
                ]
              : [],
          } satisfies Dto<typeof AnalyticsDashboardDto>,
        };
      },
    },
  ];
}

function coinsMocks(): Mock[] {
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/coins\/activity$/,
      schema: AdminCoinActivityDto,
      reply: ({ c }): Reply => {
        const mode = c.state.coins ?? 'few';
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const kinds = ['earn', 'redeem', 'adjust', 'expire', 'restore'] as const;
        const count = mode === 'none' ? 0 : mode === 'many' ? 20 : 3;
        return {
          body: {
            entries: Array.from({ length: count }, (_, i) => ({
              id: `coin-${String(i)}`,
              userId: uuid(300 + i),
              delta: i % 2 === 0 ? 50 + i : -(20 + i),
              kind: kinds[i % kinds.length] ?? 'earn',
              reasonCode: i % 3 === 0 ? 'order' : null,
              note: mode === 'long-text' ? LONG_EN : null,
              orderCode: i % 2 === 0 ? `MD-RPR-2026-HND60${String(i)}` : null,
              createdAt: iso(-i * 90),
              expiresAt: i % 2 === 0 ? iso(60 * 24 * 300) : null,
            })),
            nextCursor: mode === 'many' ? 'next' : null,
          } satisfies Dto<typeof AdminCoinActivityDto>,
        };
      },
    },
  ];
}

function reviewsMocks(): Mock[] {
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/reviews$/,
      schema: AdminReviewsDto,
      reply: ({ c, query }): Reply => {
        const mode = c.state.reviews ?? 'pending';
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const status = (query.get('status') ?? 'pending') as 'pending' | 'approved' | 'hidden';
        const count = mode === 'none' ? 0 : mode === 'many' ? 12 : 2;
        return {
          body: {
            reviews: Array.from({ length: count }, (_, i) => ({
              id: `rv-${String(i)}`,
              targetType: i % 2 === 0 ? ('product' as const) : ('workshop' as const),
              targetSlug: 'castrol-activ-4t-20w40-900ml',
              targetName: mode === 'long-text' ? LONG_EN : 'Castrol Activ 4T 20W-40 900 ml',
              rating: (i % 5) + 1,
              body: mode === 'long-text' ? `${LONG_HI} ${LONG_HI}` : 'Good oil, bike runs smoother',
              author: 'Ravi S.',
              status,
              hiddenReason: status === 'hidden' ? ('spam' as const) : null,
              note: null,
              orderCode: 'MD-RPR-2026-HND301',
              serviceCode: null,
              createdAt: iso(-i * 600),
              moderatedAt: status === 'pending' ? null : iso(-i * 300),
              version: 1,
            })),
            nextCursor: null,
          } satisfies Dto<typeof AdminReviewsDto>,
        };
      },
    },
  ];
}

/** Admin -> Content: the eight trust lines, published in both languages (long wording, hidden, or none yet). */
function contentMocks(): Mock[] {
  const KEYS = [
    'trust.homeGenuine',
    'trust.homeBill',
    'trust.homeEstimates',
    'trust.product',
    'trust.checkout',
    'trust.emailFooter',
    'trust.workshop',
    'trust.partner',
  ];
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/content$/,
      schema: AdminContentList,
      reply: ({ c }): Reply => {
        const mode = c.state.content ?? 'default';
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const value = (locale: 'en' | 'hi') =>
          mode === 'hidden'
            ? '-'
            : `${locale === 'hi' ? LONG_HI : LONG_EN} ${locale === 'hi' ? LONG_HI : LONG_EN}`.slice(0, 140);
        return {
          body: {
            entries:
              mode === 'default'
                ? []
                : KEYS.flatMap((key) =>
                    (['en', 'hi'] as const).map((locale) => ({
                      key,
                      locale,
                      draft: null,
                      published: { value: value(locale), version: 1, publishedAt: iso(-60) },
                    })),
                  ),
          } satisfies Dto<typeof AdminContentList>,
        };
      },
    },
  ];
}

function quotesMocks(): Mock[] {
  const statuses = [
    'open',
    'negotiating',
    'offered',
    'accepted',
    'declined',
    'expired',
    'withdrawn',
  ] as const;
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/quotes$/,
      schema: QuotePageDto,
      reply: ({ c }): Reply => {
        const mode = c.state.quotes ?? 'mixed';
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const count = mode === 'none' ? 0 : mode === 'one' ? 1 : 7;
        return {
          body: {
            items: Array.from({ length: count }, (_, i) => {
              const status = statuses[i % statuses.length] ?? 'open';
              return {
                code: `QT-RPR-2026-HND70${String(i)}`,
                status,
                cityCode: 'RPR',
                pincode: '492001',
                lines: 3,
                units: 120 + i,
                listTotalPaise: i === 2 ? null : 4_590_000,
                lastMessageAt: iso(-i * 40),
                lastMessageBy: i % 2 === 0 ? ('customer' as const) : ('staff' as const),
                offer:
                  status === 'offered'
                    ? { version: 1, totalPaise: 4_250_000, validUntil: iso(60 * 20), expired: false }
                    : null,
                orderCode: status === 'accepted' ? 'MD-RPR-2026-HND801' : null,
                createdAt: iso(-i * 300),
                version: 2,
              };
            }),
            nextCursor: null,
          } satisfies Dto<typeof QuotePageDto>,
        };
      },
    },
  ];
}

// ── Admin people screens (design 2026-11-15) ──────────────────────────────────────────────────────────────────

const ROLE_NAMES: Readonly<Record<string, string>> = {
  super_admin: 'Super admin',
  ops_manager: 'Operations manager',
  city_manager: 'City manager',
  support_agent: 'Support agent',
  finance: 'Finance',
  catalogue_manager: 'Catalogue manager',
  marketing: 'Marketing',
};
const CITY_ID = uuid(900);

function staffMocks(): Mock[] {
  const member = (
    n: number,
    role: string,
    c: AuditCase,
    extra: Partial<{ self: boolean; phone: boolean }> = {},
  ) => ({
    userId: uuid(100 + n),
    name: long(c) ? loc(c) : `Staff Member ${String(n)}`,
    phoneMasked: '••••••4410',
    emailMasked: 's•••@example.com',
    status: 'active',
    lastSignInAt: extra.phone ? null : iso(-n * 90),
    twoFactor: extra.phone ? ('phone_missing' as const) : ('ready' as const),
    isSelf: extra.self === true,
    grants: [
      {
        grantId: uuid(200 + n),
        role,
        roleName: ROLE_NAMES[role] ?? role,
        cityId: role === 'city_manager' ? CITY_ID : null,
        grantedAt: iso(-60 * 24 * n),
      },
    ],
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/staff$/,
      schema: StaffListDto,
      reply: ({ c }): Reply => {
        const s = c.state.staff ?? 'several';
        if (s === 'error') return { status: 500, code: 'INTERNAL' };
        const staff =
          s === 'empty'
            ? []
            : s === 'self-only'
              ? [member(1, 'super_admin', c, { self: true })]
              : s === 'phone-missing'
                ? [member(1, 'super_admin', c, { self: true }), member(2, 'marketing', c, { phone: true })]
                : [
                    member(1, 'super_admin', c, { self: true }),
                    member(2, 'city_manager', c),
                    member(3, 'support_agent', c),
                    member(4, 'finance', c),
                  ];
        return {
          body: {
            staff,
            truncated: false,
            roles: Object.entries(ROLE_NAMES).map(([key, name]) => ({
              key,
              name,
              scope: key === 'city_manager' ? ('city' as const) : ('global' as const),
              superAdminOnly: key === 'super_admin' || key === 'finance',
            })),
            cities: [{ id: CITY_ID, code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' }],
          } satisfies Dto<typeof StaffListDto>,
        };
      },
    },
    {
      method: 'POST',
      path: /^\/admin\/staff\/grants$/,
      reply: (): Reply => ({ status: 422, code: 'ROLE_SCOPE' }),
    },
  ];
}

function customerMocks(): Mock[] {
  const id = uuid(300);
  const result = (n: number, c: AuditCase) => ({
    id: uuid(300 + n),
    name: long(c) ? loc(c) : `Asha Verma ${String(n)}`,
    phoneMasked: '••••••4410',
    emailMasked: 'a•••@example.com',
    status: 'active',
    createdAt: iso(-60 * 24 * 30),
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/customers\/search$/,
      schema: CustomerSearchDto,
      reply: ({ c }): Reply => {
        const s = c.state.customers ?? 'results';
        if (s === 'error') return { status: 422, code: 'SEARCH_QUERY' };
        return {
          body: {
            kind: 'name' as const,
            results: s === 'none' ? [] : [result(0, c), result(1, c), result(2, c)],
          } satisfies Dto<typeof CustomerSearchDto>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/customers\/[0-9a-f-]{36}$/,
      schema: CustomerViewDto,
      reply: ({ c }): Reply => {
        const s = c.state.customers ?? 'masked';
        const hidden = s === 'sections-hidden';
        const unmasked = s === 'unmasked';
        return {
          body: {
            profile: {
              id,
              name: long(c) ? loc(c) : 'Asha Verma',
              phone: unmasked ? '+919844444410' : '••••••4410',
              email: unmasked ? 'asha@example.com' : 'a•••@example.com',
              masked: !unmasked,
              phoneVerified: true,
              emailVerified: false,
              status: 'active',
              language: c.locale,
              createdAt: iso(-60 * 24 * 90),
            },
            orders: hidden
              ? null
              : [
                  {
                    code: 'MD-RPR-2026-7K3Q9X-1',
                    status: 'delivered',
                    totalPaise: 124_500,
                    at: iso(-60 * 24 * 3),
                  },
                ],
            serviceRequests: hidden ? null : [],
            tickets: hidden ? null : [{ code: 'REQ-RPR-2026-000A01', status: 'open', at: iso(-60 * 5) }],
            refunds: hidden
              ? null
              : [{ id: uuid(301), amountPaise: 50_000, status: 'processed', at: iso(-60 * 24) }],
            coins: hidden ? null : { balance: 40, lifetimeEarned: 90 },
            consents: [
              { purpose: 'marketing', granted: false, at: iso(-60 * 24) },
              { purpose: 'analytics', granted: true, at: iso(-60 * 48) },
            ],
          } satisfies Dto<typeof CustomerViewDto>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/customers\/[0-9a-f-]{36}\/blocks$/,
      schema: CustomerBlockList,
      reply: (): Reply => ({ body: { blocks: [] } satisfies Dto<typeof CustomerBlockList> }),
    },
  ];
}

function auditMocks(): Mock[] {
  const row = (n: number, c: AuditCase) => ({
    id: 1000 - n,
    at: iso(-n * 17),
    actorUserId: n % 3 === 0 ? null : uuid(100 + (n % 3)),
    actorName: n % 3 === 0 ? null : long(c) ? loc(c) : `Staff Member ${String(n % 3)}`,
    actorRole: n % 3 === 0 ? 'system' : 'staff',
    action: n % 2 === 0 ? 'role.granted' : 'setting.changed',
    entity: n % 2 === 0 ? 'user_role' : 'setting',
    entityId: n % 2 === 0 ? uuid(200 + n) : 'delivery.free_over_paise',
    reason: n % 2 === 0 ? (long(c) ? loc(c) : 'Joins the support desk') : null,
    before: n % 2 === 0 ? null : { value: 49_900, phone: '••••••4410' },
    after: n % 2 === 0 ? { role: 'support_agent', cityId: null } : { value: 59_900 },
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/audit$/,
      schema: AuditPageDto,
      reply: ({ c }): Reply => {
        const s = c.state.audit ?? 'rows';
        if (s === 'error') return { status: 422, code: 'AUDIT_FILTER' };
        return {
          body: {
            rows: s === 'empty' ? [] : Array.from({ length: 6 }, (_, i) => row(i + 1, c)),
            nextCursor: s === 'more' ? 'MTAwMA' : null,
          } satisfies Dto<typeof AuditPageDto>,
        };
      },
    },
  ];
}

// ── Registry ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The mocks of one audit case: its screen's endpoints, plus `/me`. Unmocked calls fail the case. */
export function mocksFor(c: AuditCase): Mock[] {
  switch (c.code) {
    case 'API-ADM-REFUNDQ':
      return [meMock(), ...refundMocks()];
    case 'API-ORD-REFUNDLINE':
      return [meMock(), orderRefundMock()];
    case 'API-SHOP-PORTAL':
      return shopPortalMocks();
    case 'API-ADM-SHOPS':
      return adminShopsMocks();
    case 'API-ADM-QUEUE':
      return queueMocks();
    case 'API-ADM-ERRORS':
      return errorsMocks();
    case 'API-ADM-ANALYTICS':
      return analyticsMocks();
    case 'API-ADM-COINS':
      return coinsMocks();
    case 'API-ADM-REVIEWS':
      return reviewsMocks();
    case 'API-ADM-QUOTES':
      return quotesMocks();
    case 'API-ADM-CONTENT':
      return contentMocks();
    case 'API-SVC-HOMEFIND':
      return homeFinderMocks(c);
    case 'API-SVC-HOMEREQ':
      return homeRequestMocks(c);
    case 'API-WS-HOMEJOB':
      return homeJobMocks(c);
    case 'API-ADM-STAFF':
      return staffMocks();
    case 'API-ADM-CUSTOMERS':
      return customerMocks();
    case 'API-ADM-AUDIT':
      return auditMocks();
    default:
      // Navigation rows: the bar is under test; the screen behind it answers "not mocked" (see `mock-api.ts`).
      return [meMock()];
  }
}

export type { MockCtx };
