'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { avatarMark, useSession, type DemoRole } from '@/demo/session-state';

/** Strings of the account menu, translated on the server (no i18n runtime in the browser). */
export interface AccountMenuCopy {
  signIn: string;
  /** The menu's accessible name and the avatar button's. */
  account: string;
  profile: string;
  orders: string;
  refunds: string;
  vehicles: string;
  saved: string;
  portal: string;
  dark: string;
  /** The other language, written in that language ("हिंदी में देखें" / "View in English"). */
  language: string;
  signOut: string;
  signedOut: string;
}

interface PanelProps {
  name: string;
  phone: string;
  role: DemoRole;
  initial: string | null;
  prefix: string;
  copy: AccountMenuCopy;
  onClose: (refocus: boolean) => void;
  onSignOut: () => void;
}

/**
 * Header account entry (v4, decision 2026-11-23): "Sign in" when signed out; signed in, an avatar button that opens the
 * account menu (profile, orders, vehicles, saved items, dark mode, language, Sign out; portal roles get their portal
 * link instead). This part stays tiny; the menu itself is a lazy chunk (`account-menu-panel.tsx`) fetched on hover,
 * focus or the first tap (JS budget, spec 16). Signing out loads its own code on the click, goes home and says so in a
 * short status. Labels and the locale prefix come from the server.
 */
export function AccountMenu({
  prefix,
  copy,
  signInIcon,
}: {
  prefix: string;
  copy: AccountMenuCopy;
  /** The person icon of the "Sign in" button and of an avatar without a name, rendered by the server. */
  signInIcon: ReactNode;
}) {
  const session = useSession();
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const loading = useRef(false);

  useEffect(() => {
    if (!said) return undefined;
    const id = window.setTimeout(() => {
      setSaid(false);
    }, 6000);
    return () => {
      window.clearTimeout(id);
    };
  }, [said]);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    void import('./account-menu-panel').then((m) => {
      setPanel(() => m.default);
    });
  }, []);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // The status region exists before the text does, so screen readers announce it (and it hangs under the header).
  const status = (
    <span
      role="status"
      aria-live="polite"
      className={
        said
          ? 'absolute top-full right-4 mt-2 rounded-button border border-success bg-success-bg px-4 py-2 text-sm font-bold text-success shadow-card'
          : 'sr-only'
      }
    >
      {said ? copy.signedOut : ''}
    </span>
  );

  if (!session) {
    return (
      <>
        <Link
          href={`${prefix}/login`}
          data-track="header_sign_in"
          title={copy.signIn}
          className="press inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl bg-pill px-2.5 text-[13.5px] font-bold whitespace-nowrap text-ink hover:bg-line min-[400px]:px-3.5"
        >
          <span aria-hidden="true" className="flex">
            {signInIcon}
          </span>
          <span className="sr-only min-[400px]:not-sr-only">{copy.signIn}</span>
        </Link>
        {status}
      </>
    );
  }

  const { first, initial } = avatarMark(session.name);
  return (
    <div className="sm:relative">
      <button
        ref={button}
        type="button"
        aria-label={`${copy.account}${first ? `, ${first}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-track="header_account"
        data-user-content
        title={first || copy.account}
        onPointerEnter={load}
        onFocus={load}
        onClick={() => {
          load();
          setOpen((o) => !o);
        }}
        className="press grid size-10 place-items-center rounded-xl bg-linear-to-br from-navy-sidebar-active to-navy font-heading text-sm font-extrabold text-white shadow-[inset_0_0_0_2px_rgb(255_255_255/0.12)]"
      >
        <span aria-hidden="true" className="flex">
          {initial ?? signInIcon}
        </span>
      </button>
      {open && Panel ? (
        <Panel
          name={session.name}
          phone={session.phone}
          role={session.role}
          initial={initial}
          prefix={prefix}
          copy={copy}
          onClose={close}
          onSignOut={() => {
            setOpen(false);
            setSaid(true);
          }}
        />
      ) : null}
      {status}
    </div>
  );
}
