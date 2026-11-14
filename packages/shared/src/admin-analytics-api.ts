/**
 * Response shapes of the admin analytics routes (`apps/api/src/routes/admin-analytics.ts`, spec 08 "Analytics"), for
 * the website in real sign-in mode to validate what it receives (hard rule 4). Loaded only by the lazy admin screens.
 * Every number is an integer: counts, or money in paise. No personal data: ids, codes, product/shop/workshop names
 * (both languages) and aggregated, scrubbed search phrases searched by at least two visitors.
 */
import { z } from 'zod';

const Count = z.number().int().min(0);
const Paise = z.number().int().min(0);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Named = { name: z.string(), nameHi: z.string().nullable() };

export const ANALYTICS_FUNNEL_STEPS = [
  'product_view',
  'add_to_cart',
  'checkout_started',
  'order_placed',
  'order_delivered',
] as const;
export type AnalyticsFunnelStep = (typeof ANALYTICS_FUNNEL_STEPS)[number];

const ReasonCount = z.object({ code: z.string(), count: Count });

/**
 * Site traffic from the first-party event store. Web events carry no city yet, so traffic is site-wide and returned
 * only to staff whose analytics grant covers every city; it is null for city-scoped staff.
 */
export const AnalyticsTrafficDto = z.object({
  visitors: Count,
  sessions: Count,
  productViews: Count,
  searches: Count,
  /** Visitors who added something to the cart / started checkout (distinct visitor ids). */
  cartVisitors: Count,
  checkoutVisitors: Count,
});

export const AnalyticsKpisDto = z.object({
  /** Checkouts that became orders: cash on delivery, or online and paid. */
  ordersPlaced: Count,
  /** Value of order parts not cancelled or rejected (paise). */
  gmvPaise: Paise,
  /** GMV ÷ orders with at least one part still live; null without such orders. */
  aovPaise: Paise.nullable(),
  codOrders: Count,
  onlineOrders: Count,
  /** Online checkouts whose payment never completed (not orders). */
  paymentsNotCompleted: Count,
  /** Order parts (one per shop) cancelled or rejected, with their reason codes, most frequent first. */
  cancelled: Count,
  cancelReasons: z.array(ReasonCount),
  rejected: Count,
  rejectReasons: z.array(ReasonCount),
  customers: Count,
  /** Customers whose first order ever is in the range. */
  newCustomers: Count,
  /** Customers in the range with more than one order up to its end. */
  repeatCustomers: Count,
  serviceRequests: Count,
  /** Service requests that reached "confirmed" or later / were paid or completed / were cancelled or rejected. */
  bookingsConfirmed: Count,
  bookingsCompleted: Count,
  bookingsCancelled: Count,
  /** Shop offers answered (accepted, declined or timed out) and accepted; median seconds to accept. */
  offersAnswered: Count,
  offersAccepted: Count,
  medianSecondsToAccept: Count.nullable(),
});

export const AnalyticsDayDto = z.object({
  date: Day,
  /** Null when traffic is not available to this staff member. */
  visitors: Count.nullable(),
  orders: Count,
  gmvPaise: Paise,
  bookings: Count,
});

export const AnalyticsDashboardDto = z.object({
  range: z.object({ from: Day, to: Day, days: z.number().int().min(1) }),
  /** The city filter (code) or null for every city in the staff member's scope. */
  city: z.string().nullable(),
  cities: z.array(z.object({ code: z.string(), ...Named })),
  traffic: AnalyticsTrafficDto.nullable(),
  kpis: AnalyticsKpisDto,
  daily: z.array(AnalyticsDayDto),
  /** Steps in order; the first three are distinct visitors (traffic), the last two orders. */
  funnel: z.array(z.object({ step: z.enum(ANALYTICS_FUNNEL_STEPS), count: Count })),
  topViewed: z.array(z.object({ slug: z.string(), ...Named, views: Count })).nullable(),
  topOrdered: z.array(z.object({ slug: z.string(), ...Named, orders: Count, units: Count })),
  /** `matches` = the live catalogue has a product for the phrase now (false = a gap to fill). */
  topSearches: z.array(z.object({ query: z.string(), count: Count, matches: z.boolean() })).nullable(),
  areas: z.array(
    z.object({
      pincode: z.string(),
      locality: z.string().nullable(),
      localityHi: z.string().nullable(),
      orders: Count,
      bookings: Count,
    }),
  ),
  shops: z.array(
    z.object({
      id: z.string(),
      ...Named,
      offers: Count,
      accepted: Count,
      declined: Count,
      expired: Count,
      medianSecondsToAccept: Count.nullable(),
    }),
  ),
  workshops: z.array(
    z.object({
      id: z.string(),
      ...Named,
      requests: Count,
      confirmed: Count,
      completed: Count,
      cancelled: Count,
      medianMinutesToPropose: Count.nullable(),
    }),
  ),
});
export type AnalyticsDashboard = z.infer<typeof AnalyticsDashboardDto>;
export type AnalyticsKpis = z.infer<typeof AnalyticsKpisDto>;
export type AnalyticsTraffic = z.infer<typeof AnalyticsTrafficDto>;
export type AnalyticsDay = z.infer<typeof AnalyticsDayDto>;

/**
 * Live work queues for the admin Overview. A count is null when the staff member lacks the permission that reads
 * that queue; counts are limited to the staff member's cities.
 */
export const AdminOverviewDto = z.object({
  ordersNeedRouting: Count.nullable(),
  ordersAwaitingShop: Count.nullable(),
  ordersInProgress: Count.nullable(),
  servicesNeedRouting: Count.nullable(),
  ticketsOpen: Count.nullable(),
  reviewsPending: Count.nullable(),
  applicationsPending: Count.nullable(),
  priceRequestsPending: Count.nullable(),
  /** Today (IST): orders placed and their value; null without `analytics:read`. */
  ordersToday: Count.nullable(),
  gmvTodayPaise: Paise.nullable(),
});
export type AdminOverview = z.infer<typeof AdminOverviewDto>;
