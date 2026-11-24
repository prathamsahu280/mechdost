/** How a product photo was picked (spec 12 `product_photo_selected`). */
export type PhotoMethod = 'thumb' | 'arrow' | 'swipe' | 'key';

/**
 * Where an arrow or a left/right key moves the gallery. The ends do not wrap: past the first or last photo the index
 * stays and the matching arrow is disabled, so a keyboard user is never thrown from one end to the other. `null` means
 * "this key does nothing".
 */
export function stepIndex(active: number, total: number, key: string): number | null {
  const to = key === 'ArrowLeft' ? active - 1 : key === 'ArrowRight' ? active + 1 : null;
  return to !== null && to >= 0 && to < total ? to : null;
}

/** The photo a scroll-snap track is showing, from its scroll position; null when it cannot be told yet. */
export function indexFromScroll(scrollLeft: number, width: number, total: number): number | null {
  if (width <= 0 || total <= 0) return null;
  const index = Math.round(scrollLeft / width);
  return index >= 0 && index < total ? index : null;
}
