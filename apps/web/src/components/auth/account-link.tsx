'use client';

import Link from 'next/link';
import { homeFor, useSession } from '@/demo/session';
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
    'hidden min-h-11 items-center gap-2 rounded-lg px-3 text-[13px] font-bold text-ink hover:bg-pill min-[420px]:inline-flex';
  if (!session) {
    return (
      <Link href={`${prefix}/login`} data-track="header_sign_in" className={className}>
        <span aria-hidden="true" className="hidden text-[16px] leading-none xl:inline">
          {UI_EMOJI.account}
        </span>
        {signIn}
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
      <span className="max-w-[9ch] truncate">{first}</span>
      <span className="sr-only">, {account}</span>
    </Link>
  );
}
