import type { CSSProperties } from 'react';

/**
 * Scroll-reveal stagger (user 2026-11-02: "add proper cool scroll animations"). Sets `--i` for the `.reveal`
 * utility in globals.css, which offsets the item's scroll-driven animation range so a row cascades in.
 * CSS only (animation-timeline: view()) — no JS, disabled under prefers-reduced-motion.
 */
export function stagger(index: number): CSSProperties {
  return { '--i': Math.min(index, 6) } as CSSProperties;
}
