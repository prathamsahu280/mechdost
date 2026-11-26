/** Amount band for analytics (rupees): never the amount itself (rule 16, pseudonymous events). */
export type SavingsBand = 'zero' | 'lt_100' | 'lt_500' | 'lt_2000' | 'gte_2000';
export function savingsBand(totalPaise: number): SavingsBand {
  if (totalPaise <= 0) return 'zero';
  if (totalPaise < 100_00) return 'lt_100';
  if (totalPaise < 500_00) return 'lt_500';
  if (totalPaise < 2_000_00) return 'lt_2000';
  return 'gte_2000';
}
