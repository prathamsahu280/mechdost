/**
 * Typed fixtures of the home servicing audit rows (spec 06, design 2026-11-15): the workshop finder in home mode, the
 * customer's request page (arrival code, offer to move, visit fee on the bill) and the workshop portal (settings,
 * arrival entry, move offer, fee due). Kept apart from `fixtures.ts` so the two grow independently; the registry in
 * `fixtures.ts` hands the matching cases here. Every value is typed with the shared DTO and every mock carries its schema.
 */
import { AddressesDto } from '@mechdost/shared/account-api';
import {
  ArrivalResultDto,
  HomeSettingsListDto,
  NearbyWorkshopsDto,
  ServiceRequestDetailDto,
  ServiceRequestPageDto,
} from '@mechdost/shared/service-api';
import type { MeRoles } from '@mechdost/shared/partner-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

const NOW = Date.parse('2026-11-15T10:00:00.000Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WORKSHOP_ID = uuid(21);
const CODE = 'SR-RPR-2026-HND401';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;
type Detail = Dto<typeof ServiceRequestDetailDto>;
type Workshop = Dto<typeof NearbyWorkshopsDto>['workshops'][number];

const LONG_EN =
  'Sharma Doorstep Two-Wheeler Garage and Authorised Service Centre, Telibandha Main Road, Raipur';
const LONG_HI = 'शर्मा डोरस्टेप दोपहिया गैराज और अधिकृत सर्विस सेंटर, तेलीबांधा मुख्य मार्ग, रायपुर';
const long = (c: Pick<AuditCase, 'locale' | 'state'>) => c.state.stress === 'long-text';
const loc = (c: Pick<AuditCase, 'locale' | 'state'>) => (c.locale === 'hi' ? LONG_HI : LONG_EN);

export function roleMock(c: AuditCase): Mock {
  return {
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
        roles:
          c.auth === 'workshop'
            ? [{ role: 'workshop_owner', shopId: null, workshopId: WORKSHOP_ID }]
            : [{ role: 'customer', shopId: null, workshopId: null }],
      } satisfies Dto<typeof MeRoles> & Record<string, unknown>,
    }),
  };
}

// ── Finder in home mode ─────────────────────────────────────────────────────────────────────────────────────────

const address = (n: number, pinned: boolean) => ({
  id: uuid(30 + n),
  label: 'home' as const,
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: `${String(n)} Lal Bagh Colony`,
  line2: null,
  landmark: 'near the temple',
  pincode: '492001',
  cityName: 'Raipur',
  stateName: 'Chhattisgarh',
  lat: pinned ? 21.2514 : null,
  lng: pinned ? 81.6296 : null,
  isDefaultShipping: n === 1,
  isDefaultBilling: false,
  serviceable: true,
  version: 1,
});

export function workshop(
  n: number,
  c: Pick<AuditCase, 'locale' | 'state'>,
  over: Partial<Workshop> = {},
): Workshop {
  return {
    id: uuid(40 + n),
    slug: `home-garage-${String(n)}`,
    name: long(c) ? loc(c) : c.locale === 'hi' ? `होम गैराज ${String(n)}` : `Home Garage ${String(n)}`,
    area: c.locale === 'hi' ? 'शंकर नगर' : 'Shankar Nagar',
    address: c.locale === 'hi' ? 'जीई रोड, शंकर नगर' : 'GE Road, Shankar Nagar',
    pincode: '492001',
    lat: 21.26 + n / 1000,
    lng: 81.63,
    distanceKm: n,
    vehicleTypes: ['2W'],
    evBasic: false,
    pickup: false,
    hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
    ratingAvg: 4.4,
    ratingCount: 12,
    gstRegistered: n % 2 === 1,
    home: { radiusKm: 5, visitFeePaise: 9_900 },
    services: [
      {
        key: 'routine2w',
        title: c.locale === 'hi' ? 'जनरल सर्विस (2W)' : 'General service (2W)',
        included: null,
        lowPaise: 80_000,
        highPaise: 150_000,
        minMinutes: 120,
        maxMinutes: 180,
        vehicleType: '2W',
        homeAvailable: true,
      },
    ],
    ...over,
  };
}

