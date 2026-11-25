'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AdminSection } from '@/lib/sections';

/** Id of the heading every admin section's landmark points at (`aria-labelledby`). */
export const ADMIN_PAGE_TITLE_ID = 'admin-page-title';
const ACTIONS_SLOT_ID = 'admin-header-actions';

/**
 * The one header every admin section starts with (design 2026-11-25, admin round 2): the section's name (the same
 * words as the side bar), one line of what it is for (`portal.adminHeader_<section>`, en + hi) and, on the right, the
 * screen's single primary action when it has one (a section puts it there with `AdminHeaderActions`). Filters and
 * search go below it in `AdminToolbar`. Long Hindi words wrap inside the header instead of pushing the action away.
 */
export function AdminPageHeader({ section }: { section: AdminSection }) {
  const t = useTranslations('portal');
  return (
    <header data-admin-header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <h2
          id={ADMIN_PAGE_TITLE_ID}
          className="font-heading text-xl leading-tight font-extrabold [overflow-wrap:anywhere] text-ink tab:text-2xl"
        >
          {t(`nav_${section}`)}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t(`adminHeader_${section}`)}</p>
      </div>
      <div id={ACTIONS_SLOT_ID} className="flex flex-wrap items-center gap-2 empty:hidden" />
    </header>
  );
}

/**
 * Puts a section's single primary action into the header's right-hand slot. The children stay part of the section's
 * React tree (state, handlers, focus), only their place in the page changes. Renders nothing until the header is
 * mounted.
 */
export function AdminHeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(ACTIONS_SLOT_ID));
  }, []);
  return slot ? createPortal(children, slot) : null;
}

/** Filters and search under the header: one wrapping row, controls at the portal's field height. */
export function AdminToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-admin-toolbar
      role="group"
      aria-label={label}
      className="flex flex-wrap items-end gap-x-3 gap-y-2"
    >
      {children}
    </div>
  );
}
