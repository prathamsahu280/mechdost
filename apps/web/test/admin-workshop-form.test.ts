import type { AdminWorkshop } from '@mechdost/shared/service-api';
import { describe, expect, it } from 'vitest';
import {
  createBody,
  emptyMenuRow,
  emptyWorkshopForm,
  formFromWorkshop,
  memberPhone,
  updateBody,
  type WorkshopForm,
} from '../src/lib/admin-workshop-form';

const filled = (): WorkshopForm => ({
  ...emptyWorkshopForm(),
  slug: 'shankar-nagar-auto-hub',
  name: 'Shankar Nagar Auto Hub',
  nameHi: 'शंकर नगर ऑटो हब',
  addressLine: '12 Main Road, Shankar Nagar',
  area: 'Shankar Nagar',
  pincode: '492007',
  lat: '21.2514',
  lng: '81.6296',
  phone: '9876543210',
  menu: [
    {
      ...emptyMenuRow(),
      key: 'oil-change',
      title: 'Engine oil change',
      titleHi: 'इंजन ऑयल बदलना',
      low: '250',
      high: '600',
    },
  ],
});

const saved: AdminWorkshop = {
  id: '0190a8d2-0000-7000-8000-000000000001',
  cityId: 'c1',
  slug: 'shankar-nagar-auto-hub',
  name: 'Shankar Nagar Auto Hub',
  nameHi: null,
  addressLine: '12 Main Road, Shankar Nagar',
  addressLineHi: null,
  area: 'Shankar Nagar',
  areaHi: null,
  pincode: '492007',
  lat: 21.2514,
  lng: 81.6296,
  phone: '+919876543210',
  vehicleTypes: ['2W'],
  evBasic: false,
  pickup: false,
  hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
  gstin: null,
  gstRegistered: false,
  locationVerified: true,
  published: true,
  status: 'approved',
  statusReason: null,
  busy: false,
  version: 3,
  missingHindi: ['name'],
  menu: [
    {
      key: 'oil-change',
      title: 'Engine oil change',
      titleHi: null,
      included: null,
      includedHi: null,
      lowPaise: 25_000,
      highPaise: 60_000,
      minMinutes: 30,
      maxMinutes: 60,
      vehicleType: null,
      active: true,
    },
  ],
};

describe('admin workshop form → API bodies', () => {
  it('builds a valid create body in paise with +91 phone and nulls for empty Hindi', () => {
    const r = createBody(filled());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toMatchObject({
      slug: 'shankar-nagar-auto-hub',
      phone: '+919876543210',
      lat: 21.2514,
      addressLineHi: null,
      menu: [{ key: 'oil-change', lowPaise: 25_000, highPaise: 60_000, vehicleType: null }],
    });
  });

  it('reports the fields to fix by path', () => {
    const f = filled();
    f.pincode = '12';
    f.lat = 'north';
    f.close = '08:00';
    const row = f.menu[0];
    if (row) f.menu = [{ ...row, high: '100' }, { ...row }];
    const r = createBody(f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors)).toEqual(
      expect.arrayContaining(['pincode', 'lat', 'hours', 'menu.0.highPaise', 'menu.1.key']),
    );
  });

  it('sends only what changed on an edit (no publish flag from staff without approval rights)', () => {
    const f = formFromWorkshop(saved);
    f.nameHi = 'शंकर नगर ऑटो हब';
    const r = updateBody(saved, f);
    expect(r).toEqual({ ok: true, changed: true, body: { version: 3, nameHi: 'शंकर नगर ऑटो हब' } });
  });

  it('sends lat and lng together and knows when nothing changed', () => {
    const f = formFromWorkshop(saved);
    expect(updateBody(saved, f)).toEqual({ ok: true, changed: false, body: { version: 3 } });
    f.lng = '81.63';
    const r = updateBody(saved, f);
    expect(r.ok && r.body).toEqual({ version: 3, lat: 21.2514, lng: 81.63 });
  });

  it('reads member phones as Indian mobile numbers', () => {
    expect(memberPhone('98765 43210')).toBe('+919876543210');
    expect(memberPhone('+91 98765 43210')).toBe('+919876543210');
    expect(memberPhone('12345')).toBeNull();
    expect(memberPhone('5876543210')).toBeNull();
  });
});