export function homeFinderMocks(c: AuditCase): Mock[] {
  const addresses = c.state.addresses ?? 'pinned';
  const listing = c.state.listing ?? 'some';
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/me\/addresses$/,
      schema: AddressesDto,
      reply: (): Reply => ({
        body: {
          addresses:
            addresses === 'none'
              ? []
              : addresses === 'unpinned'
                ? [address(1, false), address(2, false)]
                : [address(1, true), address(2, false)],
        } satisfies Dto<typeof AddressesDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/workshops$/,
      schema: NearbyWorkshopsDto,
      reply: (): Reply => {
        if (listing === 'error') return { status: 500, code: 'INTERNAL' };
        const some = [
          workshop(1, c),
          workshop(2, c, { home: { radiusKm: 8, visitFeePaise: 0 } }),
          workshop(3, c),
        ];
        // "Edge": the workshop whose own radius ends exactly at the customer (distance equals the radius).
        const edge = [workshop(5, c, { distanceKm: 5, home: { radiusKm: 5, visitFeePaise: 14_950 } })];
        return {
          body: {
            origin: { lat: 21.2514, lng: 81.6296 },
            workshops: listing === 'none' ? [] : listing === 'edge' ? edge : some,
          } satisfies Dto<typeof NearbyWorkshopsDto>,
        };
      },
    },
  ];
}

// ── The customer's request page ────────────────────────────────────────────────────────────────────────────────

export function detailOf(variant: string, c: AuditCase): Detail {
  const base: Detail = {
    code: CODE,
    serviceMode: 'home',
    home: {
      visitFeePaise: 9_900,
      gstRegistered: true,
      feeWaivedReason: null,
      mechanicName: long(c) ? 'Sunil Kumar Verma Prasad' : 'Sunil',
      address: { line1: '12 Lal Bagh Colony', line2: null, landmark: 'near the temple' },
      arrivalCode: null,
      arrivalLocked: false,
      arrivedVia: null,
      move: null,
    },
    status: 'confirmed',
    version: 4,
    reschedule: { count: 0, max: 2, from: null },
    routingMode: 'chosen',
    workshop: {
      id: WORKSHOP_ID,
      slug: 'home-garage-1',
      name: long(c) ? loc(c) : c.locale === 'hi' ? 'होम गैराज 1' : 'Home Garage 1',
      area: c.locale === 'hi' ? 'शंकर नगर' : 'Shankar Nagar',
      phone: '+919811199999',
      ratingAvg: 4.4,
      ratingCount: 12,
    },
    vehicle: { type: '2W', text: 'Honda Activa 6G', vehicleId: null },
    services: [
      {
        key: 'routine2w',
        title: c.locale === 'hi' ? 'जनरल सर्विस (2W)' : 'General service (2W)',
        lowPaise: 80_000,
        highPaise: 150_000,
      },
    ],
    concern: null,
    pincode: '492001',
    preferredDate: '2026-11-16',
    preferredSlot: 'morning',
    pickup: false,
    odometerKm: null,
    reasonCode: null,
    customerMessage: null,
    proposal: {
      id: uuid(50),
      date: '2026-11-16',
      slot: 'morning',
      hour: null,
      lowPaise: 80_000,
      highPaise: 150_000,
      note: null,
      status: 'accepted',
    },
    estimate: null,
    bill: null,
    customer: null,
    timeline: [
      { from: null, to: 'requested', actor: 'customer', at: iso(-300) },
      { from: 'proposed', to: 'confirmed', actor: 'customer', at: iso(-120) },
    ],
    createdAt: iso(-300),
    updatedAt: iso(-60),
  };
  const home = base.home;
  if (!home) return base;
  const move = (status: 'proposed' | 'accepted' | 'declined') => ({
    id: uuid(60),
    reasonCode: 'needs_lift',
    transport: 'workshop_picks_up',
    status,
  });
  switch (variant) {
    case 'confirmed-code':
      return { ...base, home: { ...home, arrivalCode: '4821' } };
    case 'confirmed-locked':
      return { ...base, home: { ...home, arrivalCode: '4821', arrivalLocked: true } };
    case 'arrived':
      return {
        ...base,
        status: 'vehicle_received',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'code' },
      };
    case 'arrived-override':
      return {
        ...base,
        status: 'vehicle_received',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'override' },
      };
    case 'move-offer':
      return {
        ...base,
        status: 'vehicle_received',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'code', move: move('proposed') },
      };
    case 'move-accepted':
      return {
        ...base,
        serviceMode: 'workshop',
        pickup: true,
        status: 'vehicle_received',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'code', move: move('accepted') },
      };
    case 'move-declined':
      return {
        ...base,
        status: 'no_work_approved',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'code', move: move('declined') },
      };
    case 'fee-waived':
      return {
        ...base,
        status: 'ready',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'code', feeWaivedReason: 'goodwill' },
      };
    case 'billed-fee':
      return {
        ...base,
        status: 'billed',
        odometerKm: 21_400,
        home: { ...home, arrivedVia: 'code' },
        bill: {
          lines: [
            {
              id: uuid(70),
              description: 'Labour',
              qty: 1,
              unitPaise: 80_000,
              gstRateBp: 1800,
              taxablePaise: 80_000,
              gstPaise: 14_400,
            },
            {
              id: 'visit_fee',
              kind: 'visit_fee',
              description: 'Home visit fee',
              qty: 1,
              unitPaise: 9_900,
              gstRateBp: 1800,
              taxablePaise: 9_900,
              gstPaise: 1_782,
            },
          ],
          gstRegistered: true,
          taxablePaise: 89_900,
          cgstPaise: 8_091,
          sgstPaise: 8_091,
          roundOffPaise: 18,
          totalPaise: 106_100,
          billedAt: iso(-10),
          paidAt: null,
          method: null,
          // The labour promise frozen on the bill (trust wording merge 2026-11-15): off for this fixture.
          labourPromiseDays: null,
        },
      };
    default:
      return base;
  }
}

