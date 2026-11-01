/**
 * DEMO PASSWORDS (decision 2026-11-01 "Sign-in: phone OTP once, then password"). Everything stays in this
 * browser, but passwords are still never stored in plain text: PBKDF2-SHA-256 with a random salt via WebCrypto.
 * Production: Firebase Auth stores the password (scrypt) and the API does the checks below server-side
 * (spec 01 "Password sign-in"). Policy follows NIST SP 800-63B-4 / OWASP: length over composition rules, a
 * blocklist of common and context-specific values, no forced rotation.
 */
import { demoStorage } from './store';

export const PASSWORD_MIN = 8; // inbox Q22: 8 with new-device OTP vs NIST's 15 for password-only
export const PASSWORD_MAX = 64;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const RESET_LINK_MINUTES = 30;

/** Demo-only reduced cost so tests stay fast; production uses Firebase's scrypt parameters. */
const ITERATIONS = 100_000;

export interface PasswordHash {
  salt: string;
  hash: string;
}

/** Most common passwords (subset of public breach lists) plus brand words; checked case-insensitively. */
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '11111111',
  '00000000',
  '87654321',
  '12341234',
  '11223344',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty123',
  'qwertyui',
  'iloveyou',
  'abcd1234',
  'abc12345',
  'welcome1',
  'welcome123',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'admin123',
  'administrator',
  'letmein1',
  'trustno1',
  'changeme',
  '1q2w3e4r',
  'zaq12wsx',
  'asdfghjk',
  'india123',
  'india@123',
  'bharat123',
  'raipur123',
  'mechdost',
  'mechdost1',
  'mechdost123',
  'mechdost@123',
  'jaishreeram',
  'krishna123',
  'ganesh123',
  'saibaba123',
]);

export type PasswordProblem = 'short' | 'long' | 'common' | 'personal';

/** Policy check. `personal` = contains the phone number, the email name or the person's name. */
export function passwordProblem(
  password: string,
  context: { phone?: string; email?: string; name?: string } = {},
): PasswordProblem | null {
  // Count what a person sees as characters (graphemes), so Hindi passphrases and emoji are measured fairly.
  const length = [...new Intl.Segmenter().segment(password)].length;
  if (length < PASSWORD_MIN) return 'short';
  if (length > PASSWORD_MAX) return 'long';
  const lower = password.toLowerCase();
  if (
    COMMON.has(lower) ||
    /^(.)\1+$/.test(password) ||
    /^(0123|1234|2345|3456|4567|5678|6789)+\d*$/.test(password)
  )
    return 'common';
  const parts = [
    context.phone,
    context.phone?.slice(-6),
    context.email?.split('@')[0],
    ...(context.name?.split(/\s+/) ?? []),
  ].filter((p): p is string => typeof p === 'string' && p.length >= 4);
  if (parts.some((p) => lower.includes(p.toLowerCase()))) return 'personal';
  return null;
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt.buffer), hash: await derive(password, salt) };
}

/** Constant-time comparison of two hex digests. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(password: string, stored: PasswordHash): Promise<boolean> {
  return same(await derive(password, fromHex(stored.salt)), stored.hash);
}

// ── Failed-attempt lockout (per account identifier, like the API's per-account limit) ───────────────────────

interface Failures {
  key: string;
  count: number;
  first: string;
  lockedUntil: string | null;
}
const FAILURES = 'mechdost-demo-login-failures';
const isFailures = (v: unknown): v is Failures =>
  typeof v === 'object' && v !== null && 'key' in v && typeof (v as Failures).key === 'string';

export function lockedUntil(key: string, now = Date.now()): number | null {
  const entry = demoStorage.read(FAILURES, isFailures).find((f) => f.key === key);
  const until = entry?.lockedUntil ? new Date(entry.lockedUntil).getTime() : 0;
  return until > now ? until : null;
}

export function recordFailure(key: string, now = Date.now()) {
  const list = demoStorage.read(FAILURES, isFailures).filter((f) => f.key !== key);
  const old = demoStorage.read(FAILURES, isFailures).find((f) => f.key === key);
  const windowOpen = old && now - new Date(old.first).getTime() < LOCK_MINUTES * 60_000;
  const count = windowOpen ? old.count + 1 : 1;
  const first = windowOpen ? old.first : new Date(now).toISOString();
  const locked = count >= MAX_FAILURES ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : null;
  demoStorage.write(FAILURES, [...list, { key, count, first, lockedUntil: locked }].slice(-50));
}

export function clearFailures(key: string) {
  demoStorage.write(
    FAILURES,
    demoStorage.read(FAILURES, isFailures).filter((f) => f.key !== key),
  );
}

// ── Email reset links (single use, expiring) ─────────────────────────────────────────────────────────────────

interface ResetLink {
  token: string;
  accountId: string;
  expiresAt: string;
}
const RESETS = 'mechdost-demo-reset-links';
const isReset = (v: unknown): v is ResetLink =>
  typeof v === 'object' && v !== null && 'token' in v && typeof (v as ResetLink).token === 'string';

export function createResetLink(accountId: string, now = Date.now()): string {
  const token = toHex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  const live = demoStorage
    .read(RESETS, isReset)
    .filter((r) => r.accountId !== accountId && new Date(r.expiresAt).getTime() > now);
  demoStorage.write(RESETS, [
    ...live,
    { token, accountId, expiresAt: new Date(now + RESET_LINK_MINUTES * 60_000).toISOString() },
  ]);
  return token;
}

/** Returns the account id and consumes the link; null if unknown, used or expired. */
export function consumeResetLink(token: string, now = Date.now()): string | null {
  const links = demoStorage.read(RESETS, isReset);
  const link = links.find((r) => r.token === token);
  demoStorage.write(
    RESETS,
    links.filter((r) => r.token !== token),
  );
  if (!link || new Date(link.expiresAt).getTime() <= now) return null;
  return link.accountId;
}

export function peekResetLink(token: string, now = Date.now()): boolean {
  const link = demoStorage.read(RESETS, isReset).find((r) => r.token === token);
  return Boolean(link && new Date(link.expiresAt).getTime() > now);
}
