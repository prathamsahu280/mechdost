import { CUSTOMER_ROLE, isRoleKey, ROLES, type Grant } from './rbac';

/**
 * Sign-in rules shared by the web and the API (spec 01 "Password sign-in", decision 2026-11-01).
 */

/** An Indian mobile number (E.164) or an email address (lower case). */
export type SignInIdentifier = { kind: 'phone'; value: string } | { kind: 'email'; value: string };

/**
 * Printable ASCII only (no spaces or a second @): look-alike letters from other scripts, fullwidth forms and
 * invisible characters are refused, so two emails that look the same can never be two accounts (security review
 * 2026-11-14, Unicode collisions).
 */
const EMAIL = /^[!-?A-~]+@[!-?A-~]+\.[!-?A-~]+$/;
const INDIAN_MOBILE = /^(?:\+?91|0?91|0)?([6-9]\d{9})$/;

/** Read what someone typed in "Phone number or email". Phones accept spaces, dashes, brackets, +91 and 0. */
export function parseSignInIdentifier(input: string): SignInIdentifier | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 254) return null;
  if (raw.includes('@')) {
    const value = raw.toLowerCase();
    return EMAIL.test(value) ? { kind: 'email', value } : null;
  }
  const m = INDIAN_MOBILE.exec(raw.replace(/[\s\-()]/g, ''));
  return m?.[1] ? { kind: 'phone', value: `+91${m[1]}` } : null;
}

/**
 * Staff grants are the ones not tied to a shop or workshop (platform or city scope), including roles an admin
 * created (no code list, learning L17). Holding one means signing in with password **and** a phone code. A system
 * role says itself whether it is staff: the `mechanic` grant (Ustaad Network member, scope self) is not, although it
 * names no shop or workshop (spec 23; it would otherwise be withheld from normal sessions).
 */
export function isStaffGrant(
  g: Pick<Grant, 'role' | 'shopId' | 'workshopId'> & Partial<Pick<Grant, 'cityId' | 'permissions'>>,
): boolean {
  if (isRoleKey(g.role)) return ROLES[g.role].staff;
  return g.role !== CUSTOMER_ROLE && g.shopId === null && g.workshopId === null;
}

/** The phone code of a staff sign-in must be this fresh when the second step reaches the API (seconds). */
export const STAFF_CODE_MAX_AGE_SECONDS = 300;
/** A staff session lasts one working day; then password + code again (seconds). */
export const STAFF_SESSION_MAX_AGE_SECONDS = 12 * 3600;
/** Custom-token claim that marks a session made by both staff steps. */
export const STAFF_2FA_CLAIM = 'staff_2fa';
