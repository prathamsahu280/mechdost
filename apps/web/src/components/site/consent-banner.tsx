'use client';

import { useEffect, useRef, useState } from 'react';
import { onConsentOpen, openConsentChoices, saveConsent, useConsent } from '@/lib/consent';

export interface ConsentCopy {
  label: string;
  title: string;
  body: string;
  allow: string;
  essential: string;
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

  useEffect(() => {
    setMounted(true);
    return onConsentOpen(() => {
      setReopened(true);
    });
  }, []);

  useEffect(() => {
    if (reopened) region.current?.focus();
  }, [reopened]);

  const visible = mounted && (!choice || reopened);

  // One floating thing at a time (calm UI, no stacked overlays): the assistant button hides while the choice is
  // open (it would sit under the banner on phones). Escape closes a reopened banner; a first visit must choose.
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

  // Server render and first paint show nothing (the choice lives in this browser), so no layout shift for
  // visitors who already chose.
  if (!visible) return null;

  const decide = (analytics: boolean) => {
    saveConsent(analytics);
    setReopened(false);
  };
  const button =
    'press inline-flex min-h-11 flex-1 items-center justify-center rounded-button border border-ink px-4 text-sm font-bold text-ink hover:bg-surface-alt';

  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-label={copy.label}
      data-testid="consent-banner"
      className="fixed inset-x-3 z-50 rounded-card border border-line bg-surface p-4 shadow-dialog outline-none bottom-[calc(76px+env(safe-area-inset-bottom))] nav:inset-x-auto nav:bottom-6 nav:left-6 nav:max-w-md"
    >
      <h2 className="font-heading text-[15px] font-extrabold text-ink">{copy.title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{copy.body}</p>
      <div className="mt-3 flex gap-2">
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
