/**
 * Pure rules of the size picker (user 2026-11-24): the `?size=` deep link (the radio keys are the browser's own: the picker is native radios). Kept apart from
 * the island so they are tested without a browser and add nothing to the pages that have one size.
 */
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * The size a `?size=` value names: its SKU or its size text (case and spaces ignored). Anything else gives `null`,
 * so a stale or mistyped link opens the product on its default size, never an error.
 */
export function resolveSizeParam(
  variants: readonly { sku: string; label: string }[],
  param: string | null,
): string | null {
  const want = param ? squash(param) : '';
  if (!want) return null;
  return variants.find((v) => squash(v.sku) === want || squash(v.label) === want)?.sku ?? null;
}

/** The address query with `size` set to `sku`, keeping every other parameter (the page URL stays the canonical one). */
export function withSizeParam(search: string, sku: string): string {
  const params = new URLSearchParams(search);
  params.set('size', sku);
  return `?${params.toString()}`;
}
