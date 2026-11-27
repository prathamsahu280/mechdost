'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { SaveCollection, SavedItem, SavedSummary } from '@mechdost/shared/ustaad/dto/saved';
import { USTAAD_SAVE_KINDS, type UstaadSaveKind } from '@mechdost/shared/ustaad/saved';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { ustaadClient } from '@/lib/ustaad/client';
import { savedHref, withCollection } from '@/lib/ustaad/saved-view';
import {
  btnPrimary,
  btnQuiet,
  card,
  fieldClass,
  LoadFailed,
  LoadingBlock,
  SampleNote,
  useTimeAgo,
  useUstaad,
} from '../common';
import { UstaadIcon } from '../shell/icons';
import { SaveControl } from './save-control';

/** The sheet loads on intent (design § 7.5b), like Home's More sheet. */
const CollectionsSheet = dynamic(() => import('./collections-sheet').then((m) => m.CollectionsSheet), {
  ssr: false,
});

type Page = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ok' };

const chip = (on: boolean) =>
  `press inline-flex min-h-12 items-center gap-1.5 rounded-full px-4 text-[15px] font-bold whitespace-nowrap focus-visible:outline-3 focus-visible:outline-focus ${
    on ? 'bg-navy text-white' : 'border border-line-card bg-surface text-ink hover:border-accent'
  }`;

/**
 * `/ustaad/saved` (spec 23 § 5, § 21i): everything I saved, newest first, only for me. Chips by kind and by collection
 * (with counts), a word search, a row per item that opens the item, "Add to collection" per row, "Load more" by the
 * API's cursor. Unsaving keeps the row until the next load (so a slip can be undone with the same button).
 */
