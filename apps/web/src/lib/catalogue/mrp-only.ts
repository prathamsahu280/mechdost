import type { CardView } from './view';

/**
 * "MRP ₹x" for a product that has no shop offer yet (spec 02): the label key and amount to show, or null when there
 * is a price (the normal price block applies) or no MRP at all (today's rendering, no blank and no ₹0).
 */
export function mrpOnly(
  p: Pick<CardView, 'price' | 'mrpFrom'>,
): { key: 'mrp' | 'mrpFrom'; paise: number } | null {
  if (p.price || !p.mrpFrom || p.mrpFrom.paise <= 0) return null;
  return { key: p.mrpFrom.varies ? 'mrpFrom' : 'mrp', paise: p.mrpFrom.paise };
}
