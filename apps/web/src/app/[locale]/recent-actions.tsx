'use server';

import type { ReactNode } from 'react';
import { RecentCard } from '@/components/personalisation/recent-card';
import { findProduct } from '@/demo/catalogue';
import { routing, type Locale } from '@/i18n/routing';
import { fetchCatalogueProduct } from '@/lib/catalogue/api-source';
import { demoCard } from '@/lib/catalogue/demo-source';
import type { CardView } from '@/lib/catalogue/view';
import { DATA_MODE } from '@/lib/data-mode';
import { RECENT_MAX } from '@mechdost/shared/recently-viewed';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

/**
 * "Recently viewed" cards (shopping personalisation phase 2): the browser sends the slugs it remembers (no person, no
 * time), the server renders a compact card per product that still exists and is visible, in the asked language, in
 * the same order. So the lazy list carries no catalogue code (JS budget, spec 16). A public POST endpoint: the input
 * is checked here; product reads are the cached public catalogue reads (60 s), so this costs no extra API load.
 */
export async function recentCards(
  locale: Locale,
  slugs: readonly string[],
): Promise<{ slug: string; node: ReactNode }[]> {
  const loc = routing.locales.find((l) => l === locale);
  if (!loc || !Array.isArray(slugs)) throw new Error('bad input');
  const clean = [
    ...new Set(slugs.filter((s): s is string => typeof s === 'string' && SLUG_RE.test(s))),
  ].slice(0, RECENT_MAX);
  const cards: (CardView | null)[] =
    DATA_MODE === 'api'
      ? await Promise.all(clean.map((slug) => fetchCatalogueProduct(slug, loc).catch(() => null)))
      : clean.map((slug) => {
          const raw = findProduct(slug);
          return raw ? demoCard(raw, loc) : null;
        });
  return cards
    .filter((c): c is CardView => c !== null)
    .map((card) => ({ slug: card.slug, node: <RecentCard product={card} locale={loc} /> }));
}
