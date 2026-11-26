'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  RECO_ALGOS,
  RECO_SURFACES,
  type RecoAlgo,
  type RecoSurface,
} from '@mechdost/shared/recommendation-limits';
import type { RecentEntry } from '@mechdost/shared/recently-viewed';
import { recentCards } from '@/app/[locale]/recent-actions';
import { useSession } from '@/demo/session-state';
import type { Locale } from '@/i18n/routing';
import { track } from '@/lib/analytics';
import { impressionGroups } from '@/lib/reco-impressions';
import {
  browserStorage,
  isRecentOff,
  loadRecent,
  rememberView,
  saveRecent,
  setRecentOff,
} from '@/lib/recently-viewed-store';

export interface RecentLabels {
  title: string;
  clear: string;
  clearName: string;
  cleared: string;
  switch: string;
  switchHelp: string;
}

export interface RecentlyViewedProps {
  surface: RecoSurface;
  locale: Locale;
  labels: RecentLabels;
  /** The product page's own product: recorded as viewed and left out of the list. */
  currentSlug?: string;
  /** Show the list only from this many products (home: 2). */
  minItems?: number;
  /** Account: the "Remember products I view on this device" switch. */
  showSwitch?: boolean;
  /** Render nothing for a signed-out visitor (the account page shows its sign-in form then). */
  signedInOnly?: boolean;
}

const REAL_SIGN_IN = process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase';
const isSurface = (v: string | undefined): v is RecoSurface =>
  (RECO_SURFACES as readonly string[]).includes(v ?? '');
const isAlgo = (v: string | undefined): v is RecoAlgo => (RECO_ALGOS as readonly string[]).includes(v ?? '');

/** The products a suggestion section lists, once each, in order (a card links its picture and its name). */
function slugsIn(section: Element): string[] {
  const out: string[] = [];
  for (const el of section.querySelectorAll<HTMLElement>('[data-reco-slug]')) {
    const slug = el.dataset.recoSlug ?? '';
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
}

/**
 * Impressions and clicks of every suggestion section on the page (spec 12 "Suggestions"): the server-rendered
 * "Similar options" / "Goes well with" sections and this list carry `data-reco-surface` and `data-reco-algo`; a section
 * half in view once counts one impression, a click on a product link counts with its place. Lives in this lazy chunk
 * so no page pays for it in its first load.
 */
function useSuggestionTracking(rescan: unknown): void {
  const seen = useRef(new WeakSet<Element>());
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Opening a product (or the fitting link) counts; an add-to-cart button inside a card does not.
      const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
      const link = anchor?.closest<HTMLElement>('[data-reco-slug]') ?? null;
      const section = link?.closest<HTMLElement>('[data-reco-surface]');
      if (!link || !section) return;
      const surface = section.dataset.recoSurface;
      const algo = link.dataset.recoAlgo ?? section.dataset.recoAlgo;
      if (!isSurface(surface) || !isAlgo(algo)) return;
      const slug = link.dataset.recoSlug ?? '';
      track('reco_click', {
        surface,
        algo,
        slug: slug === '' ? null : slug,
        position: Math.min(20, slugsIn(section).indexOf(slug) + 1 || 1),
      });
    }
    document.addEventListener('click', onClick, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
    };
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          const el = entry.target as HTMLElement;
          const surface = el.dataset.recoSurface;
          if (!isSurface(surface)) continue;
          // "Goes well with" has no section algorithm: each item counts under its own (rule, copurchase, fitting).
          const items = [...el.querySelectorAll<HTMLElement>('[data-reco-slug]')].map((i) => ({
            slug: i.dataset.recoSlug ?? '',
            algo: i.dataset.recoAlgo,
          }));
          for (const { algo, count } of impressionGroups(el.dataset.recoAlgo, items))
            track('reco_impression', { surface, algo, count });
        }
      },
      { threshold: 0.5 },
    );
    for (const el of document.querySelectorAll('[data-reco-surface]')) {
      if (seen.current.has(el)) continue;
      seen.current.add(el);
      io.observe(el);
    }
    return () => {
      io.disconnect();
    };
  }, [rescan]);
}

/**
 * "Recently viewed" (shopping personalisation phase 2, design 2026-11-25): the last products this shopper opened,
 * newest first. Guests and accounts without the personalisation consent keep the list in this browser only; with the
 * consent (real sign-in) the list is also kept in the account and merged across devices. The cards are rendered on the
 * server (`recentCards`); this chunk only keeps the slugs. "Clear" empties it here and in the account; on the account
 * page a switch turns remembering off on this device. Nothing to show renders nothing (no heading, no empty box).
 */
