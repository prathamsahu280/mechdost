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
import { EXPORT_DATASETS, ExportOptionsDto, ExportTicketDto } from '@mechdost/shared/exports';
import { AdminOverviewDto, AnalyticsDashboardDto } from '@mechdost/shared/admin-analytics-api';
import { AdminCoinActivityDto } from '@mechdost/shared/coins-api';
import { QuoteDetailDto, QuotePageDto, QuoteReadDto } from '@mechdost/shared/quote-api';
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
import { ShopTeam } from '@mechdost/shared/shop-team';
import {
  AdminCouponListDto,
  CouponCategoryListDto,
  CouponUsageReportDto,
  ShopOffersDto,
} from '@mechdost/shared/coupon-api';
import type { AuditCase } from '../cases.ts';
import { layoutMocks, policyMocks, settingsMocks } from './admin-config-fixtures.ts';
import { homeFinderMocks, homeJobMocks, homeRequestMocks } from './home-fixtures.ts';
import { adminWorkshopAnalyticsMocks, workshopPerformanceMocks } from './workshop-analytics-fixtures.ts';
import { customerPhotoMocks, workshopPhotoMocks } from './photo-fixtures.ts';
import { accountDeletionMocks, accountSupportMocks, adminSupportMocks } from './support-fixtures.ts';
import { myWorkshopMocks, profileMocks } from './tier1-fixtures.ts';
import { adminRoutingMocks, billPayMocks } from './tier3-fixtures.ts';
import { slipMocks, staffPortalMocks, tier2PortalMocks } from './tier2-fixtures.ts';
import { adminRecoMocks, demandMocks, notifyMeMocks, privacyMocks } from './catalogue-tier2-fixtures.ts';
import { photoQueueMocks, wishlistMocks } from './storefront-fixtures.ts';
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
    settleReasonCode: null,
    creditNote: null,
    overdue: false,
    canApprove: true,
    canSettle: false,
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
        canSettle: true,
      });
    case 'needs-reconciliation-own':
      return refundBase({
        status: 'needs_reconciliation',
        requestedBy: 'me',
        approvedBy: 'staff-3',
        canApprove: false,
        canSettle: false,
      });
    case 'settled-by-hand':
      return refundBase({
        status: 'processed',
        approvedBy: 'staff-3',
        decidedAt: iso(-300),
        processedAt: iso(-20),
        providerRefundId: 'rfnd_audit000003',
        settleReasonCode: 'dashboard_checked',
        canApprove: false,
      });
    case 'processed-credit-note':
      return refundBase({
        status: 'processed',
        approvedBy: 'staff-3',
        decidedAt: iso(-300),
        processedAt: iso(-20),
        providerRefundId: 'rfnd_audit000004',
        creditNote: { number: 'CN/2627/000012', totalPaise: 489_900, issuedAt: iso(-20) },
        canApprove: false,
      });
    case 'after-close':
      return refundBase({
        source: 'payment_after_close',
        reasonCode: 'payment_after_close',
        requestedBy: null,
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
    {
      method: 'POST',
      path: /^\/admin\/refunds\/[^/]+\/settle$/,
      schema: AdminRefundDto,
      reply: () => ({
        body: refundVariant('settled-by-hand'),
      }),
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
    name: long(c) ? loc(c) : 'Sharma Auto Parts',
    nameHi: long(c) ? LONG_HI : 'शर्मा ऑटो पार्ट्स',
    addressLine: long(c) ? loc(c) : 'Shop 4, Telibandha Main Road',
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
    busy: c.state.busy === 'closed' || c.state.busy === 'hours',
    busyUntil:
      c.state.busy === 'closed'
        ? new Date(Date.now() + 8 * 3_600_000).toISOString()
        : c.state.busy === 'hours'
          ? new Date(Date.now() + 2 * 3_600_000).toISOString()
          : null,
    coverage: { pincodes: 21, minShippingPaise: 0, maxShippingPaise: 9_900 },
    freeDeliveryMinPaise: 99_900,
    hours: { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] },
    openNow: shop !== 'closed-hours',
    version: 4,
    offersOnSale: 38,
    offers30d: { accepted: 41, answered: 48 },
    isOwner: c.state.role !== 'staff',
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
      {
        title: 'Spark plug iridium',
        titleHi: 'स्पार्क प्लग इरिडियम',
        sku: 'SPK-IR',
        qty: 1,
        unitPaise: 38_000,
      },
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
      ? [
          shopOrder(c, 1, {
            status: 'awaiting_shop',
            // The page compares with the browser's clock, so the end time is relative to it.
            expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(),
            address: null,
          }),
        ]
      : kind === 'expired-offer'
        ? [
            shopOrder(c, 1, {
              status: 'awaiting_shop',
              expiresAt: new Date(Date.now() - 60_000).toISOString(),
              address: null,
            }),
          ]
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
  if (kind === 'locked-delivery')
    return [shopOrder(c, 2, { status: 'out_for_delivery', deliveryLocked: true })];
  // Staff never see what the shop is paid (spec 13).
  if (kind === 'staff-view')
    return [
      shopOrder(c, 2, {
        status: 'packed',
        payoutPaise: null,
        items: [
          {
            title: 'Castrol Activ 4T 20W-40 900 ml',
            titleHi: null,
            sku: 'CAS-4T-900',
            qty: 2,
            unitPaise: null,
          },
        ],
      }),
    ];
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

function shopPortalMocks(c0: AuditCase): Mock[] {
  const offer = (n: number) => ({
    sku: `SKU-${String(n)}`,
    product: c0.locale === 'hi' ? `इंजन ऑयल ${String(n)}` : `Engine oil ${String(n)}`,
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
      path: /^\/shop\/team\/[^/]+$/,
      schema: ShopTeam,
      reply: ({ c }): Reply => {
        const kind = c.state.team ?? 'only-you';
        if (kind === 'error') return { status: 500, code: 'INTERNAL' };
        const member = (n: number, name: string | null) => ({
          userId: uuid(300 + n),
          role: 'staff' as const,
          name,
          phoneLast4: String(1000 + n),
          isYou: false,
        });
        const members = [
          { userId: uuid(300), role: 'owner' as const, name: 'Audit User', phoneLast4: '3210', isYou: true },
          ...(kind === 'only-you'
            ? []
            : kind === 'full'
              ? Array.from({ length: 9 }, (_, i) =>
                  member(i + 1, long(c) ? loc(c) : `Helper ${String(i + 1)}`),
                )
              : [member(1, long(c) ? loc(c) : 'Mohan Lal'), member(2, null)]),
        ];
        const invites =
          kind === 'invite-open'
            ? [
                {
                  id: uuid(400),
                  name: long(c) ? loc(c) : 'Sita Devi',
                  phoneLast4: '2299',
                  expiresAt: iso(60 * 24 * 5),
                },
              ]
            : [];
        return { body: { members, invites, max: 10 } satisfies Dto<typeof ShopTeam> };
      },
    },
    {
      method: 'GET',
      path: /^\/shop\/offers\/[^/]+$/,
      schema: ShopOffersDto,
      reply: ({ c }): Reply => {
        const kind = c.state.offers ?? 'none';
        if (kind === 'error') return { status: 500, code: 'INTERNAL' };
        const status = kind === 'accepted' ? 'accepted' : kind === 'declined' ? 'declined' : 'pending';
        const count = kind === 'none' ? 0 : kind === 'many' ? 6 : 1;
        return {
          body: {
            offers: Array.from({ length: count }, (_, i) => ({
              couponId: uuid(700 + i),
              code: `SHOP${String(10 + i)}OFF`,
              title: long(c) ? loc(c) : 'Ten percent off engine oil',
              titleHi: long(c) ? loc(c) : 'इंजन ऑयल पर दस प्रतिशत छूट',
              terms: long(c) ? loc(c) : 'Valid on your products only.',
              termsHi: long(c) ? loc(c) : 'केवल आपके उत्पादों पर मान्य।',
              kind: i % 2 === 0 ? ('percent' as const) : ('flat' as const),
              value: i % 2 === 0 ? 10 : 5_000,
              minSubtotalPaise: 50_000,
              maxDiscountPaise: i % 2 === 0 ? 20_000 : null,
              startsAt: iso(-60 * 24),
              endsAt: iso(60 * 24 * 20),
              usageLimitTotal: 200,
              usageLimitPerUser: 1,
              usedCount: i * 3,
              firstOrderOnly: i === 1,
              status: i === 0 ? status : ('pending' as const),
              version: 1,
              decidedAt: status === 'pending' || i > 0 ? null : iso(-30),
            })),
          } satisfies Dto<typeof ShopOffersDto>,
        };
      },
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
    name: long(c) ? loc(c) : `Sharma Auto Parts ${String(n)}`,
    nameHi: long(c) ? LONG_HI : `शर्मा ऑटो पार्ट्स ${String(n)}`,
    addressLine: long(c) ? loc(c) : 'Shop 4, Telibandha Main Road',
    addressLineHi: long(c) ? LONG_HI : 'दुकान 4, तेलीबांधा मेन रोड',
    pincode: '492006',
    status: 'approved',
    gstStatus: 'registered',
    busy: false,
    busyUntil: null,
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
        adminShopRow(c, 3, { status: 'paused', busy: true, busyUntil: iso(60 * 6) }),
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
          name: long(c) ? loc(c) : c.locale === 'hi' ? `दुकान ${String(n)}` : `Shop ${String(n)}`,
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
                shop: c.locale === 'hi' ? 'शर्मा ऑटो पार्ट्स' : 'Sharma Auto Parts',
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
          refundsWaiting: 3,
          refundsNeedChecking: 1,
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
        const name = mode === 'long-text' ? loc(c) : 'Castrol Activ 4T 20W-40 900 ml';
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
                    name: long(c) ? loc(c) : 'Sharma Auto Parts',
                    nameHi: 'शर्मा ऑटो पार्ट्स',
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
                    expired: 1,
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
              note: mode === 'long-text' ? loc(c) : null,
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

function couponsMocks(c0: AuditCase): Mock[] {
  const coupon = (c: AuditCase, i: number, over: Record<string, unknown> = {}) => ({
    id: uuid(800 + i),
    code: `AUDIT${String(10 + i)}`,
    title: long(c) ? loc(c) : 'Festival offer',
    titleHi: long(c) ? loc(c) : 'त्योहार ऑफ़र',
    terms: i % 2 === 0 ? (long(c) ? loc(c) : 'Valid on products only.') : null,
    termsHi: i % 2 === 0 ? (long(c) ? loc(c) : 'केवल उत्पादों पर मान्य।') : null,
    kind: (['percent', 'flat', 'free_shipping'] as const)[i % 3] ?? ('percent' as const),
    value: i % 3 === 0 ? 10 : i % 3 === 1 ? 5_000 : 0,
    minSubtotalPaise: i % 2 === 0 ? 50_000 : 0,
    maxDiscountPaise: i % 3 === 0 ? 20_000 : null,
    startsAt: iso(-60 * 24 * 3),
    endsAt: i % 2 === 0 ? iso(60 * 24 * 20) : null,
    startsAtIst: '2026-11-12T10:00',
    endsAtIst: i % 2 === 0 ? '2026-12-05T10:00' : null,
    usageLimitTotal: i % 2 === 0 ? 200 : null,
    usageLimitPerUser: 1,
    usedCount: i * 4,
    firstOrderOnly: i === 2,
    cityCode: i % 2 === 0 ? 'RPR' : null,
    funder: 'mechdost' as const,
    shop: null,
    shopTerms: null,
    // 2026-11-16: shown on the offers page, applied without a code, limited to a category.
    isPublic: i % 2 === 0,
    autoApply: i === 1,
    category: i === 2 ? { slug: 'tyres', name: 'Tyres', nameHi: 'टायर' } : null,
    active: true,
    pausedReason: null,
    live: true,
    version: 1,
    ...over,
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/catalogue\/categories$/,
      schema: CouponCategoryListDto,
      reply: (): Reply => ({
        body: {
          categories: [
            { slug: 'tyres', parentSlug: null, name: 'Tyres' },
            { slug: 'batteries', parentSlug: null, name: 'Batteries' },
          ],
        } satisfies Dto<typeof CouponCategoryListDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/coupons\/[0-9a-f-]{36}\/usage$/,
      schema: CouponUsageReportDto,
      reply: ({ c }): Reply => {
        const empty = c.state.usage === 'empty';
        return {
          body: {
            couponId: uuid(800),
            code: 'AUDIT10',
            totals: empty
              ? { orders: 0, released: 0, uses: 0, discountPaise: 0, uniqueCustomers: 0 }
              : { orders: 14, released: 2, uses: 12, discountPaise: 84_000, uniqueCustomers: 9 },
            days: empty
              ? []
              : [
                  { day: '2026-11-15', orders: 6, released: 1, discountPaise: 36_000, uniqueCustomers: 4 },
                  { day: '2026-11-14', orders: 8, released: 1, discountPaise: 48_000, uniqueCustomers: 6 },
                ],
            nextCursor: null,
          } satisfies Dto<typeof CouponUsageReportDto>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/coupons$/,
      schema: AdminCouponListDto,
      reply: ({ c }): Reply => {
        const mode = c.state.coupons ?? 'few';
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const count = mode === 'none' ? 0 : mode === 'many' ? 20 : 4;
        return {
          body: {
            coupons: Array.from({ length: count }, (_, i) =>
              coupon(
                c,
                i,
                mode === 'paused' && i === 0
                  ? { active: false, pausedReason: 'Budget used up', live: false }
                  : mode === 'waiting-shop' && i === 0
                    ? {
                        funder: 'shop' as const,
                        kind: 'flat' as const,
                        value: 5_000,
                        maxDiscountPaise: null,
                        shop: { id: uuid(900), name: 'Sharma Auto Parts', nameHi: 'शर्मा ऑटो पार्ट्स' },
                        shopTerms: 'pending' as const,
                        live: false,
                      }
                    : {},
              ),
            ),
            nextCursor: mode === 'many' ? 'next' : null,
          } satisfies Dto<typeof AdminCouponListDto>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/shops$/,
      schema: AdminShopList,
      reply: () => ({
        body: { items: [adminShopRow(c0, 1)], nextCursor: null } satisfies Dto<typeof AdminShopList>,
      }),
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
              targetName: mode === 'long-text' ? loc(c) : 'Castrol Activ 4T 20W-40 900 ml',
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
                orderPayment: status === 'accepted' ? { method: 'cod', status: 'cod_pending' } : null,
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

/**
 * The customer's quote thread (spec 19, 2026-11-16): an offer with the payment choice, an accepted quote whose online
 * order is unpaid ("Pay now") or paid, and a thread with photos and "Seen" marks. One tiny PNG answers the photo URLs.
 */
const QUOTE_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function quoteThreadMocks(): Mock[] {
  const photo = (n: number) => ({
    id: uuid(700 + n),
    width: 800,
    height: 600,
    thumbUrl: `/quote-photos/${uuid(700 + n)}/thumb?e=9999999999&s=audit`,
    largeUrl: `/quote-photos/${uuid(700 + n)}/large?e=9999999999&s=audit`,
  });
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/quote-photos\//,
      reply: (): Reply => ({ raw: { contentType: 'image/png', base64: QUOTE_PIXEL } }),
    },
    {
      method: 'POST',
      path: /^\/quotes\/[^/]+\/read$/,
      schema: QuoteReadDto,
      reply: (): Reply => ({ body: { readThrough: null } satisfies Dto<typeof QuoteReadDto> }),
    },
    {
      method: 'GET',
      path: /^\/quotes\/[^/]+$/,
      schema: QuoteDetailDto,
      reply: ({ c }): Reply => {
        const mode = c.state.thread ?? 'offered';
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const accepted = mode === 'accepted_unpaid' || mode === 'accepted_paid';
        const photos = mode === 'photos_seen';
        return {
          body: {
            code: 'QT-RPR-2026-HND901',
            status: accepted ? 'accepted' : 'offered',
            cityCode: 'RPR',
            pincode: '492001',
            lines: 1,
            units: 120,
            listTotalPaise: 4_590_000,
            lastMessageAt: iso(-30),
            lastMessageBy: 'staff',
            offer: { version: 1, totalPaise: 4_250_000, validUntil: iso(60 * 20), expired: false },
            orderCode: accepted ? 'MD-RPR-2026-HND901' : null,
            orderPayment: accepted
              ? { method: 'online', status: mode === 'accepted_paid' ? 'paid' : 'created' }
              : null,
            createdAt: iso(-600),
            version: 3,
            lineItems: [
              {
                lineNo: 1,
                slug: 'audit-product-1',
                sku: 'AUD-0001',
                title: 'Audit engine oil 1 L',
                qty: 120,
                listUnitPaise: 38_250,
                mrpPaise: 42_000,
                costPaise: null,
                stock: null,
              },
            ],
            currentOffer: {
              version: 1,
              status: accepted ? 'accepted' : 'active',
              lines: [{ lineNo: 1, unitPaise: 35_000 }],
              subtotalPaise: 4_200_000,
              deliveryPaise: 50_000,
              totalPaise: 4_250_000,
              validUntil: iso(60 * 20),
              expired: false,
              terms: null,
              createdAt: iso(-60),
            },
            messages: [
              {
                id: uuid(600),
                from: 'customer',
                body: 'Need 120 for the workshop, delivery by Friday.',
                at: iso(-600),
                attachments: photos ? [photo(1), photo(2)] : [],
                seen: photos,
              },
              {
                id: uuid(601),
                from: 'staff',
                body: 'We can do ₹350 each with free delivery above ₹40,000.',
                at: iso(-30),
                attachments: photos ? [photo(3)] : [],
                seen: false,
              },
            ],
            address: {
              contactName: 'Audit User',
              contactPhone: '+919876543210',
              line1: 'House 12, Pandri',
              landmark: null,
              pincode: '492001',
            },
            reasonCode: null,
            closingMessage: null,
          } satisfies Dto<typeof QuoteDetailDto>,
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

/** Admin → Exports: the options, the request (done, empty, too large) and the file itself (or an expired link). */
function exportsMocks(): Mock[] {
  const csv = Buffer.from(
    String.fromCharCode(0xfeff) + 'code,placed_at_ist\r\nMD-RPR-2026-ABCDEF,2026-11-15 10:00:00\r\n',
  ).toString('base64');
  return [
    meMock(),
    {
      method: 'GET',
      path: /^\/admin\/exports\/options$/,
      schema: ExportOptionsDto,
      reply: ({ c }): Reply => {
        const s = c.state.exports ?? 'form';
        if (s === 'load-error') return { status: 403, code: 'FORBIDDEN' };
        return {
          body: {
            datasets: s === 'none' ? [] : [...EXPORT_DATASETS],
            cities: [
              { code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' },
              { code: 'BPL', name: 'Bilaspur', nameHi: 'बिलासपुर' },
            ],
            contactsMasked: s !== 'customers-open',
          } satisfies Dto<typeof ExportOptionsDto>,
        };
      },
    },
    {
      method: 'POST',
      path: /^\/admin\/exports$/,
      schema: ExportTicketDto,
      reply: ({ c }): Reply => {
        const s = c.state.exports ?? 'form';
        if (s === 'error-large') return { status: 422, code: 'EXPORT_TOO_LARGE' };
        return {
          body: {
            downloadPath: '/admin/exports/download?t=audit-token-audit-token',
            expiresAt: iso(10),
            fileName: 'mechdost-orders-2026-10-17_to_2026-11-15.csv',
            rowCount: s === 'done-empty' ? 0 : 1,
            masked: false,
          } satisfies Dto<typeof ExportTicketDto>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/exports\/download$/,
      reply: ({ c }): Reply =>
        c.state.exports === 'error-link'
          ? { status: 403, code: 'EXPORT_LINK_EXPIRED' }
          : { raw: { contentType: 'text/csv; charset=utf-8', base64: csv } },
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
    case 'API-SHOP-TIER1':
    case 'API-SHOP-OFFERS':
    case 'API-SHOP-TIER2':
      // The portal also loads its performance card and CSV tool: the tier 2 mocks sit under every portal row.
      return [...shopPortalMocks(c), ...tier2PortalMocks()];
    case 'API-SHOP-STAFF':
      return [...shopPortalMocks(c), ...tier2PortalMocks(), ...staffPortalMocks()];
    case 'API-SHOP-SLIP':
      return [meMock(), ...slipMocks()];
    case 'API-ADM-SHOPS':
      return adminShopsMocks();
    case 'API-ADM-QUEUE':
      return queueMocks();
    case 'API-ADM-ERRORS':
      return errorsMocks();
    case 'API-ADM-ANALYTICS':
      return analyticsMocks();
    case 'API-ADM-WORKSHOPS':
      return [...analyticsMocks(), ...adminWorkshopAnalyticsMocks(c)];
    case 'API-WS-PERFORMANCE':
      return [...workshopPerformanceMocks(c), ...profileMocks(c)];
    case 'API-ADM-COINS':
      return coinsMocks();
    case 'API-WISHLIST':
      return [meMock(), ...wishlistMocks(c)];
    case 'API-ADM-PHOTOS':
      // The catalogue page also shows the recommendation rules under the queue.
      return [meMock(), ...photoQueueMocks(c), ...adminRecoMocks(c)];
    case 'API-ADM-COUPONS':
      return couponsMocks(c);
    case 'API-ADM-REVIEWS':
      return reviewsMocks();
    case 'API-QUOTE-THREAD':
      return quoteThreadMocks();
    case 'API-ADM-QUOTES':
      return quotesMocks();
    case 'API-ADM-CONTENT':
      // The trust lines plus the policy editor under them (no policy published: it lists none and no history).
      return [...contentMocks(), ...policyMocks({ ...c, state: { ...c.state, policies: 'none' } }).slice(1)];
    case 'API-ADM-POLICIES':
      return [meMock(), ...policyMocks(c)];
    case 'API-ADM-LAYOUT':
      return [meMock(), ...layoutMocks(c)];
    case 'API-ADM-COMPANY':
      // The PIN waiting list sits under Service area on the same screen (design 2026-11-15 item 7).
      return [meMock(), ...settingsMocks(c), ...demandMocks(c)];
    case 'API-ADM-DEMAND':
      return [meMock(), ...settingsMocks(c), ...demandMocks(c)];
    case 'API-ACC-PRIVACY':
      return privacyMocks(c);
    case 'API-ACC-NOTIFYME':
      return notifyMeMocks(c);
    case 'API-ADM-RECO':
      return adminRecoMocks(c);
    case 'API-SVC-HOMEFIND':
      return homeFinderMocks(c);
    case 'API-SVC-HOMEREQ':
      return homeRequestMocks(c);
    case 'API-WS-HOMEJOB':
      return [...homeJobMocks(c), ...profileMocks(c)];
    case 'API-ADM-STAFF':
      return staffMocks();
    case 'API-ADM-CUSTOMERS':
      return customerMocks();
    case 'API-ADM-AUDIT':
      return auditMocks();
    case 'API-ADM-EXPORTS':
      return exportsMocks();
    case 'API-WS-PHOTOS':
      return [...workshopPhotoMocks(c), ...profileMocks(c)];
    case 'API-WS-MYWORKSHOP':
      return myWorkshopMocks(c);
    case 'API-SVC-RESCHEDULE':
      return homeRequestMocks(c);
    case 'API-SVC-PAYBILL':
      // The request page also lists the request's photos (the bill's own detail mock stays first).
      return [...billPayMocks(c), ...customerPhotoMocks(c).filter((m) => String(m.path).includes('photos'))];
    case 'API-ADM-SVCROUTE':
      return adminRoutingMocks(c);
    case 'API-SVC-PHOTOS':
      return customerPhotoMocks(c);
    case 'API-ACC-SUPPORT':
      return accountSupportMocks(c);
    case 'API-ADM-SUPPORT':
    case 'API-ADM-SUPPORT-TOOLS':
      return adminSupportMocks(c);
    case 'API-ACC-DELETION':
      return accountDeletionMocks(c);
    case 'API-GUEST-SUPPORT':
      return [];
    default:
      // Navigation rows: the bar is under test; the screen behind it answers "not mocked" (see `mock-api.ts`).
      return [meMock()];
  }
}

export type { MockCtx };
