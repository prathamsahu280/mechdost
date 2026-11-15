/**
 * Typed fixtures of the workshops tier 1 audit rows (spec 06/07, design 2026-11-15): "My workshop" in the workshop
 * portal (plain / busy / a waiting pin request, long text) and the customer's "Change date or time" form on the request
 * page. `profileMocks` is also added to every other workshop-portal row, because the portal now loads the profile and
 * an unmocked call would show an error banner there. Every body carries its shared schema.
 */
import { ServiceRequestPageDto, WorkshopProfilesDto, WorkshopSlotsDto } from '@mechdost/shared/service-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { roleMock } from './home-fixtures.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const WORKSHOP_ID = '00000000-0000-4000-8000-000000000a01';
const long = (c: AuditCase) => c.state.stress === 'long-text';

function profile(c: AuditCase): Dto<typeof WorkshopProfilesDto> {
  const state = c.state.myws ?? 'plain';
  const hi = c.locale === 'hi';
  const name = long(c)
    ? hi
      ? 'श्री गणेश ऑटोमोबाइल्स और टू व्हीलर सर्विस सेंटर रायपुर'
      : 'Shri Ganesh Automobiles and Two Wheeler Service Centre Raipur'
    : hi
      ? 'होम गैराज 1'
      : 'Home Garage 1';
  return {
    workshops: [
      {
        workshopId: WORKSHOP_ID,
        name,
        nameHi: 'होम गैराज 1',
        addressLine: 'GE Road, Shankar Nagar',
        addressLineHi: 'जीई रोड, शंकर नगर',
        area: 'Shankar Nagar',
        areaHi: 'शंकर नगर',
        phone: '+919811199999',
        lat: 21.2514,
        lng: 81.6296,
        gstin: state === 'plain' ? null : '22AAAAA0000A1Z5',
        hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
        busy: state === 'busy',
        slotCapacity: 2,
        version: 3,
        menu: [
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
            homeAvailable: false,
          },
          {
            key: 'diagnosis',
            title: 'Inspection',
            titleHi: 'जाँच',
            included: null,
            includedHi: null,
            lowPaise: 25_000,
            highPaise: 70_000,
            minMinutes: 30,
            maxMinutes: 60,
            vehicleType: null,
            active: false,
            homeAvailable: false,
          },
        ],
        pending:
          state === 'pending'
            ? [
                {
                  id: '00000000-0000-4000-8000-000000000b01',
                  kind: 'location',
                  createdAt: '2026-11-15T08:00:00.000Z',
                },
              ]
            : [],
      },
    ],
  };
}

/** The profile card and the hour picker's slots: added to every workshop-portal row. */
export function profileMocks(c: AuditCase): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/workshop\/profile$/,
      schema: WorkshopProfilesDto,
      reply: (): Reply => ({ body: profile(c) }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/slots$/,
      schema: WorkshopSlotsDto,
      reply: (): Reply => ({
        body: {
          slots: [9, 10, 11, 12].map((hour) => ({
            hour,
            part: 'morning' as const,
            capacity: 2,
            booked: hour === 10 ? 2 : 0,
            free: hour === 10 ? 0 : 2,
          })),
        } satisfies Dto<typeof WorkshopSlotsDto>,
      }),
    },
  ];
}

/** The "My workshop" row: no requests, only the profile card. */
export function myWorkshopMocks(c: AuditCase): Mock[] {
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/workshop\/requests$/,
      schema: ServiceRequestPageDto,
      reply: (): Reply => ({ body: { items: [], nextCursor: null } }),
    },
    ...profileMocks(c),
  ];
}