export function SavedScreen() {
  const t = useTranslations('ustaad.saved');
  const sc = useTranslations('ustaad.saveControl');
  const locale = useLocale();
  const timeAgo = useTimeAgo();
  const summary = useUstaad((c) => c.savedSummary(), 'saved-summary');
  const [kind, setKind] = useState<UstaadSaveKind | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SavedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [page, setPage] = useState<Page>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<{ item: SavedItem | null } | null>(null);
  const [collections, setCollections] = useState<SaveCollection[] | null>(null);
  const [sample, setSample] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  // The collections come with the summary; the sheet edits this copy.
  const summaryData: SavedSummary | null = summary.loaded.state === 'ok' ? summary.loaded.data : null;
  useEffect(() => {
    if (summaryData) setCollections(summaryData.collections);
  }, [summaryData]);

  // The search box waits for a pause in typing before it asks the API.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(text.trim());
    }, 300);
    return () => {
      clearTimeout(id);
    };
  }, [text]);

  useEffect(() => {
    let live = true;
    setPage({ status: 'loading' });
    void ustaadClient(locale)
      .then(async (c) => {
        const r = await c.savedList({
          ...(kind ? { kind } : {}),
          ...(collectionId ? { collectionId } : {}),
          ...(q ? { q } : {}),
        });
        if (!live) return;
        setSample(c.sample);
        if (!r.ok) {
          setPage({ status: 'error', code: r.code });
          return;
        }
        setItems(r.data.items);
        setNext(r.data.nextCursor);
        setUnsaved(new Set());
        setPage({ status: 'ok' });
      })
      .catch(() => {
        if (live) setPage({ status: 'error', code: 'NETWORK' });
      });
    return () => {
      live = false;
    };
  }, [locale, kind, collectionId, q, tick]);

  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    const c = await ustaadClient(locale);
    const r = await c.savedList({
      ...(kind ? { kind } : {}),
      ...(collectionId ? { collectionId } : {}),
      ...(q ? { q } : {}),
      cursor: next,
    });
    setLoadingMore(false);
    if (r.ok) {
      setItems((cur) => [...cur, ...r.data.items]);
      setNext(r.data.nextCursor);
    }
  }

  function pickKind(k: UstaadSaveKind | null) {
    setKind(k);
    track('ustaad_saved_filter', k ? { by: 'kind', kind: k } : { by: 'all' });
  }
  function pickCollection(id: string | null) {
    setCollectionId(id);
    track('ustaad_saved_filter', id ? { by: 'collection' } : { by: 'all' });
  }
  function showEverything() {
    setKind(null);
    setCollectionId(null);
    setText('');
    setQ('');
    track('ustaad_saved_filter', { by: 'all' });
  }
  function openSheet(item: SavedItem | null, from: HTMLElement) {
    opener.current = from;
    setSheet({ item });
  }

  const filtered = kind !== null || collectionId !== null || q !== '';
  const counts = summaryData?.counts;
  const total = summaryData?.total ?? 0;
  const list = collections ?? summaryData?.collections ?? [];
  const sheetItem = sheet?.item
    ? (items.find((i) => i.id === sheet.item?.id && i.kind === sheet.item.kind) ?? sheet.item)
    : null;

  return (
    <div className="grid gap-4">
      <SampleNote show={sample} />

      <div role="group" aria-label={t('kindsLabel')} className="-mx-4 overflow-x-auto px-4 tab:mx-0 tab:px-0">
        <ul className="flex w-max gap-2">
          <li>
            <button
              type="button"
              aria-pressed={kind === null}
              className={chip(kind === null)}
              onClick={() => {
                pickKind(null);
              }}
            >
              {t('all')}
              {counts ? <span className="text-[13px] opacity-80">{total}</span> : null}
            </button>
          </li>
          {USTAAD_SAVE_KINDS.map((k) => (
            <li key={k}>
              <button
                type="button"
                aria-pressed={kind === k}
                className={chip(kind === k)}
                onClick={() => {
                  pickKind(kind === k ? null : k);
                }}
              >
                {sc(`kinds.${k}`)}
                {counts ? <span className="text-[13px] opacity-80">{counts[k]}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div
        role="group"
        aria-label={t('collectionsLabel')}
        className="-mx-4 overflow-x-auto px-4 tab:mx-0 tab:px-0"
      >
        <ul className="flex w-max items-center gap-2">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={collectionId === c.id}
                className={chip(collectionId === c.id)}
                onClick={() => {
                  pickCollection(collectionId === c.id ? null : c.id);
                }}
              >
                <span data-user-content>{c.name}</span>
                <span className="text-[13px] opacity-80">{c.count}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={btnQuiet}
              aria-haspopup="dialog"
              data-disclosure-trigger="saved-collections"
              data-track="ustaad_saved_manage"
              onClick={(e) => {
                openSheet(null, e.currentTarget);
              }}
            >
              {t('manage')}
            </button>
          </li>
        </ul>
      </div>

      <div className="grid gap-1">
        <label htmlFor="saved-search" className="text-[14px] font-bold text-ink">
          {t('searchLabel')}
        </label>
        <input
          id="saved-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          className={fieldClass}
          value={text}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </div>

      <p role="status" className="sr-only">
        {page.status === 'ok' ? t('resultCount', { count: items.length }) : ''}
      </p>

      {page.status === 'loading' ? <LoadingBlock /> : null}
      {page.status === 'error' ? (
        <LoadFailed
          message={t('loadFailed')}
          onRetry={() => {
            setTick((n) => n + 1);
          }}
        />
      ) : null}

      {page.status === 'ok' && items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          inCollection={collectionId !== null && kind === null && q === ''}
          onAll={showEverything}
          home={localePath('/ustaad', locale)}
        />
      ) : null}

      {page.status === 'ok' && items.length > 0 ? (
        <ul className="grid gap-3">
          {items.map((it) => {
            const gone = unsaved.has(`${it.kind}:${it.id}`);
            const words = it.kind === 'lesson' && locale === 'hi' && it.textHi ? it.textHi : it.text;
            return (
              <li key={`${it.kind}:${it.id}`} className={`${card} grid gap-2`}>
                <Link
                  href={savedHref(it, locale)}
                  data-track={`ustaad_saved_open_${it.kind}`}
                  className="grid gap-1 rounded-lg focus-visible:outline-3 focus-visible:outline-focus"
                >
                  <span className="text-[13px] font-bold text-accent-soft-text">
                    {sc(`kinds.${it.kind}`)}
                  </span>
                  <span
                    className="text-[16px] leading-snug break-words text-ink"
                    {...(it.kind === 'lesson' ? {} : { 'data-user-content': true })}
                  >
                    {words}
                  </span>
                  <span className="text-[13px] text-muted">
                    {t('savedWhen', { when: timeAgo(it.savedAt) })}
                  </span>
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <SaveControl
                    kind={it.kind}
                    id={it.id}
                    saved={!gone}
                    onChange={(on) => {
                      setUnsaved((cur) => {
                        const n = new Set(cur);
                        if (on) n.delete(`${it.kind}:${it.id}`);
                        else n.add(`${it.kind}:${it.id}`);
                        return n;
                      });
                      if (!on)
                        setItems((cur) => cur.map((x) => (x === it ? { ...x, collectionIds: [] } : x)));
                      summary.refresh();
                    }}
                  />
                  {gone ? null : (
                    <button
                      type="button"
                      className={btnQuiet}
                      aria-haspopup="dialog"
                      data-disclosure-trigger={`saved-collections-${it.kind}`}
                      data-track="ustaad_saved_add_to_collection"
                      onClick={(e) => {
                        openSheet(it, e.currentTarget);
                      }}
                    >
                      <UstaadIcon name="plus" />
                      {t('addToCollection')}
                    </button>
                  )}
                  {it.collectionIds.length > 0 ? (
                    <span className="text-[13px] text-muted">
                      {t('inCollections', { count: it.collectionIds.length })}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {next ? (
        <button
          type="button"
          className={`${btnQuiet} justify-self-center`}
          disabled={loadingMore}
          onClick={() => void loadMore()}
          data-track="ustaad_saved_more"
        >
          {loadingMore ? t('loadingMore') : t('loadMore')}
        </button>
      ) : null}

      {sheet ? (
        <CollectionsSheet
          item={sheetItem}
          collections={list}
          onClose={() => {
            setSheet(null);
            opener.current?.focus();
            summary.refresh();
          }}
          onCollections={setCollections}
          onItem={(id, on) => {
            if (sheet.item) {
              const target = sheet.item;
              setItems((cur) =>
                cur.map((x) =>
                  x.kind === target.kind && x.id === target.id ? withCollection(x, id, on) : x,
                ),
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}

function EmptyState({
  filtered,
  inCollection,
  onAll,
  home,
}: {
  filtered: boolean;
  inCollection: boolean;
  onAll: () => void;
  home: string;
}) {
  const t = useTranslations('ustaad.saved');
  const which = !filtered ? 'emptyAll' : inCollection ? 'emptyCollection' : 'emptyFilter';
  return (
    <div className={`${card} grid justify-items-center gap-3 text-center`}>
      <h2 className="font-heading text-lg font-extrabold text-ink">{t(`${which}Title`)}</h2>
      <p className="text-[15px] text-muted">{t(`${which}Body`)}</p>
      {filtered ? (
        <button type="button" className={btnPrimary} onClick={onAll} data-track="ustaad_saved_show_all">
          {t(`${which}Cta`)}
        </button>
      ) : (
        <Link href={home} className={btnPrimary} data-track="ustaad_saved_empty_home">
          <UstaadIcon name="home" />
          {t('emptyAllCta')}
        </Link>
      )}
    </div>
  );
}
