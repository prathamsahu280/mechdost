'use client';

import { SHOW_DEMO_CONTROLS } from '@/lib/data-mode';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, type ReactNode } from 'react';
import { useSession, type DemoAccount, type DemoRole } from '@/demo/session';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import { useHydrated } from '@/demo/store';

const PortalAccountContext = createContext<DemoAccount | null>(null);

/**
 * The signed-in account of the portal whose guard is above. Section pages are rendered by a layout's guard (so the
 * guard stays mounted between sections) and read the account here instead of through the guard's render function.
 */
export function usePortalAccount(): DemoAccount | null {
  return useContext(PortalAccountContext);
}

/**
 * Role gate for the demo portals. The real check happens in the API (`requirePermission`, spec 13) — this only
 * decides what to render. Wrong role or signed out → a sign-in card that returns here afterwards.
 */
export function PortalGuard({
  role,
  path,
  demoNote = SHOW_DEMO_CONTROLS,
  children,
}: {
  role: DemoRole;
  path: string;
  /** "Stored on this device" note; off for screens that run on the API (real sign-in). */
  demoNote?: boolean;
  children: (account: DemoAccount) => ReactNode;
}) {
  const t = useTranslations('portal');
  const auth = useTranslations('auth');
  const prefix = useLocale() === 'hi' ? '/hi' : '';
  const hydrated = useHydrated();
  const session = useSession();

  if (!hydrated) return <div className="skeleton h-96 rounded-card" aria-hidden="true" />;
  if (session?.role !== role) {
    return (
      <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
        <h2 className="font-heading text-xl font-extrabold text-ink">{t('guardTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('guardBody', { role: auth(`role_${role}`) })}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`${prefix}/login?next=${encodeURIComponent(`${prefix}${path}`)}`}
            className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {t('signIn')}
          </Link>
          {session ? (
            <button
              type="button"
              onClick={() => {
                void signOutEverywhere();
              }}
              className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
            >
              {t('signOut')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <p data-user-content>{t('signedInAs', { name: session.name })}</p>
        <button
          type="button"
          onClick={() => {
            void signOutEverywhere();
          }}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 font-bold text-ink hover:bg-pill"
        >
          {t('signOut')}
        </button>
      </div>
      <PortalAccountContext.Provider value={session}>{children(session)}</PortalAccountContext.Provider>
      {demoNote ? <p className="text-xs text-muted">{t('demoNote')}</p> : null}
    </div>
  );
}
