import { describe, expect, it } from 'vitest';
import {
  AdminWorkshopListDto,
  EstimateSentDto,
  NearbyWorkshopsDto,
  ServiceChangedDto,
  ServiceRequestDetailDto,
  ServiceRequestPageDto,
} from '../src/service-api';

/** The web validates the service API's answers with these (hard rule 4); samples mirror `service-schemas.ts`. */
const at = '2026-11-14T10:00:00.000Z';
const workshop = {
  id: 'w1',
  slug: 'shankar-nagar-auto-hub',
  name: 'Shankar Nagar Auto Hub',
  area: 'Shankar Nagar',
  address: '12 Main Road',
  pincode: '492007',
  lat: 21.25,
  lng: 81.63,
  distanceKm: 1.2,
  vehicleTypes: ['2W', '4W'],
  evBasic: false,
  pickup: true,
  hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
  ratingAvg: null,
  ratingCount: 0,
  gstRegistered: true,
  services: [
    {
      key: 'oil-change',
      title: 'Engine oil change',
      included: null,
      lowPaise: 25_000,
      highPaise: 60_000,
      minMinutes: 30,
      maxMinutes: 60,
      vehicleType: null,
    },
  ],
};
const summary = {
  code: 'SR-RPR-2026-7K3Q9X',
  status: 'needs_routing',
  version: 1,
  workshop: null,
  vehicle: { type: '2W', text: 'Honda Activa' },
  services: [],
  preferredDate: '2026-11-15',
  preferredSlot: 'morning',
  pincode: '492007',
  waitingForCustomer: false,
  createdAt: at,
  updatedAt: at,
};

describe('service API response schemas', () => {
  it('accepts nearby workshops and a request page', () => {
    expect(
      NearbyWorkshopsDto.parse({ origin: { lat: 21.2, lng: 81.6 }, workshops: [workshop] }).workshops,
    ).toHaveLength(1);
    expect(ServiceRequestPageDto.parse({ items: [summary], nextCursor: null }).items[0]?.status).toBe(
      'needs_routing',
    );
  });

  it('accepts a full request detail with estimate and bill', () => {
    const detail = {
      ...summary,
      status: 'billed',
      routingMode: 'chosen',
      workshop: { id: 'w1', slug: workshop.slug, name: workshop.name, area: workshop.area, phone: null },
      vehicle: { type: '2W', text: 'Honda Activa', vehicleId: null },
      concern: null,
      pickup: false,
      odometerKm: 12_000,
      reasonCode: null,
      customerMessage: null,
      proposal: {
        id: 'p1',
        date: '2026-11-15',
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
        status: 'accepted',
      },
      estimate: {
        id: 'e1',
        revision: 2,
        status: 'decided',
        items: [
          {
            id: '0190a8d2-0000-7000-8000-000000000001',
            lineNo: 1,
            description: 'Oil',
            serviceKey: 'oil-change',
            qty: 1,
            unitPaise: 40_000,
            gstRateBp: 1800,
            decision: 'approved',
          },
        ],
      },
      bill: {
        lines: [
          {
            id: '1',
            description: 'Oil',
            qty: 1,
            unitPaise: 40_000,
            gstRateBp: 1800,
            taxablePaise: 40_000,
            gstPaise: 7_200,
          },
        ],
        gstRegistered: true,
        taxablePaise: 40_000,
        cgstPaise: 3_600,
        sgstPaise: 3_600,
        roundOffPaise: 0,
        totalPaise: 47_200,
        billedAt: at,
        paidAt: null,
        method: null,
      },
      customer: { name: 'Ravi', phone: '+919812345678' },
      timeline: [{ from: null, to: 'requested', actor: 'customer', at }],
    };
    expect(ServiceRequestDetailDto.parse(detail).bill?.totalPaise).toBe(47_200);
  });

  it('refuses an unknown status and a missing version', () => {
    expect(ServiceChangedDto.safeParse({ status: 'lost', version: 2 }).success).toBe(false);
    expect(EstimateSentDto.safeParse({ status: 'estimate_sent', version: 2 }).success).toBe(false);
    expect(EstimateSentDto.safeParse({ status: 'estimate_sent', version: 2, revision: 1 }).success).toBe(
      true,
    );
  });

  it('accepts the admin workshop list', () => {
    const admin = {
      ...workshop,
      cityId: 'c1',
      nameHi: null,
      addressLine: '12 Main Road',
      addressLineHi: null,
      areaHi: null,
      phone: null,
      gstin: null,
      locationVerified: false,
      published: false,
      status: 'approved',
      statusReason: null,
      busy: false,
      version: 1,
      missingHindi: ['name'],
      menu: [{ ...workshop.services[0], titleHi: null, includedHi: null, active: true }],
    };
    expect(AdminWorkshopListDto.parse({ workshops: [admin] }).workshops[0]?.menu[0]?.active).toBe(true);
  });
});
