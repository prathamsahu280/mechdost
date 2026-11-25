'use client';

import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { meAllowsCatalogueEdit } from '@/lib/catalogue/admin-edit';

/**
 * The storefront "Edit" shortcut (user 2026-11-25; spec 08), loaded only for a staff session (`admin-edit-lazy.tsx`).
 * It is a plain link into the admin catalogue editor: no storefront editing, no tokens in the address. In real sign-in
 * it shows only after the live `GET /v1/me` lists the editor's permission, so a doctored browser record shows
 * nothing; the editor's own API routes refuse anyone without it anyway. The demo has no server, so the demo admin
 * login is the whole check there.
 */
export interface AdminEditProps {
  slug: string;
  /** Locale-prefixed address, built on the server. */
  href: string;
  locale: string;
  /** "Edit {product name}" in the page language, built on the server. */
  label: string;
  tip: string;
  from: 'card' | 'product';
  /** Whose session this is; a different person signing in on the same tab asks again. */
  accountId: string;
}

let probe: { accountId: string; answer: Promise<boolean> } | null = null;

/** One `/me` request per signed-in account, shared by every card on the page (a list has 24 of them). */
function catalogueEditAllowed(accountId: string, locale: string): Promise<boolean> {
  if (probe?.accountId !== accountId) {
    const answer = adminApi(locale, '/me', {
      safeParse: (data: unknown) => ({ success: true as const, data }),
    })
      .then((res) => res.ok && meAllowsCatalogueEdit(res.data))
      .catch(() => false);
    probe = { accountId, answer };
    // A failed or refused answer is not remembered, so the next page asks again.
    void answer.then((ok) => {
      if (!ok && probe?.answer === answer) probe = null;
    });
  }
  return probe.answer;
}

export default function AdminEditButton({ slug, href, locale, label, tip, from, accountId }: AdminEditProps) {
  const [allowed, setAllowed] = useState(AUTH_MODE !== 'firebase');
  useEffect(() => {
    if (AUTH_MODE !== 'firebase') return undefined;
    let live = true;
    void catalogueEditAllowed(accountId, locale).then((ok) => {
      if (live) setAllowed(ok);
    });
    return () => {
      live = false;
    };
  }, [accountId, locale]);

  if (!allowed) return null;
  return (
    <NextLink
      href={href}
      aria-label={label}
      title={tip}
      data-slot="admin-edit"
      onClick={() => {
        track('admin_storefront_edit_clicked', { slug, from });
      }}
      className={`press inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line-card bg-surface text-ink shadow-card hover:bg-pill pointer-coarse:size-11 ${
        from === 'card' ? 'absolute top-2 right-2 z-10' : ''
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </NextLink>
  );
}
