import NextLink from 'next/link';
import { useLocale } from 'next-intl';
import type { ComponentProps } from 'react';
import { getPathname } from '@/i18n/navigation';

type Props = Omit<ComponentProps<typeof NextLink>, 'href'> & {
  /** Unprefixed app path, e.g. `/shop`. */
  href: string;
  query?: Record<string, string>;
};

/**
 * Server-side locale-aware link: resolves `/shop` → `/hi/shop` on the server and renders a plain next/link,
 * so no i18n runtime ships to the browser (spec 16 JS budget). Use this instead of next-intl's `Link`.
 */
export function LocalLink({ href, query, ...props }: Props) {
  const locale = useLocale();
  const path = getPathname({ href, locale });
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  return <NextLink href={`${path}${search}`} {...props} />;
}
