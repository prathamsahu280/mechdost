/**
 * Which part of a split order the link names (`/orders/<code>-2`, QA pass 4, bug 10): the whole order is shown, and
 * this part is marked and scrolled into view. Null for the group code, an unknown part, or an order with one part.
 */
export function requestedPartCode(code: string, partCodes: readonly string[]): string | null {
  return partCodes.length > 1 && partCodes.includes(code) ? code : null;
}
