import type { SaveCollection, SavedItem, SavedPage, SavedSummary } from '@mechdost/shared/ustaad/dto/saved';
import {
  USTAAD_SAVE_COLLECTIONS_MAX,
  USTAAD_SAVED_TEXT_MAX,
  USTAAD_SAVE_KINDS,
  type UstaadSaveKind,
} from '@mechdost/shared/ustaad/saved';
import type { ApiResult } from '@/lib/orders-api';
import type { SavedFilter } from '@/lib/ustaad/client';

/**
 * The browser demo's Saved store (spec 23 § 21i): the same rules as the API in memory (unique names ignoring case,
 * rename by version, at most 20 collections, only my saves go into a collection, unsave empties them), so the staff
 * preview shows the real behaviour. `describe` finds the item's own words from the demo's sample data.
 */
export interface DemoSavedText {
  text: string;
  textHi: string | null;
  code: string | null;
}

const PAGE = 20;
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (status: number, code: string): ApiResult<never> => ({ ok: false, status, code });

interface Row extends SavedItem {
  seq: number;
}

export function createDemoSaved(describe: (kind: UstaadSaveKind, id: string) => DemoSavedText | null) {
  const rows = new Map<string, Row>();
  const collections: (SaveCollection & { items: Set<string> })[] = [];
  let seq = 0;
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const view = (c: (typeof collections)[number]): SaveCollection => ({
    id: c.id,
    name: c.name,
    count: c.items.size,
    version: c.version,
  });
  const find = (id: string) => collections.find((c) => c.id === id);

  return {
    setSaved(kind: UstaadSaveKind, id: string, on: boolean): ApiResult<{ saved: boolean }> {
      const k = key(kind, id);
      if (on) {
        if (!rows.has(k)) {
          const d = describe(kind, id) ?? { text: kind, textHi: null, code: null };
          seq += 1;
          rows.set(k, {
            seq,
            kind,
            id,
            savedAt: new Date().toISOString(),
            text: d.text.slice(0, USTAAD_SAVED_TEXT_MAX),
            textHi: d.textHi,
            code: d.code,
            collectionIds: [],
          });
        }
      } else {
        rows.delete(k);
        for (const c of collections) c.items.delete(k);
      }
      return ok({ saved: on });
    },
    list(f: SavedFilter): ApiResult<SavedPage> {
      const word = f.q?.trim().toLowerCase();
      const coll = f.collectionId ? find(f.collectionId) : undefined;
      if (f.collectionId && !coll) return fail(404, 'NOT_FOUND');
      const all = [...rows.values()]
        .filter((r) => !f.kind || r.kind === f.kind)
        .filter((r) => !coll || coll.items.has(key(r.kind, r.id)))
        .filter((r) => !word || `${r.text} ${r.textHi ?? ''}`.toLowerCase().includes(word))
        .sort((a, b) => b.seq - a.seq);
      const start = f.cursor ? Number(f.cursor) : 0;
      const page = all.slice(start, start + PAGE).map(({ seq: _s, ...r }): SavedItem => ({
        ...r,
        collectionIds: collections.filter((c) => c.items.has(key(r.kind, r.id))).map((c) => c.id),
      }));
      return ok({ items: page, nextCursor: start + PAGE < all.length ? String(start + PAGE) : null });
    },
    summary(): ApiResult<SavedSummary> {
      const counts = Object.fromEntries(USTAAD_SAVE_KINDS.map((k) => [k, 0])) as Record<
        UstaadSaveKind,
        number
      >;
      for (const r of rows.values()) counts[r.kind] += 1;
      return ok({ total: rows.size, counts, collections: collections.map(view) });
    },
    create(name: string): ApiResult<SaveCollection> {
      if (collections.length >= USTAAD_SAVE_COLLECTIONS_MAX) return fail(422, 'USTAAD_SAVE_COLLECTIONS_MAX');
      const n = name.trim();
      if (collections.some((c) => c.name.toLowerCase() === n.toLowerCase()))
        return fail(409, 'UNIQUE_VIOLATION');
      const c = { id: crypto.randomUUID(), name: n, count: 0, version: 1, items: new Set<string>() };
      collections.push(c);
      return ok(view(c));
    },
    rename(id: string, name: string, version: number): ApiResult<SaveCollection> {
      const c = find(id);
      if (!c) return fail(404, 'NOT_FOUND');
      if (c.version !== version) return fail(409, 'CONFLICT');
      const n = name.trim();
      if (collections.some((o) => o.id !== id && o.name.toLowerCase() === n.toLowerCase()))
        return fail(409, 'UNIQUE_VIOLATION');
      c.name = n;
      c.version += 1;
      return ok(view(c));
    },
    remove(id: string): ApiResult<null> {
      const i = collections.findIndex((c) => c.id === id);
      if (i < 0) return fail(404, 'NOT_FOUND');
      collections.splice(i, 1);
      return ok(null);
    },
    setIn(id: string, t: { kind: UstaadSaveKind; id: string }, on: boolean): ApiResult<null> {
      const c = find(id);
      if (!c) return fail(404, 'NOT_FOUND');
      const k = key(t.kind, t.id);
      if (on) {
        if (!rows.has(k)) return fail(404, 'NOT_FOUND');
        c.items.add(k);
      } else c.items.delete(k);
      return ok(null);
    },
  };
}
