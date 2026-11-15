/**
 * Typed fixtures of the workshops-next-tier rows 5 to 7 (spec 03, 06, 08; design 2026-11-15): "Pay online" under the
 * customer's bill, and the admin Services screen with ranked suggestions and staff cancel. Every value is typed with
 * the shared DTO and every mock carries its schema (see `mock-api.ts`).
 */
import {
  AdminWorkshopListDto,
  BillCheckoutDto,
  ServiceCancelledDto,
  ServiceRequestDetailDto,
  ServiceRequestPageDto,
  WorkshopSuggestionsDto,
} from '@mechdost/shared/service-api';
import type { AuditCase } from '../cases.ts';
import { detailOf, roleMock, summaryOf } from './home-fixtures.ts';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const long = (c: AuditCase) => c.state.stress === 'long-text';

/** The customer's billed request with the "Pay online" action; `pay=error` makes the tap answer BILL_NOT_PAYABLE. */
export function billPayMocks(c: AuditCase): Mock[] {
  const bill = detailOf('billed-fee', c);
  const detail: Dto<typeof ServiceRequestDetailDto> =
    c.state.pay === 'paid'
      ? {
          ...bill,
          status: 'completed',
          bill: bill.bill ? { ...bill.bill, paidAt: '2026-11-15T10:05:00.000Z', method: 'online' } : null,
        }
      : bill;
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/service-requests\/SR-[^/]+$/,
      schema: ServiceRequestDetailDto,
      reply: (): Reply => ({ body: detail }),
    },
    {
      method: 'POST',
      path: /^\/service-requests\/SR-[^/]+\/pay$/,
      schema: BillCheckoutDto,
      reply: (): Reply =>
        c.state.pay === 'error'
          ? { status: 409, code: 'BILL_NOT_PAYABLE' }
          : {
              body: {
                keyId: 'rzp_test_audit',
                orderId: 'order_audit00001',
                amountPaise: 106_100,
                currency: 'INR',
              } satisfies Dto<typeof BillCheckoutDto>,
            },
    },
  ];
}

const WORKSHOP_NAME = (c: AuditCase, n: number) =>
  long(c)
    ? c.locale === 'hi'
      ? 'शर्मा डोरस्टेप दोपहिया गैराज और अधिकृत सर्विस सेंटर, तेलीबांधा मुख्य मार्ग, रायपुर'
      : 'Sharma Doorstep Two-Wheeler Garage and Authorised Service Centre, Telibandha Main Road, Raipur'
    : c.locale === 'hi'
      ? `होम गैराज ${String(n)}`
      : `Home Garage ${String(n)}`;

const REASONS = (scores: [number, number, number, number, number]) =>
  (['distance', 'rating', 'acceptance', 'speed', 'load'] as const).map((factor, i) => ({
    factor,
    scoreBp: scores[i] ?? 5000,
    known: true,
  }));

/** Admin → Services with a request that needs routing: ranked suggestions (or none / an error) and the staff cancel form. */
export function adminRoutingMocks(c: AuditCase): Mock[] {
  const open = detailOf('confirmed-code', c);
  const needs: typeof open = { ...open, status: 'needs_routing', workshop: null, proposal: null };
  const rank = c.state.rank ?? 'ranked';
  const suggestions: Dto<typeof WorkshopSuggestionsDto> = {
    items:
      rank === 'ranked'
        ? [1, 2, 3].map((n) => ({
            workshopId: uuid(80 + n),
            slug: `home-garage-${String(n)}`,
            name: WORKSHOP_NAME(c, n),
            pincode: '492001',
            rank: n,
            scoreBp: 9000 - n * 1500,
            distanceM: n === 3 ? null : n * 1800,
            ratingX100: n === 2 ? null : 440,
            acceptancePercent: n === 3 ? null : 86,
            medianMinutesToPropose: n === 3 ? null : 25,
            openJobs: n * 2,
            slotCapacity: 2,
            reasons: REASONS([8000, 8800, 8600, 8900, 7000]),
          }))
        : [],
  };
  return [
    {
      method: 'GET',
      path: /^\/me$/,
      reply: (): Reply => ({
        body: {
          name: 'Audit User',
          phone: '+919876543210',
          email: 'audit@example.com',
          emailVerified: true,
          language: c.locale,
          version: 1,
          roles: [{ role: 'ops_manager', shopId: null, workshopId: null }],
        },
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/service-requests$/,
      schema: ServiceRequestPageDto,
      reply: ({ query }): Reply => ({
        body: {
          items: query.get('view') === 'needs_routing' ? [summaryOf(needs)] : [],
          nextCursor: null,
        } satisfies Dto<typeof ServiceRequestPageDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/service-requests\/SR-[^/]+$/,
      schema: ServiceRequestDetailDto,
      reply: (): Reply => ({ body: needs }),
    },
    {
      method: 'GET',
      path: /^\/admin\/service-requests\/SR-[^/]+\/suggestions$/,
      schema: WorkshopSuggestionsDto,
      reply: (): Reply => (rank === 'error' ? { status: 500, code: 'INTERNAL' } : { body: suggestions }),
    },
    {
      method: 'GET',
      path: /^\/admin\/workshops$/,
      schema: AdminWorkshopListDto,
      reply: (): Reply => ({ body: { workshops: [] } satisfies Dto<typeof AdminWorkshopListDto> }),
    },
    {
      method: 'POST',
      path: /^\/admin\/service-requests\/SR-[^/]+\/cancel$/,
      schema: ServiceCancelledDto,
      reply: (): Reply => ({
        body: { status: 'cancelled', version: 6, refundRequested: false } satisfies Dto<
          typeof ServiceCancelledDto
        >,
      }),
    },
  ];
}
