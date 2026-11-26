import type { ReactNode } from 'react';
import { BADGE_TONE_CLASS, statusToneClass, type BadgeTone } from '@/lib/admin-status-tone';

/**
 * Shared admin building blocks (design 2026-11-25, admin round 2, docs/design-system.md "Admin page patterns"):
 * one card, one status badge, one empty state, one skeleton, one table wrapper. Server-safe (no hooks); only existing
 * tokens, no new colours, fonts or radii.
 */

/** The admin card: the portal card at a slightly denser padding (work tool, 16 px; 20 px from tablet width). */
export const adminCard = 'rounded-card border border-line-card bg-surface p-4 shadow-card tab:p-5';

/**
 * A status badge: always text (never colour alone), 12 px minimum, wraps inside narrow cells so long Hindi labels
 * never break a header or push a row wider. Pass `tone` or a status `code` (see `admin-status-tone.ts`).
 */
export function StatusBadge({
  children,
  tone,
  code,
  as: Tag = 'span',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  code?: string;
  as?: 'span' | 'li';
  className?: string;
}) {
  const colours = tone ? BADGE_TONE_CLASS[tone] : statusToneClass(code ?? '');
  return (
    <Tag
      data-status-badge
      className={`inline-flex max-w-full items-center rounded-pill px-2.5 py-0.5 text-xs leading-5 font-extrabold [overflow-wrap:anywhere] ${colours} ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * Nothing here yet: one sentence and at most one next action (hard rule 2). Dashed card so it reads as a place to
 * fill, not as content.
 */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div
      data-admin-empty
      className="rounded-card border border-dashed border-line-card bg-surface px-4 py-6 text-center"
    >
      <p className="text-sm font-bold text-ink">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Loading placeholder sized like the rows it stands for (no layout shift when the list arrives). `rows` lines of
 * `rowClass` height; the status text is for screen readers.
 */
export function AdminSkeleton({
  rows = 3,
  rowClass = 'h-16',
  label,
}: {
  rows?: number;
  rowClass?: string;
  label: string;
}) {
  return (
    <div role="status" className="mt-3 space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skeleton rounded-card ${rowClass}`} aria-hidden="true" />
      ))}
    </div>
  );
}

/** Table classes: 14 px text, tabular numbers, one row height, hover state. Money and counts use `adminNum`. */
export const adminTableClass = 'w-full border-collapse text-left text-sm';
export const adminTh =
  'whitespace-nowrap border-b border-line bg-pill px-3 py-2 text-xs font-extrabold text-ink first:rounded-tl-card last:rounded-tr-card';
export const adminTd = 'border-b border-line px-3 py-2 align-top text-ink';
/** Right-aligned numeric cell (money, counts): add to `adminTh` / `adminTd`. */
export const adminNum = 'text-right tabular-nums';
export const adminRow = 'hover:bg-pill/60 aria-selected:bg-accent-soft';

/**
 * The one table wrapper. A table scrolls sideways only inside this box (the page never does). The box is a named,
 * focusable region so keyboard users can scroll it (WCAG 2.1.1). No sticky header: a box that scrolls sideways owns
 * the sticky position, so a header cannot stick to the page at the same time (decision 2026-11-25). `relative` makes
 * the box the containing block of `.sr-only` text inside the table (absolutely positioned), so it is clipped by the box
 * instead of widening the page (state audit API-ADM-USTAAD-001, 320 px, 2026-11-26).
 */
export function AdminTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-admin-table
      role="region"
      aria-label={label}
      tabIndex={0}
      className="relative overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
    </div>
  );
}
