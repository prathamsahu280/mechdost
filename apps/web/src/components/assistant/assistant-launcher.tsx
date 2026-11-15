'use client';

import { isPortalPath } from '@/lib/portal-path';
import { MessageCircleQuestion } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
  // Focus returns to the button once it is visible again: while the panel is open the button is `visibility: hidden`
  // (it must not sit, invisible, over page content: audit 2026-11-16, CHR-ASSIST), and hidden elements cannot take focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) buttonRef.current?.focus();
  }, [open]);
  // The assistant helps shoppers; in the partner and admin portals it covered working controls (QA 2026-11-14,
  // U10 / crawler F9). Hooks above run on every render; only the output stops here.
  if (isPortalPath(pathname)) return null;

  return (
    <>
      {loaded ? (
        <Suspense>
          <AssistantPanel
            copy={copy}
            open={open}
            onClose={() => {
              setOpen(false);
            }}
          />
        </Suspense>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={loaded ? 'assistant-panel' : undefined}
        onClick={() => {
          if (!open) track('assistant_opened', { path: pathname });
          setLoaded(true);
          setOpen((v) => !v);
        }}
        className={`assistant-launcher press fixed right-4 z-40 inline-flex size-13 items-center justify-center gap-2 rounded-full bg-navy text-sm font-bold sm:size-auto sm:min-h-12 sm:rounded-pill sm:px-4 text-white shadow-dialog hover:-translate-y-0.5 bottom-[calc(84px+env(safe-area-inset-bottom))] nav:right-6 nav:bottom-6 ${
          open
            ? 'invisible pointer-events-none'
            : 'opacity-100 transition-[opacity,transform] duration-[var(--duration-base)]'
        }`}
      >
        <MessageCircleQuestion aria-hidden="true" className="size-6 text-accent-light sm:size-5" />
        <span className="sr-only sm:not-sr-only">{copy.launcher}</span>
      </button>
    </>
  );
}
