import { RecommendationListDto, type RecoSlot } from '@mechdost/shared/recommendations';
import type { Locale } from '@/i18n/routing';
import { apiCard } from './api-source';
import type { CardView } from './view';

/**
 * "Goes well with" from the MechDost API (spec 11, design 2026-11-15 item 4). Server-side only, like the rest of the
 * catalogue source. Unlike the catalogue itself, a failure here is never an error page: suggestions are a bonus, so a
 * timeout, an old API or a malformed body just means "no suggestions" (the page keeps its last good render).
 */
const CITY = 'RPR'; // until the city selector (spec 15)
const TIMEOUT_MS = 2000;

export interface Suggestion {
  card: CardView;
  reason: {
    source: 'rule' | 'copurchase' | 'similar';
    label: string | null;
    count: number | null;
    size?: string | null;
  };
}

/** The suggestions, and the workshop fitting link when an admin rule offers one (product slot, phase 3). */
export interface Suggestions {
  items: Suggestion[];
  fitting: { label: string } | null;
}
const NONE: Suggestions = { items: [], fitting: null };

export async function fetchRecommendations(
  slugs: readonly string[],
  slot: RecoSlot,
  locale: Locale,
): Promise<Suggestions> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  const clean = slugs.filter((s) => /^[a-z0-9][a-z0-9-]{0,78}$/.test(s)).slice(0, 20);
  if (!base || clean.length === 0) return NONE;
  const url = new URL(`${base}/v1/recommendations`);
  url.searchParams.set('slot', slot);
  url.searchParams.set('slugs', clean.join(','));
  url.searchParams.set('city', CITY);
  url.searchParams.set('locale', locale);
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300, tags: ['catalogue'] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return NONE;
    const parsed = RecommendationListDto.safeParse(await res.json());
    return parsed.success
      ? {
          items: parsed.data.items.map((i) => ({ card: apiCard(i.card), reason: i.reason })),
          fitting: parsed.data.fitting ?? null,
        }
      : NONE;
  } catch {
    return NONE;
  }
}
