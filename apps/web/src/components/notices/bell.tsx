'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { useSession } from '@/demo/session-state';
import type { BellCopy } from './bell-copy';

/**
 * The header's bell entry (spec 10). Always loaded, so it stays tiny: it renders nothing for visitors, and for a
 * signed-in person (real sign-in) it loads the bell's own chunk (feed, dropdown, API calls) on the client only. A
 * placeholder holds the bell's 44 px so the header does not shift when the chunk arrives.
 *
 * JS budget (spec 16; measured 2026-11-15 by an A/B build: this import cost every page 1.5 KB gz): the chunk is loaded
 * with a plain `import()` in an effect, not `next/dynamic`, whose loader runtime no other always-loaded module uses;
 * and the bell is chosen at build time (the env value is inlined in the switch below), so a browser-demo build carries none of it.
 */
interface ControllerProps {
  copy: BellCopy;
  prefix: string;
  locale: string;
  role: string;
}

function RealBell({ copy, locale }: { copy: BellCopy; locale: string }) {
  const session = useSession();
  const [Controller, setController] = useState<ComponentType<ControllerProps> | null>(null);
  useEffect(() => {
    if (!session || Controller) return;
    let live = true;
    void import('./bell-controller').then((m) => {
      if (live) setController(() => m.default);
    });
    return () => {
      live = false;
    };
  }, [session, Controller]);
  if (!session) return null;
  return (
    <span className="hidden min-[380px]:contents">
      {Controller ? (
        <Controller copy={copy} prefix={locale === 'hi' ? '/hi' : ''} locale={locale} role={session.role} />
      ) : (
        <span aria-hidden="true" className="inline-block size-10" />
      )}
    </span>
  );
}

function NoBell(_props: { copy: BellCopy; locale: string }) {
  return null;
}

// The env value is inlined here, not the imported AUTH_MODE: the minifier folds a literal only inside one module
// (budget incident 2026-11-15 afternoon, spec 16).
export const Bell = process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? RealBell : NoBell;
