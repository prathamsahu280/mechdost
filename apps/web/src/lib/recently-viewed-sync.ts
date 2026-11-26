import { mergeRecent, type RecentEntry } from '@mechdost/shared/recently-viewed';
import { authed, type Schema } from './orders-api';

/**
 * The signed-in side of "Recently viewed" (shopping personalisation phase 2; real sign-in builds only, loaded with
 * `import()` by the lazy list). The API keeps the list only with the `personalisation` consent and answers
 * `stored: false` otherwise, so this module never needs to know the consent: it sends, and merges what comes back.
 * Once per browser session (and so right after sign-in) the device's whole list is sent (the merge); afterwards
 * only the product being viewed. No Zod in the browser (learning L-UDM2): a small hand-written guard checks answers.
 */
interface Answer {
  stored: boolean;
  items: { slug: string; viewedAt: string }[];
}
const AnswerSchema: Schema<Answer> = {
  safeParse(v: unknown) {
    if (typeof v !== 'object' || v === null) return { success: false };
    const { stored, items } = v as { stored?: unknown; items?: unknown };
    if (typeof stored !== 'boolean' || !Array.isArray(items)) return { success: false };
    const ok = (items as unknown[]).every(
      (i) =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as { slug?: unknown }).slug === 'string' &&
        typeof (i as { viewedAt?: unknown }).viewedAt === 'string',
    );
    return ok ? { success: true, data: { stored, items: items as Answer['items'] } } : { success: false };
  },
};
const ClearedSchema: Schema<{ cleared: number }> = {
  safeParse(v: unknown) {
    const n = (v as { cleared?: unknown } | null)?.cleared;
    return typeof n === 'number' ? { success: true, data: { cleared: n } } : { success: false };
  },
};

const MERGED_KEY = 'mechdost-recent-merged';
const CITY = 'RPR'; // until the city selector (spec 15), like the rest of the storefront

function mergedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(MERGED_KEY) === '1';
  } catch {
    return true; // blocked storage: send only the current view
  }
}
function markMerged(): void {
  try {
    window.sessionStorage.setItem(MERGED_KEY, '1');
  } catch {
    /* blocked storage */
  }
}

/**
 * Sends the view (and, once per session, the device list) and returns the device list merged with the account's,
 * or null when the account keeps nothing (no consent) or the call failed: the device list then stands as it is.
 */
export async function syncRecent(
  locale: string,
  local: readonly RecentEntry[],
  viewed: string | null,
): Promise<RecentEntry[] | null> {
  const merge = !mergedThisSession();
  const sending = merge ? local : local.filter((e) => e.slug === viewed);
  const res =
    sending.length > 0
      ? await authed(locale, '/me/recently-viewed', AnswerSchema, {
          method: 'POST',
          body: {
            city: CITY,
            views: sending.map((e) => ({ slug: e.slug, viewedAt: new Date(e.at).toISOString() })),
          },
        })
      : await authed(locale, '/me/recently-viewed', AnswerSchema);
  if (!res.ok || !res.data.stored) return null;
  if (merge) markMerged();
  const server = res.data.items.map((i) => ({ slug: i.slug, at: Date.parse(i.viewedAt) }));
  return mergeRecent(local, server);
}

/** "Clear" on the account's stored list too (nothing to do without the consent). */
export async function clearServerRecent(locale: string): Promise<void> {
  await authed(locale, '/me/recently-viewed', ClearedSchema, { method: 'DELETE' });
}
