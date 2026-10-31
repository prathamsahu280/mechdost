'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { lazy, Suspense, useRef, useState } from 'react';
import type { AssistantCopy } from '@/assistant/copy';
import { track } from '@/lib/analytics';

// The panel (messages, input, transport) loads on first open; the page only ships this button.
const AssistantPanel = lazy(() => import('./assistant-panel'));

/** Floating "Ask MechDost" button, above the mobile tab bar, bottom-right on desktop. */
export function AssistantLauncher({ copy }: { copy: AssistantCopy }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  return (
    <>
      {loaded ? (
        <Suspense>
          <AssistantPanel
            copy={copy}
            open={open}
            onClose={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
          />
        </Suspense>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={() => {
          if (!open) track('assistant_opened', { path: pathname });
          setLoaded(true);
          setOpen((v) => !v);
        }}
        className={`press fixed right-4 z-40 inline-flex size-13 items-center justify-center gap-2 rounded-full bg-navy text-sm font-bold sm:size-auto sm:min-h-12 sm:rounded-pill sm:px-4 text-white shadow-dialog transition-[opacity,transform] duration-[var(--duration-base)] hover:-translate-y-0.5 bottom-[calc(84px+env(safe-area-inset-bottom))] nav:right-6 nav:bottom-6 ${
          open ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100'
        }`}
      >
        <MessageCircleQuestion aria-hidden="true" className="size-6 text-accent-light sm:size-5" />
        <span className="sr-only sm:not-sr-only">{copy.launcher}</span>
      </button>
    </>
  );
}
