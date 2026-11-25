/**
 * The storefront "Edit" shortcut for catalogue staff (user 2026-11-25; spec 08): pure rules, no React, no imports, so
 * the lazy chunk and the unit tests share one copy and nothing here weighs on the shop bundles.
 *
 * Who sees the button is decided by the API, never by the browser: the signed-in session's permissions come from a
 * live `GET /v1/me`, and the button shows only when they include the permission the editor's routes require. The
 * stored sign-in record is only a hint for whether to ask at all (guests and customers never cause a request).
 */

/** The permission every `/admin/catalogue/*` route requires (`apps/api/src/routes/admin-catalogue.ts`). */
export const CATALOGUE_EDIT_PERMISSION = 'products:write';

export function canEditCatalogue(permissions: readonly string[]): boolean {
  return permissions.includes(CATALOGUE_EDIT_PERMISSION);
}

/** The part of the live `/v1/me` answer that matters here, checked by hand (no Zod in the browser bundles). */
export function meAllowsCatalogueEdit(me: unknown): boolean {
  if (typeof me !== 'object' || me === null || !('permissions' in me)) return false;
  const { permissions } = me;
  return (
    Array.isArray(permissions) &&
    permissions.every((p) => typeof p === 'string') &&
    canEditCatalogue(permissions)
  );
}

/** Only a staff session is worth a `/me` request: guests, customers, shops and workshops never trigger one. */
export function shouldProbeSession(role: string | undefined): boolean {
  return role === 'admin';
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** A catalogue slug is safe to put in an API path and in the address; anything else is ignored. */
export function isEditableSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/** Unprefixed path of the product's editor in the admin console (the server adds the locale prefix). Slug only. */
export function adminEditPath(slug: string): string {
  return `/admin/catalogue?product=${slug}`;
}

/** The product the editor should open on arrival: the `?product=` slug of the address, when well formed. */
export function editableSlugFromSearch(search: string): string | null {
  const slug = new URLSearchParams(search).get('product');
  return slug !== null && isEditableSlug(slug) ? slug : null;
}
