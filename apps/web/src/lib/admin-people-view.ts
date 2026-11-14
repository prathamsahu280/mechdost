/**
 * Small pure helpers of the admin people screens (staff, customers, audit): API error codes to message keys and the
 * IST date-time format. Kept out of the components so they are unit-tested.
 */
export type PeopleErrorKey =
  | 'err_selfChange'
  | 'err_superAdminOnly'
  | 'err_lastSuperAdmin'
  | 'err_alreadyHeld'
  | 'err_scope'
  | 'err_notStaffRole'
  | 'err_phone'
  | 'err_reason'
  | 'err_noAccount'
  | 'err_invalid'
  | 'err_search'
  | 'err_code'
  | 'err_date'
  | 'err_filter'
  | 'err_cursor';

const BY_CODE: Record<string, PeopleErrorKey> = {
  STAFF_SELF_CHANGE: 'err_selfChange',
  ROLE_SUPER_ADMIN_ONLY: 'err_superAdminOnly',
  LAST_SUPER_ADMIN: 'err_lastSuperAdmin',
  ROLE_ALREADY_HELD: 'err_alreadyHeld',
  ROLE_SCOPE: 'err_scope',
  ROLE_NOT_STAFF: 'err_notStaffRole',
  PHONE_INVALID: 'err_phone',
  REASON_REQUIRED: 'err_reason',
  NOT_FOUND: 'err_noAccount',
  VALIDATION: 'err_invalid',
  SEARCH_QUERY: 'err_search',
  AUDIT_CODE: 'err_code',
  AUDIT_DATE: 'err_date',
  AUDIT_FILTER: 'err_filter',
  INVALID_CURSOR: 'err_cursor',
};

/** The screen's own message for an API error code, or null (the screen then uses the shared common errors). */
export function peopleErrorKey(code: string): PeopleErrorKey | null {
  return BY_CODE[code] ?? null;
}

export { REFUND_STATES as REFUND_STATUSES } from '@mechdost/shared/state';
export const TICKET_STATUSES = ['open', 'in_review', 'awaiting_customer', 'resolved', 'closed'] as const;
export const USER_STATUSES = ['active', 'deactivated', 'deleted'] as const;
export const CONSENT_PURPOSES = [
  'account',
  'marketing',
  'analytics',
  'location',
  'share_with_partner',
  'whatsapp',
] as const;

/** `value` when it is one of `list` (so a typed message key can be built from it), else undefined. */
export function statusOf<T extends string>(list: readonly T[], value: string): T | undefined {
  return list.find((x) => x === value);
}

/** `12 Nov 2026, 3:05 pm` in IST, in the page language. */
export function formatDateTimeIst(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}
