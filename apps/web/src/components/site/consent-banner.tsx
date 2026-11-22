'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { onConsentOpen, openConsentChoices, saveConsent, useConsent } from '@/lib/consent';

export interface ConsentCopy {
  label: string;
  title: string;
  body: string;
  allow: string;
  essential: string;
  policy: string;
  /** Localised path of the privacy notice. */
  policyHref: string;
}

/**
 * Privacy choice (DPDP; decision "declines non-essential by default"). Not a modal: the page stays usable and
 * nothing optional runs until the visitor picks. Two equal buttons, neither pre-selected, no shaming copy
 * (Guidelines for Prevention and Regulation of Dark Patterns, 2023). Reopened from "Privacy choices" in the footer.
 */
export function ConsentBanner({ copy }: { copy: ConsentCopy }) {
  const choice = useConsent();
  const [reopened, setReopened] = useState(false);
  const [mounted, setMounted] = useState(false);
  const region = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    return onConsentOpen(() => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReopened(true);
    });
  }, []);

  // Reopened from the footer: focus moves into the banner, and back to "Privacy choices" when it closes.
  useEffect(() => {
    if (reopened) {
      region.current?.focus();
    } else if (opener.current) {
      opener.current.focus();
      opener.current = null;
    }
  }, [reopened]);

  const visible = mounted && (!choice || reopened);

  // One floating thing at a time (calm UI, no stacked overlays): the assistant button rides above the banner
  // while the choice is open and the page reserves the banner's height (globals.css). Escape closes a reopened banner; a first visit must choose.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.dataset.consentOpen = '';
    else delete root.dataset.consentOpen;
    if (!visible || !choice) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReopened(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [visible, choice]);

  // The banner's real height, for the page's scroll padding and the compare tray that floats above it on phones
  // (review 2026-11-14, I3: a fixed 13rem guess left 4 px in Hindi at 390 px and was too short at 320 px).
  useEffect(() => {
    const el = region.current;
    const root = document.documentElement;
    if (!visible || !el) return undefined;
    const set = () => {
      root.style.setProperty('--consent-h', `${String(Math.ceil(el.getBoundingClientRect().height))}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--consent-h');
    };
  }, [visible]);

  // Server render and first paint show nothing (the choice lives in this browser), so no layout shift for
  // visitors who already chose.
  if (!visible) return null;

  const decide = (analytics: boolean) => {
    saveConsent(analytics);
    setReopened(false);
  };
  // Compact on phones: the full notice stays, but it must not hide the page's main action (QA 2026-11-14, P5).
  const button =
    'press inline-flex min-h-11 flex-1 items-center justify-center rounded-button border border-ink px-3 text-[13px] font-bold text-ink hover:bg-surface-alt nav:px-4 nav:text-sm';

  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-label={copy.label}
      data-testid="consent-banner"
      className="fixed inset-x-2 z-50 rounded-card border border-line bg-surface p-3 shadow-dialog nav:p-4 outline-none bottom-[calc(84px+env(safe-area-inset-bottom))] nav:inset-x-auto nav:bottom-6 nav:right-6 nav:max-w-md"
    >
      <h2 className="font-heading text-sm font-extrabold text-ink nav:text-[15px]">{copy.title}</h2>
      <p className="mt-1 text-[13px] leading-snug text-muted nav:mt-1.5 nav:text-sm nav:leading-relaxed">
        {copy.body}{' '}
        <Link href={copy.policyHref} className="font-bold text-ink underline underline-offset-4">
          {copy.policy}
        </Link>
      </p>
      <div className="mt-2 flex gap-2 nav:mt-3">
        <button
          type="button"
          className={button}
          aria-pressed={choice ? choice.analytics : undefined}
          onClick={() => {
            decide(true);
          }}
        >
          {copy.allow}
        </button>
        <button
          type="button"
          className={button}
          aria-pressed={choice ? !choice.analytics : undefined}
          onClick={() => {
            decide(false);
          }}
        >
          {copy.essential}
        </button>
      </div>
    </section>
  );
}

/** Footer link that reopens the choice. */
export function ConsentChoicesButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      data-track="footer_privacy_choices"
      className="inline-flex min-h-11 items-center text-left text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
      onClick={openConsentChoices}
    >
      {label}
    </button>
  );
}
