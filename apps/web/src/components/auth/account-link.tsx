'use client';

import Link from 'next/link';
import { homeFor, useSession } from '@/demo/session-state';
import { UI_EMOJI } from '@/lib/emoji';

/**
 * Header account entry: "Sign in" when signed out, the person's initial + first name when signed in (links to
 * their role's home). Labels and the locale prefix come from the server so no i18n runtime ships here.
 */
export function AccountLink({
  prefix,
  signIn,
  account,
}: {
  prefix: string;
  signIn: string;
  account: string;
}) {
  const session = useSession();
  const className =
    // Icon-only on phones (360 px+), text from 640 px: the header row must fit every width (UI review 2026-11-14:
    // at 420-520 px the page scrolled sideways; under 420 px there was no way to sign in from the header).
    'hidden min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-[13px] font-bold text-ink hover:bg-pill min-[360px]:inline-flex sm:px-3';
  if (!session) {
    return (
      <Link href={`${prefix}/login`} data-track="header_sign_in" title={signIn} className={className}>
        <span aria-hidden="true" className="text-[16px] leading-none sm:hidden nav:inline">
          {UI_EMOJI.account}
        </span>
        <span className="sr-only sm:not-sr-only nav:sr-only xl:not-sr-only">{signIn}</span>
      </Link>
    );
  }
  const first = session.name.split(/\s+/)[0] ?? session.name;
  return (
    <Link href={`${prefix}${homeFor(session.role)}`} data-track="header_account" className={className}>
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-extrabold text-accent-soft-text"
      >
        {first.charAt(0).toUpperCase()}
      </span>
      <span
        data-user-content
        className="sr-only max-w-[9ch] truncate sm:not-sr-only nav:sr-only xl:not-sr-only"
      >
        {first}
      </span>
      <span className="sr-only">, {account}</span>
    </Link>
  );
}
