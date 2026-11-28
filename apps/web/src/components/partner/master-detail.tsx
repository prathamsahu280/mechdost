'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { masterDetailFocusPlan } from '@/lib/partner-kit';

const WIDE = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
  };
}

/** True at the `nav:` breakpoint (1024 px) and wider; false on the server and on first paint, so phones never see it. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * Master–detail for the shop Orders tab and the workshop Jobs tab at ≥ 1024 px (design 2026-11-27 § 6.3; spec 07):
 * the list in a fixed 22 rem column, the open item beside it. The selection is the page's own `?order=` / `?job=`
 * query, so Back, reload and deep links work as before. Focus: a new selection moves to the detail heading
 * (`tabIndex -1`), closing returns to the row that was open. Callers render this only when `useWideLayout()` is true.
 */
export function MasterDetail({
  selected,
  list,
  detail,
  heading,
  closeHref,
  closeLabel,
  emptyText,
}: {
  /** Code of the open item, or null. */
  selected: string | null;
  list: ReactNode;
  /** The open item's card (rendered only while `selected` is set). */
  detail: ReactNode;
  heading: string;
  closeHref: string;
  closeLabel: string;
  emptyText: string;
}) {
  const prev = useRef<string | null | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const plan = masterDetailFocusPlan(prev.current, selected);
    const was = prev.current;
    prev.current = selected;
    if (plan === 'detail') headingRef.current?.focus();
    if (plan === 'row' && was) {
      const rows = root.current?.querySelectorAll<HTMLElement>('[data-master-row]') ?? [];
      [...rows].find((r) => r.dataset.masterRow === was)?.focus();
    }
  }, [selected]);

  return (
    <div ref={root} className="grid items-start gap-6 nav:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="min-w-0">{list}</div>
      <div className="min-h-64 min-w-0">
        {selected ? (
          <section aria-labelledby="master-detail-heading" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="master-detail-heading"
                ref={headingRef}
                tabIndex={-1}
                className="rounded-button font-heading text-xl font-extrabold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {heading}
              </h2>
              <LocalLink
                href={closeHref}
                scroll={false}
                className="press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
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
