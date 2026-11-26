import type { ReactNode } from 'react';

/**
 * A box that scrolls sideways (a wide table on a phone). It is a named region and a tab stop so a keyboard user can
 * reach it and scroll with the arrow keys (WCAG 2.1.1; axe "scrollable-region-focusable"); the shared focus ring
 * from the global `:focus-visible` rule shows when it has focus. Give it `label` or `labelledBy`.
 */
export function ScrollRegion({
  label,
  labelledBy,
  className = '',
  children,
}: {
  label?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`relative overflow-x-auto ${className}`.trim()}
    >
      {children}
    </div>
  );
}
