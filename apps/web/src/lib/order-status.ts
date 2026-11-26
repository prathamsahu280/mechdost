/**
 * The customer's view of an API order status (spec 04): the six-step stepper and the label shown in lists. Order
 * states come from `ORDER_STATES` in `@mechdost/shared/state`; anything new falls back to the first step.
 */
export const ORDER_STEPS = ['placed', 'routing', 'confirmed', 'packed', 'shipped', 'delivered'] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];

const STEP_OF: Record<string, number> = {
  placed: 0,
  awaiting_shop: 1,
  needs_rerouting: 1,
  confirmed: 2,
  packed: 3,
  // Agent-delivered parts (spec 24): waiting for the delivery partner still reads "Packed" for the customer; a part
  // brought back after a failed delivery stays on "Out for delivery" and the delivery block says what happened.
  ready_for_pickup: 3,
  returned: 4,
  shipped: 4,
  out_for_delivery: 4,
  // Delivered: every step is done.
  delivered: ORDER_STEPS.length,
};

/** The stepper's current index for an API status (`ORDER_STEPS.length` once delivered). */
export function orderStepIndex(status: string): number {
  return STEP_OF[status] ?? 0;
}

export function isClosedStatus(status: string): boolean {
  return status === 'cancelled' || status === 'rejected';
}

/**
 * An open part the customer cannot cancel here (the admin's self-cancel rule is off, or the part is past packing): the
 * page says so and points to support instead of showing nothing (QA 2026-11-16, bug 9; spec 05).
 */
export function cancelHelpShown(part: { status: string; canCancel: boolean }): boolean {
  return !part.canCancel && !isClosedStatus(part.status) && part.status !== 'delivered';
}

/** The `order` locale key that names an API status for the customer. */
export function orderStatusKey(status: string): `stage_${OrderStep}` | 'cancelledTitle' | 'rejectedTitle' {
  if (status === 'cancelled') return 'cancelledTitle';
  if (status === 'rejected') return 'rejectedTitle';
  const step = ORDER_STEPS[Math.min(orderStepIndex(status), ORDER_STEPS.length - 1)] ?? 'placed';
  return `stage_${step}`;
}
