/**
 * DEMO SIGN-IN (user 2026-11-01: "create the logins now, just a fake one, I'll link Firebase later").
 *
 * Mirrors spec 01 (decision 2026-11-01): sign up once with phone → OTP → name, email, password; afterwards sign
 * in with phone or email + password; forgot password via a phone code or an email link. Everything lives in
 * this browser. The OTP is always 123456, like the Firebase Auth Emulator; seeded logins use DEMO_PASSWORD.
 * Replaced by Firebase Auth + the API's password sign-in in Phase 1; never holds real data.
 */
import { useSyncExternalStore } from 'react';
import {
  checkPassword,
  clearFailures,
  consumeResetLink,
  createResetLink,
  hashPassword,
  lockedUntil,
  peekResetLink,
  recordFailure,
  type PasswordHash,
} from './passwords';
import { demoStorage } from './store';

export const DEMO_OTP = '123456';
/** Password of every seeded demo login until it is changed on this device (docs/runbooks/demo.md). */
export const DEMO_PASSWORD = 'Raipur@2026';

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

// ── Password sign-in (decision 2026-11-01): phone OTP once at sign-up, then phone or email + password ────────

export const isEmailLike = (value: string) => value.includes('@');

/** Account by phone number or email (case-insensitive). */
export function findByIdentifier(identifier: string): DemoAccount | undefined {
  const value = identifier.trim();
  if (isEmailLike(value)) {
    const email = value.toLowerCase();
    return accountsSnapshot().find((a) => a.email.toLowerCase() === email);
  }
  const phone = normalisePhone(value);
  return phone ? findAccount(phone) : undefined;
}

/** Lockout key: the normalised identifier, so "+91 98765…" and "98765…" share one counter. */
function identifierKey(identifier: string): string {
  const value = identifier.trim();
  return isEmailLike(value) ? value.toLowerCase() : (normalisePhone(value) ?? value);
}

let seedHash: Promise<PasswordHash> | null = null;
let dummyHash: Promise<PasswordHash> | null = null;

/** Stored hash, or the shared demo password for seeded accounts that never changed it. */
function storedHash(account: DemoAccount | undefined): Promise<PasswordHash> | null {
  if (account?.password) return Promise.resolve(account.password);
  if (account && SEEDED_ACCOUNTS.some((s) => s.id === account.id)) {
    seedHash ??= hashPassword(DEMO_PASSWORD);
    return seedHash;
  }
  return null;
}

export type PasswordSignIn =
  | { ok: true; account: DemoAccount; needsOtp: boolean }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'locked'; until: number };

/**
 * Phone or email + password. Unknown account and wrong password give the same answer after the same work
 * (no account enumeration); 5 failures lock that identifier for 15 minutes. Staff (admin) accounts need a
 * code to their phone as a second step before a session starts (decisions: staff 2FA).
 */
export async function signInWithPassword(identifier: string, password: string): Promise<PasswordSignIn> {
  const key = identifierKey(identifier);
  const until = lockedUntil(key);
  if (until) return { ok: false, reason: 'locked', until };
  const account = findByIdentifier(identifier);
  const hash = storedHash(account);
  dummyHash ??= hashPassword('not-a-real-password');
  const valid = await checkPassword(password, await (hash ?? dummyHash));
  if (!account || !hash || !valid) {
    recordFailure(key);
    const now = lockedUntil(key);
    return now ? { ok: false, reason: 'locked', until: now } : { ok: false, reason: 'invalid' };
  }
  clearFailures(key);
  if (account.role === 'admin') return { ok: true, account, needsOtp: true };
  startSession(account.id);
  return { ok: true, account, needsOtp: false };
}

/** Second step for staff: the code sent to their phone. */
export function completeStaffSignIn(accountId: string, otp: string): boolean {
  if (otp.trim() !== DEMO_OTP) return false;
  startSession(accountId);
  return true;
}

/** Sign-up step 2: the code proves the phone. `exists` = this number already has an account. */
export function verifyPhoneOtp(phone: string, otp: string): { ok: false } | { ok: true; exists: boolean } {
  if (otp.trim() !== DEMO_OTP) return { ok: false };
  return { ok: true, exists: Boolean(findAccount(phone)) };
}

export type SignUpResult =
  { ok: true; account: DemoAccount } | { ok: false; reason: 'phone_in_use' | 'email_in_use' };

/** Sign-up step 3: create a customer account (partners and staff are created by admin approval). */
export async function signUp(input: {
  phone: string;
  name: string;
  email: string;
  password: string;
  language: 'en' | 'hi';
}): Promise<SignUpResult> {
  const email = input.email.trim().toLowerCase().slice(0, 200);
  if (findAccount(input.phone)) return { ok: false, reason: 'phone_in_use' };
  if (findByIdentifier(email)) return { ok: false, reason: 'email_in_use' };
  const account: DemoAccount = {
    id: `acct-${globalThis.crypto.randomUUID()}`,
    phone: input.phone,
    name: input.name.trim().slice(0, 100),
    email,
    password: await hashPassword(input.password),
    role: 'customer',
    partner: null,
    language: input.language,
    vehicles: [],
    addresses: [],
    createdAt: new Date().toISOString(),
  };
  saveAccount(account);
  startSession(account.id);
  return { ok: true, account };
}

async function setPassword(account: DemoAccount, password: string): Promise<DemoAccount> {
  const updated = { ...account, password: await hashPassword(password) };
  saveAccount(updated);
  clearFailures(account.phone);
  clearFailures(account.email.toLowerCase());
  return updated;
}

/** Forgot password, phone route: the code proves the phone, then the new password is saved and you are in. */
export async function resetPasswordWithOtp(
  phone: string,
  otp: string,
  password: string,
): Promise<{ ok: true; account: DemoAccount } | { ok: false; reason: 'otp' | 'no_account' }> {
  if (otp.trim() !== DEMO_OTP) return { ok: false, reason: 'otp' };
  const account = findAccount(phone);
  if (!account) return { ok: false, reason: 'no_account' };
  const updated = await setPassword(account, password);
  // The code just proved the phone, so this already counts as the staff second step.
  startSession(updated.id);
  return { ok: true, account: updated };
}

/**
 * Forgot password, email route. Always looks the same to the person asking ("if an account uses this email,
 * we sent a link"). DEMO: there is no email, so the link token is returned for the on-screen demo inbox.
 */
export function requestEmailReset(email: string): string | null {
  const account = findByIdentifier(email.includes('@') ? email : '');
  return account ? createResetLink(account.id) : null;
}

export function resetLinkValid(token: string): boolean {
  return peekResetLink(token);
}

/** Opening the link and choosing a new password; the link works once and expires after 30 minutes. */
export async function resetPasswordWithLink(
  token: string,
  password: string,
): Promise<{ ok: true; account: DemoAccount } | { ok: false }> {
  const accountId = consumeResetLink(token);
  const account = accountId ? accountsSnapshot().find((a) => a.id === accountId) : undefined;
  if (!account) return { ok: false };
  return { ok: true, account: await setPassword(account, password) };
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
