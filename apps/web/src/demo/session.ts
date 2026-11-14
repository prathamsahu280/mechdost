/**
 * DEMO SIGN-IN (user 2026-11-01: "create the logins now, just a fake one, I'll link Firebase later").
 *
 * Mirrors spec 01 (decision 2026-11-01): sign up once with phone → OTP → name, email, password; afterwards sign
 * in with phone or email + password; forgot password via a phone code or an email link. Everything lives in
 * this browser. The OTP is always 123456, like the Firebase Auth Emulator; seeded logins use DEMO_PASSWORD.
 * Replaced by Firebase Auth + the API's password sign-in in Phase 1; never holds real data.
 */
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
import { customerAllowed } from './customer-blocks';
import { onboardedSellerApplications, shopSlugForApplication } from './shops';
import { demoRoleFor, type RealMe } from '@/lib/auth/real-account';
import { demoStorage } from './store';
import {
  ACCOUNTS,
  accountsSnapshot,
  DEMO_OTP,
  DEMO_PASSWORD,
  isAccount,
  SEEDED_ACCOUNTS,
  SESSION,
  sessionSnapshot,
  type DemoAccount,
  type DemoAddress,
  type DemoVehicle,
} from './session-state';

export * from './session-state';

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

/**
 * An approved seller becomes the owner of their shop when they sign in with the application's phone (the OTP proved
 * it at sign-up), as the API's `linkApplicantOwner` does: once — a shop already claimed by another account stays
 * with it, and staff or partner accounts are never changed (Q89, lifecycle QA 2026-11-14).
 */
function linkApplicantShop(accountId: string) {
  const account = accountsSnapshot().find((a) => a.id === accountId);
  if (account?.role !== 'customer') return;
  const app = onboardedSellerApplications().find((a) => normalisePhone(a.phone) === account.phone);
  if (!app) return;
  const slug = shopSlugForApplication(app.code);
  if (accountsSnapshot().some((a) => a.partner === slug)) return;
  saveAccount({ ...account, role: 'shop', partner: slug });
}

function startSession(accountId: string) {
  linkApplicantShop(accountId);
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
  | { ok: false; reason: 'locked'; until: number }
  | { ok: false; reason: 'blocked' };

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
  // Told only after the right password, so a block never reveals whether an account exists.
  if (!customerAllowed(account.id).signIn) return { ok: false, reason: 'blocked' };
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

/**
 * Real sign-in (Firebase, Q69): the account, cart and portal screens still run on this browser's data, so the
 * signed-in person gets (or keeps) a browser account under their phone number with the name, email, language and
 * landing role from `GET /v1/me`. No password is stored here — it lives only in Firebase. Their vehicles and
 * addresses on this device are kept.
 */
export function adoptRealAccount(me: RealMe): DemoAccount {
  const phone = me.phone ? normalisePhone(me.phone) : null;
  if (!phone) throw new Error('a real account always has an Indian mobile number (phone sign-up)');
  const existing = findAccount(phone);
  const account: DemoAccount = {
    id: existing?.id ?? `real-${globalThis.crypto.randomUUID()}`,
    phone,
    name: (me.name ?? existing?.name ?? '').slice(0, 100),
    email: (me.email ?? existing?.email ?? '').toLowerCase(),
    role: demoRoleFor(me),
    partner: null,
    language: me.language === 'hi' ? 'hi' : 'en',
    vehicles: existing?.vehicles ?? [],
    addresses: existing?.addresses ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  saveAccount(account);
  startSession(account.id);
  return account;
}

export function signOut() {
  demoStorage.write(SESSION, []);
}

/** Where each role lands after signing in. */

/**
 * Only same-site paths are allowed as a post-login destination (open-redirect guard). The URL parser strips tab,
 * CR and LF, so `/<tab>/evil.example` would resolve to another host (review B1): control characters and
 * backslashes are refused outright, and the result must still be on our own origin after parsing.
 */
const PROBE_ORIGIN = 'https://mechdost.invalid';
// eslint-disable-next-line no-control-regex -- the point is to refuse control characters
const CONTROL = /[\u0000-\u001f\u007f]/;
export function safeNext(next: string | null): string | null {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\') || CONTROL.test(next))
    return null;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
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
