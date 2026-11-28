'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { track } from '@/lib/analytics';
import { tabFocusPlan } from '@/lib/partner-kit';
import { site } from '@/lib/site';
import { PartnerTabs, useCurrentTab, type PartnerTab } from './partner-tabs';

/** A link click counts as the cause of the next route change for this long (short, so Back later never steals focus). */
const USER_NAV_WINDOW_MS = 2000;
/** How long a tab body that loads late is waited for before focus falls back to the page's h1. */
const HEADING_WAIT_MS = 3000;

export type PartnerStateTone = 'ok' | 'busy' | 'off';

const DOT: Record<PartnerStateTone, string> = {
  ok: 'bg-success',
  busy: 'bg-warning-bg',
  off: 'bg-white/60',
};

/**
 * The partner frame (design 2026-11-27 § 4; spec 07 § UI "Partner shell = concept admin shell (navy sidebar) in
 * mobile-first layout"). Mounted once in each portal's `layout.tsx` (via a client wrapper), so tab changes never
 * remount it (no reload feel). Under 1024 px: navy strip on top, work below, tabs in a bottom bar. From 1024 px: a navy
 * side rail with the tabs, the strip and work to its right.
 */
export function PartnerFrame({
  portal,
  navLabel,
  railTitle,
  tabs,
  strip,
  children,
  narrow = false,
  heading = true,
}: {
  portal: PartnerPortal;
  /** Accessible name of the tab navigation, e.g. "Shop portal". */
  navLabel: string;
  /** Small title on top of the side rail (the portal name). */
  railTitle: string;
  tabs: readonly PartnerTab[];
  /** The strip (usually `PartnerStrip`), always first. */
  strip: ReactNode;
  children: ReactNode;
  /** One centred column (rider): the work stays phone-width on a computer. */
  narrow?: boolean;
  /** Render the page's main heading (the current tab's name, screen-reader only). Off when the layout has its own h1. */
  heading?: boolean;
}) {
  const pathname = usePathname();
  const current = useCurrentTab(tabs);
  const headingText = tabs.find((tab) => tab.id === current)?.label ?? railTitle;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevPath = useRef<string | null>(null);
  const tabClickedAt = useRef(0);
  // A plain primary click on a link inside the frame (a tab or a KPI tile) is the cause of the next route change;
  // new-tab and modified clicks are not.
  const onUserNavigate = useCallback((e?: MouseEvent<HTMLElement>) => {
    if (e && (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))
      return;
    tabClickedAt.current = Date.now();
  }, []);
  const onFrameClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (e.target instanceof Element && e.target.closest('a[href]')) onUserNavigate(e);
    },
    [onUserNavigate],
  );

  // After a tab the partner picked: focus the new tab's first visible heading (a `tabIndex -1` h2/h3 with a visible
  // focus ring), waiting for a tab body that loads late; the screen-reader-only h1 is the fallback, and the polite
  // status when there is no heading at all. Never on the first load, never on back/forward (the click is only valid for
  // a few seconds), and never when the partner has already moved focus on by themselves.
  useEffect(() => {
    const byUser = Date.now() - tabClickedAt.current < USER_NAV_WINDOW_MS;
    const move = tabFocusPlan(prevPath.current, pathname, byUser);
    prevPath.current = pathname;
    if (!move) return undefined;
    tabClickedAt.current = 0;
    const focusStillOnNav = () => {
      const active = document.activeElement;
      return !active || active === document.body || Boolean(active.closest('nav'));
    };
    const focusOn = (target: HTMLElement) => {
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    };
    const fallback = () => {
      if (!focusStillOnNav()) return;
      const target = headingRef.current ?? document.querySelector<HTMLElement>('h1');
      if (target) focusOn(target);
      else if (statusRef.current) {
        statusRef.current.textContent = '';
        statusRef.current.textContent = headingText;
      }
    };
    const panel = panelRef.current;
    const heading = () => panel?.querySelector<HTMLElement>('h2, h3') ?? null;
    const found = heading();
    if (found) {
      if (focusStillOnNav()) focusOn(found);
      return undefined;
    }
    if (!panel || typeof MutationObserver === 'undefined') {
      fallback();
      return undefined;
    }
    let done = false;
    const finish = (run: () => void) => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      run();
    };
    const observer = new MutationObserver(() => {
      const h = heading();
      if (h)
        finish(() => {
          if (focusStillOnNav()) focusOn(h);
        });
    });
    const timer = window.setTimeout(() => {
      finish(fallback);
    }, HEADING_WAIT_MS);
    observer.observe(panel, { childList: true, subtree: true });
    return () => {
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pathname, headingText]);

  return (
    <div
      data-partner-frame={portal}
      onClickCapture={onFrameClick}
      // One viewport of height while the tab loads: the site footer starts below the fold, so late data cannot shove it
      // (LV-6, layout shift 0.27-0.44 live).
      className="min-h-dvh nav:grid nav:grid-cols-[14rem_minmax(0,1fr)] nav:items-start nav:gap-6"
    >
      <aside className="hidden nav:sticky nav:top-4 nav:block">
        <div className="rounded-card bg-navy-sidebar p-3 text-white shadow-card">
          <p className="px-3 pt-1 pb-3 font-heading text-sm font-extrabold text-white/80">{railTitle}</p>
          <PartnerTabs
            portal={portal}
            tabs={tabs}
            label={navLabel}
            variant="rail"
            onUserNavigate={onUserNavigate}
          />
        </div>
      </aside>
      <div className={`grid min-w-0 gap-5 pb-24 nav:pb-0 ${narrow ? 'mx-auto w-full max-w-xl' : ''}`}>
        {heading ? (
          <h1 ref={headingRef} tabIndex={-1} className="sr-only">
            {headingText}
          </h1>
        ) : null}
        <p ref={statusRef} role="status" aria-live="polite" className="sr-only" />
        {strip}
        <div
          ref={panelRef}
          data-partner-panel
          className="grid min-w-0 gap-5 [&_h2:focus-visible]:outline-3 [&_h2:focus-visible]:outline-offset-2 [&_h2:focus-visible]:outline-focus [&_h3:focus-visible]:outline-3 [&_h3:focus-visible]:outline-offset-2 [&_h3:focus-visible]:outline-focus"
        >
          {children}
        </div>
      </div>
      <PartnerTabs
        portal={portal}
        tabs={tabs}
        label={navLabel}
        variant="bar"
        onUserNavigate={onUserNavigate}
      />
    </div>
  );
}

