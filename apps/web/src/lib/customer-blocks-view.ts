/**
 * View helpers for Admin → Customers in real sign-in builds (research/admin-console.md §5; Stream D 2026-11-14).
 */
export type BlockErrorKey =
  | 'customersErr_already'
  | 'customersErr_ends_at'
  | 'customersErr_reason'
  | 'customersErr_liftReason'
  | 'customersErr_not_customer';

/** API block codes → the screen's `portal.customersErr_*` messages; null = use the common message. */
export function blockErrorKey(code: string): BlockErrorKey | null {
  switch (code) {
    case 'ALREADY_BLOCKED':
      return 'customersErr_already';
    case 'BLOCK_ENDS_AT':
      return 'customersErr_ends_at';
    case 'BLOCK_REASON':
      return 'customersErr_reason';
    case 'LIFT_REASON':
      return 'customersErr_liftReason';
    case 'BLOCK_SELF':
    case 'BLOCK_PARTNER_FULL':
    case 'NOT_FOUND':
      return 'customersErr_not_customer';
    default:
      return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The customer account id as typed (spaces dropped, lower case), or null when it is not one. */
export function customerIdFrom(raw: string): string | null {
  const id = raw.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/** A chosen end day (yyyy-mm-dd) → the end of that day in IST as an ISO instant; '' → no end. */
export function endsAtFrom(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = new Date(`${day}T23:59:59+05:30`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
