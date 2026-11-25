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

/** The rim size in inches of a tyre size label ("90/90-12 54J TL" → 12, "175/65 R14" → 14); null for anything else. */
export function rimOf(label: string): number | null {
  const m = /(?:-|\bR\s?|\d\s?R\s?)(\d{2})(?!\d)/i.exec(label);
  const rim = m ? Number(m[1]) : NaN;
  return rim >= 8 && rim <= 24 ? rim : null;
}

/** Sizes the picker lists in one block until there are more than this many (a long list is hard to scan). */
export const SIZE_GROUP_MIN = 6;

export interface SizeGroup<T> {
  /** Rim in inches; null = the sizes that name none ("Other sizes"), always last. */
  rim: number | null;
  items: T[];
}

/**
 * Groups a long list of tyre sizes by rim ("12 inch"), smallest rim first, each group in the order given. Null (one
 * plain list) when there are few sizes, when no size names a rim (packs: "1 L", "3.5 L") or when all share one rim.
 */
export function groupSizesByRim<T extends { label: string }>(sizes: readonly T[]): SizeGroup<T>[] | null {
  if (sizes.length <= SIZE_GROUP_MIN) return null;
  const byRim = new Map<number | null, T[]>();
  for (const s of sizes) {
    const rim = rimOf(s.label);
    byRim.set(rim, [...(byRim.get(rim) ?? []), s]);
  }
  const rims = [...byRim.keys()].filter((r): r is number => r !== null).sort((a, b) => a - b);
  if (rims.length < 2) return null;
  const groups: SizeGroup<T>[] = rims.map((rim) => ({ rim, items: byRim.get(rim) ?? [] }));
  const rest = byRim.get(null);
  if (rest) groups.push({ rim: null, items: rest });
  return groups;
}
