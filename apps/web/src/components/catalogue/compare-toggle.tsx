'use client';

import { track } from '@/lib/analytics';
import { signal } from '@/lib/compare/signal';
import { addToCompare, readCompare, removeFromCompare, useCompare } from '@/lib/compare/store';

export interface CompareToggleLabels {
  /** The visible word, "Compare". */
  toggle: string;
  /** Accessible name with the product, e.g. "Compare Castrol Activ 4T" (contains the visible word). */
  toggleName: string;
  /** "Added to compare ({count} of 4)" with {count} left in for the island to fill. */
  added: string;
  removed: string;
  /** "Added to compare — pick one more": shown next to the box while it is the only product, and announced. */
  hint: string;
}

/**
 * "☐ Compare" (user ruling 2026-11-15: "Checkbox style", like Amazon and Flipkart): a real checkbox with its word,
 * on its own line under the price, separate from "Add to cart", on product cards and the product page alike.
 * Checked = in the compare list. The whole label is the target (≥ 44 px tall).
 *
 * It never shows a message of its own: another category, a full list or a refused save is signalled to the compare
 * tray, which asks or tells once, and the box stays unchecked until the tray's "Start new" (it is controlled by
 * the shared list, so every card follows at once). Added/removed are read out by the loader's one live region.
 * The tray appears from two products, so the first tick gets a short visible hint next to the box (user 2026-11-15,
 * Q170), which is also what the live region reads; it goes when a second product is added or the first is unticked.
 * Kept small: it ships on every shop page (JS budget, spec 16); its look is `.compare-check` in globals.css.
 */
export function CompareToggle({
  slug,
  category,
  categoryName,
  labels,
  className = '',
}: {
  slug: string;
  /** Category slug: the list holds one category at a time. */
  category: string;
  /** The category's display name in the page language (shown in the tray). */
  categoryName: string | null;
  labels: CompareToggleLabels;
  className?: string;
}) {
  const { slugs } = useCompare();
  const on = slugs.includes(slug);

  return (
    <label data-slot="compare-toggle" className={`compare-check ${className}`}>
      <input
        type="checkbox"
        checked={on}
        aria-label={labels.toggleName}
        data-compare-toggle={slug}
        onChange={(e) => {
          if (on) {
            removeFromCompare(slug);
            track('compare_removed', { slug, count: readCompare().slugs.length });
            signal({ say: labels.removed });
            return;
          }
          const label = categoryName ? { name: categoryName, lang: document.documentElement.lang } : {};
          const r = addToCompare(slug, category, label);
          if (r === 'added') {
            const count = readCompare().slugs.length;
            track('compare_added', { slug, category, count });
            signal({ say: count === 1 ? labels.hint : labels.added.replace('{count}', String(count)) });
          } else
            signal({
              ask: r === 'other_category' ? 'switch' : r,
              slug,
              category,
              ...label,
              origin: e.currentTarget,
            });
        }}
      />
      {labels.toggle}
      {on && slugs.length === 1 ? (
        <span data-compare-hint className="text-xs font-normal text-muted">
          {labels.hint}
        </span>
      ) : null}
    </label>
  );
}
