/**
 * Money helpers. All amounts are integer paise (₹1 = 100 paise); rates are basis points (18% = 1800).
 * Never use floats for money. See docs/research/data-integrity.md §6 and docs/specs/14-data-integrity.md.
 */

export type Paise = number;
export type BasisPoints = number;

export interface GstSplit {
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

function assertNonNegInt(name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${name} must be a non-negative safe integer, got ${n}`);
}

/** Parse a rupee amount string ("1,250.05") into paise without floating-point error. */
export function toPaise(rupees: string): Paise {
  const s = rupees.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new RangeError(`Invalid rupee amount: "${rupees}"`);
  const [whole = '0', frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  assertNonNegInt('amount', paise);
  return paise;
}

const groupFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Format paise as Indian rupees with lakh/crore grouping, e.g. 12345600 → "₹1,23,456.00". */
export function formatINR(paise: Paise): string {
  if (!Number.isSafeInteger(paise)) throw new RangeError(`paise must be a safe integer, got ${paise}`);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = groupFormatter.format(Math.floor(abs / 100));
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}₹${rupees}.${fraction}`;
}

/** Integer division rounding half up, for non-negative integers. */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  assertNonNegInt('numerator', numerator);
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new RangeError('denominator must be > 0');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * Split a GST-inclusive gross price. Intra-state: CGST = SGST (computed once and copied so they are always
 * equal); inter-state: IGST. Parts always sum exactly to the gross so the displayed total is the charged total.
 */
export function splitInclusiveGst(gross: Paise, rateBp: BasisPoints, interState: boolean): GstSplit {
  assertNonNegInt('gross', gross);
  assertNonNegInt('rateBp', rateBp);
  if (interState) {
    const igst = roundHalfUpDiv(gross * rateBp, 10_000 + rateBp);
    return { taxable: gross - igst, cgst: 0, sgst: 0, igst };
  }
  const half = roundHalfUpDiv(gross * rateBp, 2 * (10_000 + rateBp));
  return { taxable: gross - 2 * half, cgst: half, sgst: half, igst: 0 };
}

/** Tax on top of a taxable value (B2B / exclusive pricing). */
export function splitExclusiveGst(taxable: Paise, rateBp: BasisPoints, interState: boolean): GstSplit {
  assertNonNegInt('taxable', taxable);
  assertNonNegInt('rateBp', rateBp);
  if (interState) return { taxable, cgst: 0, sgst: 0, igst: roundHalfUpDiv(taxable * rateBp, 10_000) };
  const half = roundHalfUpDiv(taxable * rateBp, 20_000);
  return { taxable, cgst: half, sgst: half, igst: 0 };
}

/**
 * Fowler-style allocation: split `total` across `weights` proportionally using integer maths, handing leftover
 * paise one at a time to the largest remainders (ties → larger weight → lower index). Sum always equals total.
 * All-zero weights are treated as equal weights.
 */
export function allocate(total: Paise, weights: readonly number[]): Paise[] {
  assertNonNegInt('total', total);
  if (weights.length === 0) throw new RangeError('weights must not be empty');
  weights.forEach((w, i) => {
    assertNonNegInt(`weights[${i}]`, w);
  });
  const effective = weights.every((w) => w === 0) ? weights.map(() => 1) : [...weights];
  const sum = effective.reduce((a, b) => a + b, 0);

  const parts = effective.map((w) => Math.floor((total * w) / sum));
  const remainders = effective.map((w, i) => ({ i, w, r: (total * w) % sum }));
  const leftover = total - parts.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.r - a.r || b.w - a.w || a.i - b.i);
  // leftover < weights.length always (each floor loses < 1 paisa), so one pass suffices.
  for (const { i } of remainders.slice(0, leftover)) parts[i] = (parts[i] ?? 0) + 1;
  return parts;
}

/** Round an invoice grand total to the nearest rupee (Section 170 CGST), half up, with the signed round-off. */
export function invoiceRoundOff(total: Paise): { rounded: Paise; roundOff: Paise } {
  assertNonNegInt('total', total);
  const rounded = roundHalfUpDiv(total, 100) * 100;
  return { rounded, roundOff: rounded - total };
}
