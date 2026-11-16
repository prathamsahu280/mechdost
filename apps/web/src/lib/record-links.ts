/**
 * Links for one record (order, quote, service request, support ticket) seen by someone who is not signed in
 * (QA pass 3, 2026-11-16). Pure and import-free so any screen can use it without growing a bundle graph.
 */

/** `/login?next=…` that comes back to `returnTo` (path and query). The login page re-checks `next` (`safeNext`). */
export function loginHref(prefix: string, returnTo: string): string {
  return `${prefix}/login?next=${encodeURIComponent(returnTo)}`;
}

/** An order page code: the order (`MD-RPR-2026-7K3Q9X`) or one shop's part of it (`…-1`, the code in order emails). */
const ORDER_PAGE_CODE = /^MD-[A-Z]{3}-\d{4}-[0-9A-Z]{6}(-\d{1,2})?$/;

/** The code from the URL when it is an order or per-shop code, else `''` (never looked up). */
export function orderPageCode(code: string): string {
  return ORDER_PAGE_CODE.test(code) ? code : '';
}

/** The order that holds a per-shop code: the API tracks the whole order, whose page lists every shop's part. */
export function orderGroupCode(code: string): string {
  return code.replace(/-\d{1,2}$/, '');
}
