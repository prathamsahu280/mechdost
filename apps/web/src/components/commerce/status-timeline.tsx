import { Check } from 'lucide-react';

/**
 * Vertical status stepper (design system "steps/progress"): done steps get a check, the current step is
 * highlighted and announced with aria-current, future steps are muted. Pure presentation — works on server and client.
 */
export function StatusTimeline({
  label,
  steps,
  current,
  currentLabel,
}: {
  label: string;
  steps: { key: string; title: string; detail: string }[];
  current: number;
  currentLabel: string;
}) {
  return (
    <ol aria-label={label} className="relative space-y-0">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.key}
            className="relative grid grid-cols-[32px_1fr] gap-4 pb-6 last:pb-0"
            aria-current={active ? 'step' : undefined}
          >
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`absolute top-8 bottom-0 left-[15px] w-0.5 ${done ? 'bg-success' : 'bg-line'}`}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-xs font-extrabold transition-colors duration-[var(--duration-slow)] ${
                done
                  ? 'border-success bg-success text-white'
                  : active
                    ? 'border-accent-button bg-accent-soft text-accent-soft-text'
                    : 'border-line bg-surface text-muted'
              }`}
            >
              {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              {active ? (
                <span className="absolute inset-0 animate-ping rounded-full border-2 border-accent-button opacity-40" />
              ) : null}
            </span>
            <div className="pt-1">
              <p className={`font-heading font-bold ${done || active ? 'text-ink' : 'text-muted'}`}>
                {step.title}
                {active ? <span className="sr-only"> ({currentLabel})</span> : null}
              </p>
              {done || active ? <p className="mt-0.5 text-sm text-muted">{step.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
