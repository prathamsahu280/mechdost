'use client';

import NextLink from 'next/link';
import { Check } from 'lucide-react';
import { track } from '@/lib/analytics';

/**
 * "Size 90/90-12 available" on a search result (user 2026-11-25): the product was found by one of its sizes, and the
 * chip says so, so the shopper is not left wondering why a CEAT Milaze answers "90/90-12". A link: it opens the
 * product with that size already chosen (`?size=<sku>`, the size picker reads it); the page's canonical URL does not
 * change. Only this chip is a client island; the rest of the card stays on the server.
 */
export function SizeMatchChip({
  href,
  slug,
  sku,
  text,
  more,
}: {
  /** Already localised path with `?size=`. */
  href: string;
  slug: string;
  sku: string;
  text: string;
  /** "Sizes available: a, b" for the screen reader and the tooltip when several sizes matched; else null. */
  more: string | null;
}) {
  return (
    <NextLink
      href={href}
      title={more ?? undefined}
      onClick={() => {
        track('search_size_match_clicked', { slug, sku, source: 'results' });
      }}
      className="press inline-flex min-h-6 max-w-full items-start gap-1 rounded-md bg-success-bg px-2 py-0.5 text-xs leading-snug font-bold text-success hover:underline"
    >
      <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
      {more ? <span className="sr-only">. {more}</span> : null}
    </NextLink>
  );
}
