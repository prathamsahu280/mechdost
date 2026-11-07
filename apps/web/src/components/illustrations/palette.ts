/**
 * Illustration palette: CSS variables only, so every drawing follows the light and dark themes. The set is flat
 * duotone (greens + neutrals) with one warm highlight (`star`) used sparingly for lights and sparks.
 */
export const C = {
  accent: 'var(--color-accent)',
  deep: 'var(--color-accent-button)',
  mint: 'var(--color-accent-light)',
  pale: 'var(--color-accent-soft)',
  ink: 'var(--color-ink)',
  muted: 'var(--color-muted)',
  surface: 'var(--color-surface)',
  pill: 'var(--color-pill)',
  line: 'var(--color-line-card)',
  star: 'var(--color-star)',
  /* Rubber and metal stay dark/light in both themes (a white tyre reads wrong on dark); override if needed. */
  tyre: 'var(--ill-tyre, #1d2b26)',
  rim: 'var(--ill-rim, #d5ddd9)',
} as const;

/** Inline style for groups that rotate in place (wheels): rotate around their own centre. */
export const SPIN_ORIGIN = { transformBox: 'fill-box', transformOrigin: 'center' } as const;
