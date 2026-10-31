/**
 * DEMO SIGN-IN (user 2026-11-01: "create the logins now, just a fake one, I'll link Firebase later").
 *
 * Mirrors the real flow of spec 01 — phone → OTP → (new users) name + email — but everything lives in this
 * browser. The OTP is always 123456, like the Firebase Auth Emulator. Seeded accounts cover every role so each
 * portal can be shown. Replaced by Firebase phone auth + `GET /v1/me` in Phase 1; never holds real data.
 */
import { useSyncExternalStore } from 'react';
import { demoStorage } from './store';

export const DEMO_OTP = '123456';

export type DemoRole = 'customer' | 'shop' | 'workshop' | 'admin';
export type VehicleType = '2W' | '4W';
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
        label: 'Home',
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

const ACCOUNTS = 'mechdost-demo-accounts';
const SESSION = 'mechdost-demo-session';

interface SessionRecord {
  accountId: string;
  signedInAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isAccount = (v: unknown): v is DemoAccount =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.phone === 'string' &&
  typeof v.role === 'string' &&
  Array.isArray(v.vehicles) &&
  Array.isArray(v.addresses);
const isSession = (v: unknown): v is SessionRecord => isRecord(v) && typeof v.accountId === 'string';

let merged: { stored: readonly DemoAccount[]; all: readonly DemoAccount[] } | null = null;

/** Seeded accounts with any edits made on this device, plus accounts created by sign-up. */
function accountsSnapshot(): readonly DemoAccount[] {
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
  value: DemoAccount | null;
} | null = null;

function sessionSnapshot(): DemoAccount | null {
  const record = demoStorage.read(SESSION, isSession)[0];
  const accounts = accountsSnapshot();
  const cached = lastSession;
  if (cached && cached.record === record && cached.accounts === accounts) return cached.value;
  const value = record ? (accounts.find((a) => a.id === record.accountId) ?? null) : null;
  lastSession = { record, accounts, value };
  return value;
}

/** Signed-in account, or null. Always null during server render and hydration. */
export function useSession(): DemoAccount | null {
  return useSyncExternalStore(demoStorage.subscribe, sessionSnapshot, () => null);
}

export function useAccounts(): readonly DemoAccount[] {
  return useSyncExternalStore(demoStorage.subscribe, accountsSnapshot, () => SEEDED_ACCOUNTS);
}

/** Normalise "+91 98765 43210" / "098765…" to 10 digits; null when it is not an Indian mobile number. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function findAccount(phone: string): DemoAccount | undefined {
  return accountsSnapshot().find((a) => a.phone === phone);
}

function saveAccount(account: DemoAccount) {
  const stored = demoStorage.read(ACCOUNTS, isAccount).filter((a) => a.id !== account.id);
  demoStorage.write(ACCOUNTS, [...stored, account]);
}

function startSession(accountId: string) {
  demoStorage.write(SESSION, [{ accountId, signedInAt: new Date().toISOString() }]);
}

export type VerifyResult = { ok: true; account: DemoAccount | null } | { ok: false; reason: 'otp' };

/** Step 2: check the OTP. A known number signs in; an unknown one continues to the profile step. */
export function verifyOtp(phone: string, otp: string): VerifyResult {
  if (otp.trim() !== DEMO_OTP) return { ok: false, reason: 'otp' };
  const account = findAccount(phone);
  if (account) startSession(account.id);
  return { ok: true, account: account ?? null };
}

/** Step 3 for new numbers: create a customer account (partners and staff are created by admin approval). */
export function signUp(input: {
  phone: string;
  name: string;
  email: string;
  language: 'en' | 'hi';
}): DemoAccount {
  const account: DemoAccount = {
    id: `acct-${globalThis.crypto.randomUUID()}`,
    phone: input.phone,
    name: input.name.trim().slice(0, 100),
    email: input.email.trim().toLowerCase().slice(0, 200),
    role: 'customer',
    partner: null,
    language: input.language,
    vehicles: [],
    addresses: [],
    createdAt: new Date().toISOString(),
  };
  saveAccount(account);
  startSession(account.id);
  return account;
}

export function signOut() {
  demoStorage.write(SESSION, []);
}

/** Where each role lands after signing in. */
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

/** Only same-site paths are allowed as a post-login destination (open-redirect guard). */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

function updateSignedIn(change: (a: DemoAccount) => DemoAccount) {
  const current = sessionSnapshot();
  if (current) saveAccount(change(current));
}

export function updateProfile(patch: Partial<Pick<DemoAccount, 'name' | 'email' | 'language'>>) {
  updateSignedIn((a) => ({ ...a, ...patch }));
}

const MAX_ITEMS = 10; // spec 01: max 10 vehicles, max 10 addresses

export function addVehicle(vehicle: Omit<DemoVehicle, 'id'>): boolean {
  const current = sessionSnapshot();
  if (!current || current.vehicles.length >= MAX_ITEMS) return false;
  updateSignedIn((a) => ({
    ...a,
    vehicles: [...a.vehicles, { ...vehicle, id: `veh-${globalThis.crypto.randomUUID()}` }],
  }));
  return true;
}

export function updateVehicle(id: string, patch: Partial<Omit<DemoVehicle, 'id'>>) {
  updateSignedIn((a) => ({ ...a, vehicles: a.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
}

export function removeVehicle(id: string) {
  updateSignedIn((a) => ({ ...a, vehicles: a.vehicles.filter((v) => v.id !== id) }));
}

export function addAddress(address: Omit<DemoAddress, 'id' | 'isDefault'>): boolean {
  const current = sessionSnapshot();
  if (!current || current.addresses.length >= MAX_ITEMS) return false;
  updateSignedIn((a) => ({
    ...a,
    addresses: [
      ...a.addresses,
      { ...address, id: `addr-${globalThis.crypto.randomUUID()}`, isDefault: a.addresses.length === 0 },
    ],
  }));
  return true;
}

export function setDefaultAddress(id: string) {
  updateSignedIn((a) => ({ ...a, addresses: a.addresses.map((x) => ({ ...x, isDefault: x.id === id })) }));
}

export function removeAddress(id: string) {
  updateSignedIn((a) => {
    const rest = a.addresses.filter((x) => x.id !== id);
    // Keep exactly one default while any address remains.
    const hasDefault = rest.some((x) => x.isDefault);
    return { ...a, addresses: rest.map((x, i) => ({ ...x, isDefault: hasDefault ? x.isDefault : i === 0 })) };
  });
}

export { MAX_ITEMS as MAX_ACCOUNT_ITEMS };
