import { CollectionNameDto, type SavedItem } from '@mechdost/shared/ustaad/dto/saved';
import { USTAAD_SAVE_COLLECTION_NAME_MAX } from '@mechdost/shared/ustaad/saved';
import { localePath } from '../locale-path';

/**
 * Pure helpers of the Saved page and the "Add to collection" sheet (spec 23 § 21i): where a row opens, which words an
 * API code gets next to the field, the same name rules as the API (checked before the call), and list updates.
 */

/** Where a saved row opens. A missing code falls back to Home, never a broken link. */
export function savedHref(item: Pick<SavedItem, 'kind' | 'id' | 'code'>, locale: string): string {
  switch (item.kind) {
    case 'post':
      return localePath(`/ustaad/p/${item.id}`, locale);
    case 'question':
    case 'answer':
      return localePath(item.code ? `/ustaad/q/${item.code}` : '/ustaad', locale);
    case 'job':
      return localePath(item.code ? `/ustaad/jobs/${item.code}` : '/ustaad', locale);
    case 'lesson':
      return localePath('/ustaad/learn', locale);
  }
}

export type SavedErrorKey =
  | 'err_nameTaken'
  | 'err_tooMany'
  | 'err_changed'
  | 'err_gone'
  | 'err_failed'
  | 'err_empty'
  | 'err_tooLong'
  | 'err_invalid';

/** The word key (in `ustaad.saved`) for an API error code: 409 duplicate, the 20 limit, a stale version, a 404. */
export function savedErrorKey(code: string): SavedErrorKey {
  switch (code) {
    case 'UNIQUE_VIOLATION':
      return 'err_nameTaken';
    case 'USTAAD_SAVE_COLLECTIONS_MAX':
      return 'err_tooMany';
    case 'CONFLICT':
      return 'err_changed';
    case 'NOT_FOUND':
      return 'err_gone';
    default:
      return 'err_failed';
  }
}

/** The API's name rules, before the call: 1–40 characters, no control characters or angle brackets. */
export function nameProblem(name: string): 'err_empty' | 'err_tooLong' | 'err_invalid' | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'err_empty';
  if (trimmed.length > USTAAD_SAVE_COLLECTION_NAME_MAX) return 'err_tooLong';
  return CollectionNameDto.safeParse(trimmed).success ? null : 'err_invalid';
}

/** Suggested names the member does not have yet (compared ignoring case). */
export function freeSuggestions<T extends { word: string }>(
  suggestions: readonly T[],
  have: readonly string[],
): T[] {
  const taken = new Set(have.map((n) => n.trim().toLowerCase()));
  return suggestions.filter((s) => !taken.has(s.word.trim().toLowerCase()));
}

/** The item with one collection ticked or unticked (a new object; the others stay). */
export function withCollection(item: SavedItem, collectionId: string, on: boolean): SavedItem {
  const has = item.collectionIds.includes(collectionId);
  if (on === has) return item;
  return {
    ...item,
    collectionIds: on
      ? [...item.collectionIds, collectionId]
      : item.collectionIds.filter((c) => c !== collectionId),
  };
}
