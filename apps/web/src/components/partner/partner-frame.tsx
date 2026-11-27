'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { track } from '@/lib/analytics';
import { site } from '@/lib/site';
import { PartnerTabs, type PartnerTab } from './partner-tabs';

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
}) {
  return (
    <div
      data-partner-frame={portal}
      className="nav:grid nav:grid-cols-[14rem_minmax(0,1fr)] nav:items-start nav:gap-6"
    >
      <aside className="hidden nav:sticky nav:top-4 nav:block">
        <div className="rounded-card bg-navy-sidebar p-3 text-white shadow-card">
          <p className="px-3 pt-1 pb-3 font-heading text-sm font-extrabold text-white/80">{railTitle}</p>
          <PartnerTabs portal={portal} tabs={tabs} label={navLabel} variant="rail" />
        </div>
      </aside>
      <div className={`grid min-w-0 gap-5 pb-24 nav:pb-0 ${narrow ? 'mx-auto w-full max-w-xl' : ''}`}>
        {strip}
        {children}
      </div>
      <PartnerTabs portal={portal} tabs={tabs} label={navLabel} variant="bar" />
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
