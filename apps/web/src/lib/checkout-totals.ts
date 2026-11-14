/**
 * What the checkout summary shows and the button says (dark-pattern audit 2026-11-15, F1): the cash-on-delivery fee is
 * its own line and counts only for cash on delivery, and paying online uses the online total. Integer paise.
 */
export function checkoutTotals(input: {
  method: 'cod' | 'online';
  /** The cash-on-delivery total (it already includes the fee). */
  totalPaise: number;
  codFeePaise: number;
  onlineTotalPaise: number;
  coinDiscountPaise: number;
}): { feePaise: number; payablePaise: number } {
  const cod = input.method === 'cod';
  return {
    feePaise: cod ? input.codFeePaise : 0,
    payablePaise: (cod ? input.totalPaise : input.onlineTotalPaise) - input.coinDiscountPaise,
  };
}
