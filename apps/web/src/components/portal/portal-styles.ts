/**
 * Shared class strings for the portal screens. Kept apart from `portal-guard.tsx` (a client component with
 * translations) so importing a style never pulls the guard's message namespaces into a page's dependency graph.
 */
export const portalCard = 'rounded-card border border-line-card bg-surface p-5 shadow-card';
export const portalPrimary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
export const portalQuiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';
export const portalField =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted';
