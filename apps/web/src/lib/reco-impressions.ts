import { RECO_ALGOS, type RecoAlgo } from '@mechdost/shared/recommendation-limits';

const isAlgo = (v: string | undefined): v is RecoAlgo => (RECO_ALGOS as readonly string[]).includes(v ?? '');

/**
 * The impressions one suggestion section counts (spec 12 "Suggestions"): its distinct products, under the section's
 * own algorithm ("Similar options", "Recently viewed"), or, when the section has none ("Goes well with" mixes admin
 * rules, bought-together and the fitting link), under each item's own algorithm. Unknown codes are dropped.
 */
export function impressionGroups(
  sectionAlgo: string | undefined,
  items: readonly { slug: string; algo: string | undefined }[],
): { algo: RecoAlgo; count: number }[] {
  const seen = new Map<RecoAlgo, Set<string>>();
  for (const item of items) {
    const algo = isAlgo(sectionAlgo) ? sectionAlgo : item.algo;
    if (!isAlgo(algo)) continue;
    const set = seen.get(algo) ?? new Set<string>();
    set.add(item.slug);
    seen.set(algo, set);
  }
  return [...seen.entries()].map(([algo, slugs]) => ({ algo, count: Math.min(20, slugs.size) }));
}