/**
 * Navy header strip: the business (or rider) name, its state in words with a dot (never colour alone), a Help call
 * and an optional slot under it (the rider's online switch).
 */
export function PartnerStrip({
  portal,
  title,
  titleId,
  state,
  meta,
  children,
}: {
  portal: PartnerPortal;
  title: string;
  titleId?: string;
  state?: { text: string; tone: PartnerStateTone } | null;
  /** A short line next to the state (e.g. "Open till 21:00", the vehicle). */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations('partnerKit');
  return (
    <section
      aria-labelledby={titleId}
      className="blueprint rounded-card px-4 py-4 text-white shadow-card tab:px-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="font-heading text-xl font-extrabold break-words tab:text-2xl"
            data-user-content
          >
            {title}
          </h2>
          {state || meta ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/85">
              {state ? (
                <span className="inline-flex items-center gap-2 font-bold text-white">
                  <span
                    aria-hidden="true"
                    className={`size-2.5 rounded-full ring-2 ring-white/40 ${DOT[state.tone]}`}
                  />
                  {state.text}
                </span>
              ) : null}
              {state && meta ? <span aria-hidden="true">·</span> : null}
              {meta}
            </p>
          ) : null}
        </div>
        <a
          href={`tel:${site.supportPhoneE164}`}
          aria-label={t('help_label')}
          onClick={() => {
            track('click', { id: `partner_${portal}_help`, path: window.location.pathname });
          }}
          className="press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-button bg-white px-4 text-sm font-extrabold text-navy focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Phone aria-hidden="true" className="size-4" />
          {t('help')}
        </a>
      </div>
      {children}
    </section>
  );
}
