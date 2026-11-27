'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { SaveCollection, SavedItem } from '@mechdost/shared/ustaad/dto/saved';
import { USTAAD_SAVE_SUGGESTED_COLLECTIONS } from '@mechdost/shared/ustaad/saved';
import { track } from '@/lib/analytics';
import { ustaadClient } from '@/lib/ustaad/client';
import { freeSuggestions, nameProblem, savedErrorKey, type SavedErrorKey } from '@/lib/ustaad/saved-view';
import { btnPrimary, btnQuiet, fieldClass } from '../common';
import { Sheet } from '../feed/sheet';

/**
 * "Add to collection" (spec 23 § 21i): one native dialog Sheet (Close, Escape and a tap outside close it, focus goes
 * back to the opener). With an `item` it shows a tick box per collection; without one it is the "Manage collections"
 * view. Creating, renaming and deleting happen in the same sheet (no second dialog); errors sit next to the field in
 * words (duplicate name, the limit of 20, a stale version).
 */
export function CollectionsSheet({
  item,
  collections,
  onClose,
  onCollections,
  onItem,
}: {
  item: SavedItem | null;
  collections: readonly SaveCollection[];
  onClose: () => void;
  /** The sheet changed the member's collections (create, rename, delete, counts). */
  onCollections: (next: SaveCollection[]) => void;
  /** The sheet ticked or unticked a collection on the item. */
  onItem: (collectionId: string, on: boolean) => void;
}) {
  const t = useTranslations('ustaad.saved');
  const sc = useTranslations('ustaad.saveControl');
  const locale = useLocale();
  const uid = useId();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<SavedErrorKey | null>(null);
  const [rowError, setRowError] = useState<{ id: string; key: SavedErrorKey } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; version: number } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggestions = freeSuggestions(
    USTAAD_SAVE_SUGGESTED_COLLECTIONS.map((code) => ({ code, word: sc(`suggest.${code}`) })),
    collections.map((c) => c.name),
  );
  const client = () => ustaadClient(locale);
  const replace = (c: SaveCollection) => {
    onCollections(collections.map((x) => (x.id === c.id ? c : x)));
  };

  async function create() {
    const problem = nameProblem(name);
    if (problem) {
      setNameError(problem);
      return;
    }
    setBusy(true);
    const r = await (await client()).createCollection(name.trim());
    if (!r.ok) {
      setBusy(false);
      setNameError(savedErrorKey(r.code));
      return;
    }
    track('ustaad_collection_changed', { action: 'created' });
    let made = r.data;
    if (item) {
      const put = await (await client()).setInCollection(made.id, { kind: item.kind, id: item.id }, true);
      if (put.ok) {
        track('ustaad_collection_changed', { action: 'item_added' });
        onItem(made.id, true);
        made = { ...made, count: made.count + 1 };
      }
    }
    onCollections([...collections, made]);
    setName('');
    setNameError(null);
    setBusy(false);
  }

  async function tick(c: SaveCollection, on: boolean) {
    if (!item || busy) return;
    setBusy(true);
    setRowError(null);
    const r = await (await client()).setInCollection(c.id, { kind: item.kind, id: item.id }, on);
    setBusy(false);
    if (!r.ok) {
      setRowError({ id: c.id, key: savedErrorKey(r.code) });
      return;
    }
    track('ustaad_collection_changed', { action: on ? 'item_added' : 'item_removed' });
    onItem(c.id, on);
    replace({ ...c, count: Math.max(0, c.count + (on ? 1 : -1)) });
  }

  async function rename() {
    if (!editing || busy) return;
    const problem = nameProblem(editing.name);
    if (problem) {
      setRowError({ id: editing.id, key: problem });
      return;
    }
    setBusy(true);
    const r = await (await client()).renameCollection(editing.id, editing.name.trim(), editing.version);
    setBusy(false);
    if (!r.ok) {
      setRowError({ id: editing.id, key: savedErrorKey(r.code) });
      return;
    }
    track('ustaad_collection_changed', { action: 'renamed' });
    replace(r.data);
    setEditing(null);
    setRowError(null);
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    const r = await (await client()).deleteCollection(id);
    setBusy(false);
    if (!r.ok) {
      setRowError({ id, key: savedErrorKey(r.code) });
      return;
    }
    track('ustaad_collection_changed', { action: 'deleted' });
    onCollections(collections.filter((c) => c.id !== id));
    setDeleting(null);
  }

  return (
    <Sheet title={item ? t('sheetTitleItem') : t('sheetTitleManage')} onClose={onClose}>
      <div className="grid gap-5">
        {collections.length === 0 ? (
          <p className="text-[15px] text-muted">{t('sheetNone')}</p>
        ) : (
          <ul className="grid gap-2">
            {collections.map((c) => {
              const err = rowError?.id === c.id ? rowError.key : null;
              const errId = `${uid}-err-${c.id}`;
              return (
                <li key={c.id} className="rounded-xl border border-line-card p-2">
                  {editing?.id === c.id ? (
                    <div className="grid gap-2">
                      <label htmlFor={`${uid}-r-${c.id}`} className="text-[14px] font-bold text-ink">
                        {t('renameLabel')}
                      </label>
                      <input
                        id={`${uid}-r-${c.id}`}
                        className={fieldClass}
                        value={editing.name}
                        maxLength={40}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? errId : undefined}
                        onChange={(e) => {
                          setEditing({ ...editing, name: e.target.value });
                        }}
                        data-user-content
                      />
                      {err ? (
                        <p id={errId} role="alert" className="text-[13px] text-error">
                          {t(err)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={busy}
                          onClick={() => void rename()}
                          data-track="ustaad_collection_rename_save"
                        >
                          {t('save')}
                        </button>
                        <button
                          type="button"
                          className={btnQuiet}
                          onClick={() => {
                            setEditing(null);
                            setRowError(null);
                          }}
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : deleting === c.id ? (
                    <div className="grid gap-2">
                      <p className="text-[15px] text-ink" data-user-content>
                        {t('deleteAsk', { name: c.name })}
                      </p>
                      {err ? (
                        <p role="alert" className="text-[13px] text-error">
                          {t(err)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={busy}
                          onClick={() => void remove(c.id)}
                          data-track="ustaad_collection_delete_yes"
                        >
                          {t('deleteYes')}
                        </button>
                        <button
                          type="button"
                          className={btnQuiet}
                          onClick={() => {
                            setDeleting(null);
                          }}
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        {item ? (
                          <label className="flex min-h-12 flex-1 cursor-pointer items-center gap-3 px-1 text-[16px] font-bold text-ink">
                            <input
                              type="checkbox"
                              className="size-6 accent-accent"
                              checked={item.collectionIds.includes(c.id)}
                              disabled={busy}
                              aria-describedby={err ? errId : undefined}
                              onChange={(e) => void tick(c, e.target.checked)}
                            />
                            <span className="min-w-0 flex-1 break-words" data-user-content>
                              {c.name}
                            </span>
                          </label>
                        ) : (
                          <span
                            className="min-h-12 min-w-0 flex-1 px-1 py-3 text-[16px] font-bold break-words text-ink"
                            data-user-content
                          >
                            {c.name}
                          </span>
                        )}
                        <span className="text-[13px] text-muted">
                          {t('collectionCount', { count: c.count })}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={btnQuiet}
                          onClick={() => {
                            setEditing({ id: c.id, name: c.name, version: c.version });
                            setRowError(null);
                          }}
                        >
                          {t('rename')}
                        </button>
                        <button
                          type="button"
                          className={btnQuiet}
                          onClick={() => {
                            setDeleting(c.id);
                            setRowError(null);
                          }}
                        >
                          {t('delete')}
                        </button>
                      </div>
                      {err ? (
                        <p id={errId} role="alert" className="text-[13px] text-error">
                          {t(err)}
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label htmlFor={`${uid}-new`} className="text-[14px] font-bold text-ink">
            {t('newLabel')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${uid}-new`}
              className={`${fieldClass} min-w-0 flex-1`}
              value={name}
              maxLength={40}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${uid}-new-err` : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              data-user-content
            />
            <button
              type="submit"
              className={btnPrimary}
              disabled={busy}
              data-track="ustaad_collection_create"
            >
              {t('create')}
            </button>
          </div>
          {nameError ? (
            <p id={`${uid}-new-err`} role="alert" className="text-[13px] text-error">
              {t(nameError)}
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted">{t('suggestions')}</span>
              {suggestions.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className="press inline-flex min-h-12 items-center rounded-full border border-line-card bg-surface px-4 text-[14px] font-bold text-ink hover:border-accent focus-visible:outline-3 focus-visible:outline-focus"
                  onClick={() => {
                    setName(s.word);
                    setNameError(null);
                  }}
                >
                  {s.word}
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </div>
    </Sheet>
  );
}
