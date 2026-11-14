'use client';

import dynamic from 'next/dynamic';
import { useSession } from '@/demo/session-state';
import { AUTH_MODE } from '@/lib/auth/mode';
import type { BellCopy } from './bell-copy';

/**
 * The header's bell entry (spec 10). Always loaded, so it stays tiny: it renders nothing for visitors and in the
 * browser demo, and for a signed-in person (real sign-in) it loads the bell's own chunk (feed, dropdown, API calls) on
 * the client only. The placeholder holds the bell's 44 px so the header does not shift when the chunk arrives.
 */
const BellController = dynamic(() => import('./bell-controller'), {
  ssr: false,
  loading: () => <span aria-hidden="true" className="inline-block size-11" />,
});

export function Bell({ copy, locale }: { copy: BellCopy; locale: string }) {
  const session = useSession();
  if (AUTH_MODE !== 'firebase' || !session) return null;
  return (
    <span className="hidden min-[380px]:contents">
      <BellController copy={copy} prefix={locale === 'hi' ? '/hi' : ''} locale={locale} role={session.role} />
    </span>
  );
}
