/**
 * Shared fixture for the workshop and service-request suites: Chhattisgarh, Raipur (RPR) with three PIN codes and a
 * second city (Bhilai, BHI), a customer, a second customer and a staff member, and a helper that creates workshops
 * through the real admin repository.
 */
import type { CreateWorkshopInput } from '@mechdost/shared/service-requests';
import { createWorkshop } from '../src/repo';
import * as s from '../src/schema';
import type { TestDb } from '../src/testing';

export interface Fixture {
  raipur: string;
  bhilai: string;
  customer: string;
  other: string;
  staff: string;
}

export const MENU: CreateWorkshopInput['menu'] = [
  {
    key: 'diagnosis',
    title: 'Inspection & diagnosis',
    titleHi: 'जाँच और निदान',
    included: null,
    includedHi: null,
    lowPaise: 25_000,
    highPaise: 70_000,
    minMinutes: 30,
    maxMinutes: 60,
    vehicleType: null,
    active: true,
  },
  {
    key: 'routine2w',
    title: 'General service (2W)',
    titleHi: 'जनरल सर्विस (2W)',
    included: null,
    includedHi: null,
    lowPaise: 80_000,
    highPaise: 150_000,
    minMinutes: 120,
    maxMinutes: 180,
    vehicleType: '2W',
    active: true,
  },
];

export async function seedServiceFixture(db: TestDb): Promise<Fixture> {
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state');
  const [raipur] = await db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  const [bhilai] = await db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'BHI', slug: 'bhilai', name: 'Bhilai', status: 'live' })
    .returning();
  if (!raipur || !bhilai) throw new Error('city');
  await db.insert(s.pincodes).values([
    { pincode: '492001', stateId: state.id, cityId: raipur.id, centroid: { lng: 81.6296, lat: 21.2514 } },
    { pincode: '492004', stateId: state.id, cityId: raipur.id, centroid: { lng: 81.6612, lat: 21.2621 } },
    { pincode: '492009', stateId: state.id, cityId: raipur.id, centroid: null },
    { pincode: '490001', stateId: state.id, cityId: bhilai.id, centroid: { lng: 81.38, lat: 21.21 } },
  ]);
  const [customer] = await db
    .insert(s.users)
    .values({ firebaseUid: 'svc-cust', phone: '+919811100001', name: 'Ravi', language: 'hi' })
    .returning();
  const [other] = await db
    .insert(s.users)
    .values({ firebaseUid: 'svc-other', phone: '+919811100002', name: 'Asha' })
    .returning();
  const [staff] = await db
    .insert(s.users)
    .values({ firebaseUid: 'svc-staff', phone: '+919811100003', name: 'Ops' })
    .returning();
  if (!customer || !other || !staff) throw new Error('users');
  return { raipur: raipur.id, bhilai: bhilai.id, customer: customer.id, other: other.id, staff: staff.id };
}

let n = 0;
export async function addWorkshop(
  db: TestDb,
  f: Fixture,
  over: Partial<CreateWorkshopInput> = {},
): Promise<{ id: string; slug: string }> {
  n += 1;
  const w = await createWorkshop(db, {
    scope: { all: true },
    approveScope: { all: true },
    staffUserId: f.staff,
    workshop: {
      slug: `workshop-${String(n)}`,
      name: `Workshop ${String(n)}`,
      nameHi: `वर्कशॉप ${String(n)}`,
      addressLine: 'GE Road, Raipur',
      addressLineHi: 'जीई रोड, रायपुर',
      area: 'Shankar Nagar',
      areaHi: 'शंकर नगर',
      pincode: '492001',
      lat: 21.2514,
      lng: 81.6296,
      phone: '+919811199999',
      vehicleTypes: ['2W', '4W'],
      evBasic: false,
      pickup: false,
      hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
      gstin: null,
      locationVerified: true,
      published: true,
      menu: MENU,
      ...over,
    },
  });
  return { id: w.id, slug: w.slug };
}