export default function RecentlyViewed({
  surface,
  locale,
  labels,
  currentSlug,
  minItems = 1,
  showSwitch = false,
  signedInOnly = false,
}: RecentlyViewedProps) {
  const signedIn = useSession() !== null;
  const [list, setList] = useState<RecentEntry[] | null>(null);
  const [cards, setCards] = useState<{ slug: string; node: ReactNode }[]>([]);
  const [off, setOff] = useState(false);
  const [said, setSaid] = useState('');
  // After "Clear" the section stays (heading + status) so focus has somewhere to land.
  const [cleared, setCleared] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const switchRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Record this product page's view and read the device list; signed in (real sign-in), merge with the account's.
  useEffect(() => {
    const storage = browserStorage();
    setOff(isRecentOff(storage));
    const local = currentSlug ? rememberView(storage, currentSlug) : loadRecent(storage);
    setList(local);
    if (!REAL_SIGN_IN || !signedIn || isRecentOff(storage)) return;
    let live = true;
    void import('@/lib/recently-viewed-sync')
      .then((m) => m.syncRecent(locale, local, currentSlug ?? null))
      .then((merged) => {
        if (!live || !merged) return;
        saveRecent(storage, merged);
        setList(merged);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [currentSlug, signedIn, locale]);

  // Cards for the products to show (never the page's own product).
  const shown = (list ?? []).filter((e) => e.slug !== currentSlug).map((e) => e.slug);
  const key = shown.join(',');
  useEffect(() => {
    if (!key) {
      setCards([]);
      return;
    }
    let live = true;
    recentCards(locale, key.split(','))
      .then((res) => {
        if (live) setCards(res);
      })
      .catch(() => {
        if (live) setCards([]);
      });
    return () => {
      live = false;
    };
  }, [key, locale]);

  // a11y review 2026-11-26 (live regions): after Clear, focus first (the switch on the account page, else the heading),
  // then the polite "cleared" message a moment later so the focus announcement does not swallow it; the message is
  // emptied after a few seconds so a later Clear is announced again.
  useEffect(() => {
    if (!cleared) return;
    (showSwitch ? switchRef.current : headingRef.current)?.focus();
    const say = window.setTimeout(() => {
      setSaid(labels.cleared);
    }, 200);
    const hush = window.setTimeout(() => {
      setSaid('');
    }, 5000);
    return () => {
      window.clearTimeout(say);
      window.clearTimeout(hush);
    };
  }, [cleared, showSwitch, labels.cleared]);
  // A refilled list (the sign-in merge) ends the "just cleared" state, so a later Clear focuses and speaks again.
  useEffect(() => {
    if (cards.length > 0) setCleared(false);
  }, [cards.length]);

  useSuggestionTracking(cards.length);

  function clear() {
    const storage = browserStorage();
    const count = cards.length;
    saveRecent(storage, []);
    setList([]);
    setCards([]);
    track('recently_viewed_cleared', { surface, count: Math.min(20, count) });
    if (REAL_SIGN_IN && signedIn)
      void import('@/lib/recently-viewed-sync')
        .then((m) => m.clearServerRecent(locale))
        .catch(() => undefined);
    setSaid('');
    setCleared(true);
  }

  function toggle() {
    const next = !off;
    setRecentOff(browserStorage(), next);
    setOff(next);
    if (next) {
      setList([]);
      setCards([]);
    }
    // The switch announces its own state (native checkbox, role=switch): no extra status, no focus move.
    track('recently_viewed_toggled', { on: !next });
  }

  const visible = cards.length >= minItems;
  const status = (
    <p role="status" aria-live="polite" className="sr-only">
      {said}
    </p>
  );

  if (signedInOnly && !signedIn) return null;
  // An empty list renders nothing; right after "Clear" the heading stays (focus lands there) with the status.
  if (!visible && !showSwitch && !cleared && !said) return null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-reco-surface={surface}
      data-reco-algo="recent"
      className="mt-14"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`${id}-title`}
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          {labels.title}
        </h2>
        {visible ? (
          <button
            type="button"
            onClick={clear}
            aria-label={labels.clearName}
            className="press inline-flex min-h-11 items-center rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            {labels.clear}
          </button>
        ) : null}
      </div>
      {showSwitch ? (
        <div className="mt-3 max-w-prose">
          {/* The site's switch pattern (a native checkbox with the switch role, admin-emails-api.tsx). */}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold text-ink">
            <input
              ref={switchRef}
              type="checkbox"
              role="switch"
              checked={!off}
              aria-describedby={`${id}-help`}
              onChange={toggle}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="relative h-7 w-12 shrink-0 rounded-pill border border-input-border bg-line transition-colors forced-colors:border-[ButtonText] forced-colors:peer-checked:bg-[Highlight] peer-checked:bg-accent-button peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5 motion-reduce:after:transition-none"
            />
            {labels.switch}
          </label>
          <p id={`${id}-help`} className="text-[13px] text-muted">
            {labels.switchHelp}
          </p>
        </div>
      ) : null}
      {visible ? (
        <ul className="mt-5 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 nav:grid-cols-4">
          {cards.map((c) => (
            <li key={c.slug}>{c.node}</li>
          ))}
        </ul>
      ) : null}
      {status}
    </section>
  );
}
