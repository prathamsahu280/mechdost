/**
 * Read-only side of the demo sign-in (session.ts): who is signed in and the account list. Split out so header
 * islands on every page (account link) do not ship the password hashing and sign-in code (spec 16 JS budget,
 * 2026-11-03). `session.ts` re-exports everything here.
 */
import { useSyncExternalStore } from 'react';
import { customerAllowed } from './customer-blocks';
import type { PasswordHash } from './passwords';
import { demoStorage } from './store';
import type { VehicleType } from '@mechdost/shared/vehicles';

export const DEMO_OTP = '123456';
/** Password of every seeded demo login until it is changed on this device (docs/runbooks/demo.md). */
export const DEMO_PASSWORD = 'Raipur@2026';

export type DemoRole = 'customer' | 'shop' | 'workshop' | 'admin';
export type { VehicleType } from '@mechdost/shared/vehicles';
export type Fuel = 'petrol' | 'diesel' | 'cng' | 'ev';

export interface DemoVehicle {
  id: string;
  type: VehicleType;
  make: string;
  model: string;
  year: number;
  fuel: Fuel;
  registration: string;
  odometerKm: number;
}

export interface DemoAddress {
  id: string;
  label: string;
  line1: string;
  landmark: string;
  pincode: string;
  isDefault: boolean;
}

export interface DemoAccount {
  id: string;
  /** 10-digit Indian mobile number (E.164 without +91 in the demo). */
  phone: string;
  name: string;
  email: string;
  /** Salted PBKDF2 hash; absent on seeded accounts until changed (they use DEMO_PASSWORD). Never plain text. */
  password?: PasswordHash;
  role: DemoRole;
  /** Shop or workshop slug for partner roles. */
  partner: string | null;
  language: 'en' | 'hi';
  vehicles: DemoVehicle[];
  addresses: DemoAddress[];
  createdAt: string;
}

/** Fixed demo logins, one per role (docs/runbooks/demo.md). */
export const SEEDED_ACCOUNTS: readonly DemoAccount[] = [
  {
    id: 'demo-customer',
    phone: '9876543210',
    name: 'Ravi Sahu',
    email: 'ravi.sahu@example.com',
    role: 'customer',
    partner: null,
    language: 'en',
    vehicles: [
      {
        id: 'veh-activa',
        type: '2W',
        make: 'Honda',
        model: 'Activa 6G',
        year: 2022,
        fuel: 'petrol',
        registration: 'CG04 MK 2201',
        odometerKm: 18_450,
      },
      {
        id: 'veh-swift',
        type: '4W',
        make: 'Maruti Suzuki',
        model: 'Swift VXi',
        year: 2019,
        fuel: 'petrol',
        registration: 'CG04 HX 7710',
        odometerKm: 52_300,
      },
    ],
    addresses: [
      {
        id: 'addr-home',
        label: '',
        line1: 'C-605 Salasar Greens, Sarona',
        landmark: 'Near Tatibandh chowk',
        pincode: '492099',
        isDefault: true,
      },
    ],
    createdAt: '2026-09-12T10:00:00.000Z',
  },
  {
    id: 'demo-shop',
    phone: '9000000001',
    name: 'Rakesh Sharma',
    email: 'orders@sharmaautoparts.example',
    role: 'shop',
    partner: 'sharma-auto-parts',
    language: 'en',
    vehicles: [],
    addresses: [],
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'demo-shop-2',
    phone: '9000000004',
    name: 'Anil Verma',
    email: 'desk@raipurbatterypoint.example',
    role: 'shop',
    partner: 'raipur-battery-point',
    language: 'en',
    vehicles: [],
    addresses: [],
    createdAt: '2026-08-05T10:00:00.000Z',
  },
  {
    id: 'demo-workshop',
    phone: '9000000002',
    name: 'Imran Khan',
    email: 'desk@telibandhacarclinic.example',
    role: 'workshop',
    partner: 'telibandha-car-clinic',
    language: 'en',
    vehicles: [],
    addresses: [],
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'demo-admin',
    phone: '9000000003',
    name: 'MechDost Operations',
    email: 'ops@mechdost.example',
    role: 'admin',
    partner: null,
    language: 'en',
    vehicles: [],
    addresses: [],
    createdAt: '2026-07-01T10:00:00.000Z',
  },
];

