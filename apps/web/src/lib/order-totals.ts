/**
 * The two totals of a customer order (QA 2026-11-16, bug 14): what was placed, and what is still payable once rejected
 * or cancelled parts are taken out. `payablePaise` is null when nothing was taken out (one line is enough then).
 */
export function orderTotalLines(o: { placedTotalPaise: number; totalPaise: number }): {
  placedPaise: number;
  payablePaise: number | null;
} {
  return {
    placedPaise: o.placedTotalPaise,
    payablePaise: o.totalPaise === o.placedTotalPaise ? null : o.totalPaise,
  };
}

/** The total in the account orders list: what was placed, also once parts were rejected (QA pass 4, bug 5). */
export function orderListTotalPaise(o: { placedTotalPaise: number; totalPaise: number }): number {
  return o.placedTotalPaise;
}