export function homeRequestMocks(c: AuditCase): Mock[] {
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/service-requests\/SR-/,
      schema: ServiceRequestDetailDto,
      reply: (): Reply => ({ body: detailOf(c.state.home ?? 'confirmed-code', c) }),
    },
  ];
}

// ── The workshop portal ─────────────────────────────────────────────────────────────────────────────────────────

export function summaryOf(d: Detail): Dto<typeof ServiceRequestPageDto>['items'][number] {
  return {
    code: d.code,
    status: d.status,
    version: d.version,
    workshop: d.workshop ? { slug: d.workshop.slug, name: d.workshop.name } : null,
    vehicle: { type: d.vehicle.type, text: d.vehicle.text },
    services: d.services,
    preferredDate: d.preferredDate,
    preferredSlot: d.preferredSlot,
    pincode: d.pincode,
    waitingForCustomer: false,
    serviceMode: d.serviceMode,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function homeJobMocks(c: AuditCase): Mock[] {
  const job = c.state.job ?? 'arrival';
  const variant =
    job === 'arrival-locked'
      ? 'confirmed-locked'
      : job === 'offer-move'
        ? 'arrived'
        : job === 'move-waiting'
          ? 'move-offer'
          : job === 'fee-due'
            ? 'move-declined'
            : job === 'propose'
              ? 'propose'
              : 'confirmed-code';
  const full = detailOf(variant, c);
  // The workshop never sees the arrival code (the API returns null to it).
  const detail: Detail = { ...full, home: full.home ? { ...full.home, arrivalCode: null } : null };
  // A new request has no mechanic yet, no proposal and (not yet confirmed) no address for the workshop.
  const open: Detail =
    job === 'propose'
      ? {
          ...detail,
          status: 'awaiting_workshop',
          proposal: null,
          home: detail.home ? { ...detail.home, mechanicName: null, address: null } : null,
        }
      : detail;
  const page = (items: Dto<typeof ServiceRequestPageDto>['items']): Reply => ({
    body: { items, nextCursor: null } satisfies Dto<typeof ServiceRequestPageDto>,
  });
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/workshop\/requests$/,
      schema: ServiceRequestPageDto,
      reply: ({ query }): Reply => {
        const view = query.get('view');
        if (job === 'propose') return page(view === 'new' ? [summaryOf(open)] : []);
        return page(view === 'active' ? [summaryOf(open)] : []);
      },
    },
    {
      method: 'GET',
      path: /^\/workshop\/requests\/SR-/,
      schema: ServiceRequestDetailDto,
      reply: (): Reply => ({ body: open }),
    },
    {
      method: 'POST',
      path: /^\/workshop\/requests\/SR-[^/]+\/vehicle-received$/,
      schema: ArrivalResultDto,
      reply: (): Reply => ({
        body:
          job === 'arrival-locked'
            ? ({ ok: false, reason: 'locked' } satisfies Dto<typeof ArrivalResultDto>)
            : ({ ok: false, reason: 'wrong', attemptsLeft: 3 } satisfies Dto<typeof ArrivalResultDto>),
      }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/home-settings$/,
      schema: HomeSettingsListDto,
      reply: (): Reply => ({
        body: {
          workshops: [
            {
              workshopId: WORKSHOP_ID,
              name: long(c) ? loc(c) : c.locale === 'hi' ? 'होम गैराज 1' : 'Home Garage 1',
              homeService: c.state.settings === 'on',
              homeRadiusKm: 5,
              homeVisitFeePaise: 9_900,
              maxFeePaise: 50_000,
              gstRegistered: true,
              version: 3,
              services: [
                {
                  key: 'routine2w',
                  title: 'General service (2W)',
                  titleHi: 'जनरल सर्विस (2W)',
                  homeAvailable: true,
                },
                { key: 'diagnosis', title: 'Inspection', titleHi: 'जाँच', homeAvailable: false },
              ],
            },
          ],
        } satisfies Dto<typeof HomeSettingsListDto>,
      }),
    },
  ];
}
