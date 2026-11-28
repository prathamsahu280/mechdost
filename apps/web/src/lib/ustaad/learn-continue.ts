import type { LearnResourceView, LearnView } from '@mechdost/shared/ustaad/dto/qa';

/**
 * The lesson to "Continue" (spec 23 § 21i-L): the hosted video the member touched last that is not finished. Reads the
 * progress the Learn list already carries; nothing new is fetched or stored.
 */
export function continueLesson(view: LearnView): LearnResourceView | null {
  const all = [...view.courses.flatMap((c) => c.resources), ...view.loose];
  let best: LearnResourceView | null = null;
  for (const r of all) {
    if (r.kind !== 'hosted_video' || r.completed || r.watchedSeconds <= 0 || r.lastWatchedAt === null)
      continue;
    if (best === null || (best.lastWatchedAt ?? '') < r.lastWatchedAt) best = r;
  }
  return best;
}
