/**
 * Customer blocking (decision 2026-11-01 "customer blocking seems good"; research/admin-console.md §2.5, §5).
 * Three levels, strongest first: `full` (cannot sign in), `orders` (can browse and raise support requests, cannot
 * order or book), `cod_only` (must prepay; cash on delivery refused). Every block carries a reason **code**
 * (ML-ready, hard rule 16), an optional note and end date, and the staff member who set it.
 */
export const CUSTOMER_BLOCK_LEVELS = ['cod_only', 'orders', 'full'] as const;
export type CustomerBlockLevel = (typeof CUSTOMER_BLOCK_LEVELS)[number];

export const CUSTOMER_BLOCK_REASONS = [
  'cod_refused', // refused cash-on-delivery parcels (RTO)
  'fake_orders',
  'payment_fraud',
  'abusive_behaviour', // towards staff, shops, workshops or delivery staff
  'policy_violation',
  'account_security', // suspected takeover; protect the customer
  'other',
] as const;
export type CustomerBlockReason = (typeof CUSTOMER_BLOCK_REASONS)[number];

/** What a set of active block levels forbids. */
export function blockEffects(levels: readonly CustomerBlockLevel[]) {
  const full = levels.includes('full');
  const orders = full || levels.includes('orders');
  return { signIn: !full, order: !orders, cod: !orders && !levels.includes('cod_only') };
}
