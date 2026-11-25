'use client';

import { useTranslations } from 'next-intl';
import type { VehicleSegment } from '@mechdost/shared/vehicle-segments';

export interface SegmentChip {
  code: VehicleSegment;
  name: string;
  count: number;
}

/**
 * The shop's vehicle-type chips (design 2026-11-25, spec 02 "Vehicle segments"): several can be on, each shows how many
 * products it adds for the current search and category, and none on means every vehicle. Plain toggle buttons
 * (`aria-pressed`), so the keyboard and screen readers get the native behaviour; each is 44 px high. On a phone the row
 * scrolls sideways inside its own box, never the page. Segments with no product are left out unless chosen.
 */
export function SegmentChips({
  chips,
  selected,
  onToggle,
  onClear,
}: {
  chips: readonly SegmentChip[];
  selected: readonly VehicleSegment[];
  onToggle: (code: VehicleSegment) => void;
  onClear: () => void;
}) {
  const t = useTranslations('segments');
  const shown = chips.filter((c) => c.count > 0 || selected.includes(c.code));
  if (shown.length === 0) return null;
  const chip = (active: boolean) =>
    `press inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-4 text-[13px] font-bold whitespace-nowrap transition-colors duration-[var(--duration-base)] ${
      active
        ? 'border-accent-soft bg-accent-soft text-accent-soft-text'
        : 'border-line-card bg-surface text-ink hover:bg-pill'
    }`;
  return (
    <div role="group" aria-labelledby="shop-segments-label" data-slot="segment-chips" className="mt-4">
      <p id="shop-segments-label" className="text-xs font-bold text-muted">
        {t('groupLabel')}
      </p>
      <ul className="-mx-[5%] mt-1.5 flex gap-2 overflow-x-auto px-[5%] pb-2">
        <li>
          <button
            type="button"
            aria-pressed={selected.length === 0}
            data-track="shop_segment_all"
            onClick={onClear}
            className={chip(selected.length === 0)}
          >
            {t('all')}
          </button>
        </li>
        {shown.map((c) => {
          const active = selected.includes(c.code);
          return (
            <li key={c.code}>
              <button
                type="button"
                aria-pressed={active}
                data-segment={c.code}
                onClick={() => {
                  onToggle(c.code);
                }}
                className={chip(active)}
              >
                {t('chip', { name: c.name, count: c.count })}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
