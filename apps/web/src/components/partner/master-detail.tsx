'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { useEffect, useRef, type ReactNode } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { masterDetailFocusPlan } from '@/lib/partner-kit';
import { WideSwitch, isWideNow } from './wide-layout';

const quietLink =
  'press min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Master–detail for the shop Orders tab and the workshop Jobs tab (design 2026-11-27 § 6.3; spec 07). One tree at every
 * width, the layout is CSS only so the server HTML equals the first paint (no flip after hydration, CLS):
 * - ≥ 1024 px (`nav:`): the list in a fixed 22 rem column, the open item beside it (or a one-sentence empty pane);
 * - under 1024 px: the list alone; with an item open, that item alone under a "Back" link (the stacked phone view).
 * The selection is the page's own `?order=` / `?job=` query, so Back, reload and deep links work. Only the *content*
 * of the list column differs (`list` = compact rows beside the detail, `fullList` = the stacked cards) and is chosen
 * by `WideSwitch` after hydration; the open item (`detail`) is mounted once. Focus (≥ 1024 px only): a new selection
 * moves to the detail heading (`tabIndex -1`), closing returns to the row that was open.
 */
export function MasterDetail({
  selected,
  list,
  fullList,
  detail,
  heading,
  closeHref,
  closeLabel,
  backHref,
  backLabel,
  emptyText,
}: {
  /** Code of the open item, or null. */
  selected: string | null;
  /** The compact rows shown in the master column at ≥ 1024 px. */
  list: ReactNode;
  /** The stacked cards shown under 1024 px when nothing is open. */
  fullList: ReactNode;
  /** The open item's card (rendered only while `selected` is set). */
  detail: ReactNode;
  heading: string;
  closeHref: string;
  closeLabel: string;
  /** Under 1024 px the open item has a "Back to …" link instead of the close button. */
  backHref: string;
  backLabel: string;
  emptyText: string;
}) {
  const prev = useRef<string | null | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const plan = masterDetailFocusPlan(prev.current, selected);
    const was = prev.current;
    prev.current = selected;
    if (!isWideNow()) return;
    if (plan === 'detail') headingRef.current?.focus();
    if (plan === 'row' && was) {
      const rows = root.current?.querySelectorAll<HTMLElement>('[data-master-row]') ?? [];
      [...rows].find((r) => r.dataset.masterRow === was)?.focus();
    }
  }, [selected]);

  return (
    <div ref={root} className="grid items-start gap-6 nav:grid-cols-[22rem_minmax(0,1fr)]">
      <div className={`min-w-0 ${selected ? 'hidden nav:block' : ''}`}>
        <WideSwitch wide={list} narrow={selected ? null : fullList} />
      </div>
      <div className={`min-w-0 nav:min-h-64 ${selected ? '' : 'hidden nav:block'}`}>
        {selected ? (
          <section aria-labelledby="master-detail-heading" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="master-detail-heading"
                ref={headingRef}
                tabIndex={-1}
                className="sr-only rounded-button font-heading text-xl font-extrabold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus nav:not-sr-only"
              >
                {heading}
              </h2>
              <LocalLink href={backHref} className={`inline-flex nav:hidden ${quietLink}`}>
                {backLabel}
              </LocalLink>
              <LocalLink href={closeHref} scroll={false} className={`hidden nav:inline-flex ${quietLink}`}>
                {closeLabel}
              </LocalLink>
            </div>
            {detail}
          </section>
        ) : (
          <p className="rounded-card border border-dashed border-line-card p-5 text-sm text-muted">
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );
}

/** One selectable row of the master column: a link (the selection lives in the URL), `aria-current` when open. */
export function MasterRow({
  href,
  code,
  open,
  portal,
  kind,
  children,
}: {
  href: string;
  code: string;
  open: boolean;
  portal: PartnerPortal;
  kind: 'order' | 'job';
  children: ReactNode;
}) {
  return (
    <LocalLink
      href={href}
      scroll={false}
      data-master-row={code}
      aria-current={open ? 'true' : undefined}
      onClick={() => {
        track('partner_detail_opened', { portal, kind });
      }}
      className={`block rounded-card border p-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
        open ? 'border-accent bg-pill shadow-card' : 'border-line-card bg-surface hover:bg-pill'
      }`}
    >
      {children}
    </LocalLink>
  );
}
