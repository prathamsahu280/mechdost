'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { SaveStateDto } from '@mechdost/shared/ustaad/dto/saved';
import type { UstaadSaveKind } from '@mechdost/shared/ustaad/saved';
import { track } from '@/lib/analytics';
import { authed } from '@/lib/orders-api';
import { toggleSaved } from '@/lib/ustaad/save-toggle';
import { UstaadIcon } from '../shell/icons';

/**
 * The shared Save control (spec 23 § 5 Saved, 2026-11-28) for posts, questions, answers, jobs and Learn lessons. The
 * state is in `aria-pressed` and in the visible word ("Saved" / "सेव किया"), not only the filled bookmark; it flips
 * at once and rolls back with a short message if the API refuses. Builders drop it into their cards:
 * `<SaveControl kind="question" id={q.id} saved={q.savedByMe} />` (inside a `ClientMessages` that loads
 * `ustaad.saveControl`). `compact` keeps the card's action-row size.
 */
export function SaveControl({
  kind,
  id,
  saved: initial,
  compact = false,
  onChange,
}: {
  kind: UstaadSaveKind;
  id: string;
  saved: boolean;
  compact?: boolean;
  onChange?: (saved: boolean) => void;
}) {
  const t = useTranslations('ustaad.saveControl');
  const locale = useLocale();
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  async function onClick() {
    if (busy.current) return;
    busy.current = true;
    setError(false);
    const r = await toggleSaved({
      kind,
      saved,
      send: (on) =>
        authed(locale, `/ustaad/saves/${kind}/${encodeURIComponent(id)}`, SaveStateDto, {
          method: on ? 'PUT' : 'DELETE',
        }),
      onState: (s) => {
        setSaved(s);
        onChange?.(s);
      },
      track,
    });
    busy.current = false;
    if (!r.ok) setError(true);
  }

  return (
    <span className={compact ? 'inline-flex flex-1 flex-col' : 'inline-flex flex-col'}>
      <button
        type="button"
        onClick={() => void onClick()}
        aria-pressed={saved}
        aria-label={saved ? t('savedAria') : t('saveAria')}
        data-track="ustaad_item_save"
        className={`press inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl px-3 py-1 text-[14px] leading-tight font-bold transition-colors duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
          saved ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
        }`}
      >
        <UstaadIcon name="saved" filled={saved} />
        <span>{saved ? t('saved') : t('save')}</span>
      </button>
      {error ? (
        <span role="status" className="px-1 text-[13px] text-error">
          {t('failed')}
        </span>
      ) : null}
    </span>
  );
}
