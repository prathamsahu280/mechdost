'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Steps as an ordered list (design 2026-11-27 § 4): done / now / later, "Step 3 of 6: Work" in words, the current
 * step marked `aria-current="step"`. `current` is 0-based; `current >= steps.length` means all done.
 */
export function StepRail({
  steps,
  current,
  label,
}: {
  steps: readonly string[];
  current: number;
  label: string;
}) {
  const t = useTranslations('partnerKit');
  const total = steps.length;
  const now = Math.min(current, total - 1);
  return (
    <div className="grid gap-2">
      <ol aria-label={label} className="flex items-center gap-1">
        {steps.map((step, i) => {
          const done = i < current;
          const isNow = i === current;
          return (
            <li
              key={step}
              aria-current={isNow ? 'step' : undefined}
              className="flex min-w-0 flex-1 items-center gap-1"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold tabular-nums ${
                  done
                    ? 'bg-success text-surface'
                    : isNow
                      ? 'bg-navy text-white ring-2 ring-accent'
                      : 'bg-pill text-muted'
                }`}
              >
                {done ? <Check aria-hidden="true" className="size-4" /> : i + 1}
                <span className="sr-only">
                  {step}
                  {done ? `, ${t('step_done')}` : ''}
                </span>
              </span>
              {i < total - 1 ? (
                <span
                  aria-hidden="true"
                  className={`h-1 min-w-2 flex-1 rounded-pill ${done ? 'bg-success' : 'bg-pill'}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-bold text-ink">
        {current >= total ? t('steps_all_done') : t('step_of', { n: now + 1, total, name: steps[now] ?? '' })}
      </p>
    </div>
  );
}