export const ACCOUNTS = 'mechdost-demo-accounts';
export const SESSION = 'mechdost-demo-session';

interface SessionRecord {
  accountId: string;
  signedInAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
/** Every field the address form writes (checkout prefills from these; review 2026-11-14). */
const isAddress = (a: unknown): a is DemoAddress =>
  isRecord(a) &&
  typeof a.id === 'string' &&
  typeof a.label === 'string' &&
  typeof a.line1 === 'string' &&
  typeof a.landmark === 'string' &&
  typeof a.pincode === 'string' &&
  typeof a.isDefault === 'boolean';

export const isAccount = (v: unknown): v is DemoAccount =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.phone === 'string' &&
  typeof v.role === 'string' &&
  Array.isArray(v.vehicles) &&
  Array.isArray(v.addresses) &&
  v.addresses.every(isAddress);
export const isSession = (v: unknown): v is SessionRecord => isRecord(v) && typeof v.accountId === 'string';

let merged: { stored: readonly DemoAccount[]; all: readonly DemoAccount[] } | null = null;

/** Seeded accounts with any edits made on this device, plus accounts created by sign-up. */
export function accountsSnapshot(): readonly DemoAccount[] {
  const stored = demoStorage.read(ACCOUNTS, isAccount);
  if (merged?.stored === stored) return merged.all;
  const byId = new Map<string, DemoAccount>(SEEDED_ACCOUNTS.map((a) => [a.id, a]));
  for (const a of stored) byId.set(a.id, a);
  merged = { stored, all: [...byId.values()] };
  return merged.all;
}

let lastSession: {
  record: SessionRecord | undefined;
  accounts: readonly DemoAccount[];
  blocked: boolean;
  value: DemoAccount | null;
} | null = null;

export function sessionSnapshot(): DemoAccount | null {
  const record = demoStorage.read(SESSION, isSession)[0];
  const accounts = accountsSnapshot();
  const cached = lastSession;
  // A fully blocked customer has no session (customer-blocks.ts), whichever way they signed in.
  const found = record ? (accounts.find((a) => a.id === record.accountId) ?? null) : null;
  const blocked = found !== null && !customerAllowed(found.id).signIn;
  if (cached && cached.record === record && cached.accounts === accounts && cached.blocked === blocked)
    return cached.value;
  const value = blocked ? null : found;
  lastSession = { record, accounts, blocked, value };
  return value;
}

/**
 * The stored session belongs to a fully blocked customer (who therefore counts as signed out): pages say why,
 * instead of looking like a silent sign-out (QA 2026-11-14, crawler F6).
 */
export function sessionBlocked(): boolean {
  sessionSnapshot();
  return lastSession?.blocked ?? false;
}

export function useSessionBlocked(): boolean {
  return useSyncExternalStore(demoStorage.subscribe, sessionBlocked, () => false);
}

/** Signed-in account, or null. Always null during server render and hydration. */
export function useSession(): DemoAccount | null {
  return useSyncExternalStore(demoStorage.subscribe, sessionSnapshot, () => null);
}

export function useAccounts(): readonly DemoAccount[] {
  return useSyncExternalStore(demoStorage.subscribe, accountsSnapshot, () => SEEDED_ACCOUNTS);
}

export function homeFor(role: DemoRole): string {
  switch (role) {
    case 'shop':
      return '/partner/shop';
    case 'workshop':
      return '/partner/workshop';
    case 'admin':
      return '/admin';
    default:
      return '/account';
  }
}
