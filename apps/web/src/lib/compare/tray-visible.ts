/** The compare bar appears from this many picked products (decision 2026-11-15: one product has nothing to compare). */
export const COMPARE_TRAY_MIN = 2;

/**
 * Whether the compare bar is on screen: from two products, or while a question or notice is open (picking another
 * category, a full list, a refused save, a cart limit), and never on the compare, checkout and portal pages. With
 * one product the card's own line ("Pick one more to compare") tells the shopper what to do next.
 */
export function trayVisible({
  count,
  hiddenPage,
  asking,
}: {
  count: number;
  hiddenPage: boolean;
  asking: boolean;
}): boolean {
  return !hiddenPage && (count >= COMPARE_TRAY_MIN || asking);
}
