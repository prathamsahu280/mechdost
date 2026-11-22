'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { avatarMark, homeFor, useSession } from '@/demo/session-state';
import { UI_EMOJI } from '@/lib/emoji';

/**
 * Header account entry: "Sign in" when signed out; signed in, the person's initial + first name (links to their role's
 * home) and a coloured "Sign out" button at the top right (user 2026-11-22). Labels and the locale prefix come from
 * the server so no i18n runtime ships here. Signing out loads its code on the click (the password hashing and the
 * Firebase sign-out never ride in the header's first load), goes home and says so in a short status.
 */
export function AccountLink({
  prefix,
  signIn,
  account,
  signOut,
  signedOut,
}: {
  prefix: string;
  signIn: string;
  account: string;
  signOut: string;
  signedOut: string;
}) {
  const session = useSession();
  const router = useRouter();
  const [said, setSaid] = useState(false);
  useEffect(() => {
    if (!said) return undefined;
    const id = window.setTimeout(() => {
      setSaid(false);
    }, 6000);
    return () => {
      window.clearTimeout(id);
    };
  }, [said]);

  const className =
    // Icon-only on phones (360 px+), text from 640 px: the header row must fit every width (UI review 2026-11-14:
    // at 420-520 px the page scrolled sideways; under 420 px there was no way to sign in from the header).
    'hidden min-h-11 min-w-10 items-center justify-center gap-2 rounded-lg px-1.5 text-[13px] font-bold text-ink hover:bg-pill min-[360px]:inline-flex min-[440px]:min-w-11 min-[440px]:px-2 sm:px-3';
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
      {said ? signedOut : ''}
    </span>
  );
  if (!session) {
    return (
      <>
        <Link href={`${prefix}/login`} data-track="header_sign_in" title={signIn} className={className}>
          <span aria-hidden="true" className="text-[16px] leading-none sm:hidden nav:inline">
            {UI_EMOJI.account}
          </span>
          <span className="sr-only sm:not-sr-only nav:sr-only xl:not-sr-only">{signIn}</span>
        </Link>
        {status}
      </>
    );
  }
  const { first, initial } = avatarMark(session.name);
  return (
    <>
      <Link
        href={`${prefix}${homeFor(session.role)}`}
        data-track="header_account"
        title={first || account}
        data-user-content
        className={className}
      >
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-extrabold text-accent-soft-text"
        >
          {initial ?? UI_EMOJI.account}
        </span>
        {/* Text only from xl: the signed-in row also carries the bell, so it is an avatar (name in the title) until then. */}
        <span data-user-content className="sr-only max-w-[9ch] truncate xl:not-sr-only">
          {first}
        </span>
        <span className="sr-only">, {account}</span>
      </Link>
      <button
        type="button"
        data-track="header_sign_out"
        title={signOut}
        onClick={() => {
          void import('@/lib/auth/sign-out').then((m) => {
            m.signOutEverywhere();
          });
          setSaid(true);
          router.push(prefix || '/');
        }}
        className="hidden min-h-11 min-w-10 items-center justify-center gap-1.5 rounded-lg border border-accent-button bg-accent-soft px-1.5 text-[13px] font-bold text-accent-soft-text hover:bg-accent-button hover:text-white min-[360px]:inline-flex min-[440px]:min-w-11 sm:px-3"
      >
        <span aria-hidden="true" className="text-[15px] leading-none">
          {UI_EMOJI.signOut}
        </span>
        <span className="sr-only sm:not-sr-only nav:sr-only xl:not-sr-only">{signOut}</span>
      </button>
      {status}
    </>
  );
}
