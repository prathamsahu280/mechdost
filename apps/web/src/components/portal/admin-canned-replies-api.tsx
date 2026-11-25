'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { CannedReplyDto, type CannedReply } from '@mechdost/shared/support-inbox';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

const EMPTY = { key: '', titleEn: '', titleHi: '', bodyEn: '', bodyHi: '', active: true, sortOrder: 100 };
type Draft = typeof EMPTY;
const KNOWN = ['CANNED_REPLY_INVALID', 'CANNED_REPLY_KEY_TAKEN', 'STALE_CANNED_REPLY'] as const;

/**
 * Canned replies editor of the support inbox (design 2026-11-15 item 4): staff with `content:write` add, edit and
 * switch off the answers agents insert into the reply box. Every reply is written in English and Hindi.
 */
export function CannedRepliesEditor({
  replies,
  onChanged,
}: {
  replies: readonly CannedReply[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('support');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CannedReply | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<{ known: (typeof KNOWN)[number] } | { common: CommonErrorKey } | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function edit(reply: CannedReply | null) {
    setEditing(reply);
    setDraft(reply ? { ...reply } : EMPTY);
    setError(null);
    setSaved(false);
  }

  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const body = { ...draft };
    const res = editing
      ? await adminApi(locale, `/admin/support/canned-replies/${editing.id}`, CannedReplyDto, {
          method: 'PUT',
          body: { ...body, version: editing.version },
        })
      : await adminApi(locale, '/admin/support/canned-replies', CannedReplyDto, { method: 'POST', body });
    setBusy(false);
    if (!res.ok) {
      const known = KNOWN.find((k) => k === res.code);
      setError(known ? { known } : { common: commonErrorKey(res.code) });
      return;
    }
    setError(null);
    setSaved(true);
    edit(null);
    setSaved(true);
    await onChanged();
  }

  const field = (name: keyof Draft, label: string, long = false) => (
    <div>
      <label htmlFor={`canned-${name}`} className="text-xs font-bold text-muted">
        {label}
      </label>
      {long ? (
        <textarea
          id={`canned-${name}`}
          rows={3}
          maxLength={2000}
          value={String(draft[name])}
          onChange={(e) => {
            setDraft({ ...draft, [name]: e.target.value });
          }}
          className={`${portalField} py-2`}
        />
      ) : (
        <input
          id={`canned-${name}`}
          maxLength={name === 'key' ? 40 : 80}
          value={String(draft[name])}
          onChange={(e) => {
            setDraft({ ...draft, [name]: e.target.value });
          }}
          className={portalField}
        />
      )}
    </div>
  );

  return (
    <section className={`${adminCard} space-y-3`} aria-labelledby="canned-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="canned-title" className="font-heading text-base font-extrabold text-ink">
          {t('cannedTitle')}
        </h3>
        <button
          type="button"
          aria-expanded={open}
          data-disclosure-trigger="canned-replies"
          data-panel-cancel={open ? 'canned-replies' : undefined}
          className={portalQuiet}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? t('cannedClose') : t('cannedEdit')}
        </button>
      </div>
      {open ? (
        <div data-panel-for="canned-replies" className="space-y-3">
          <p className="max-w-prose text-sm text-muted">{t('cannedIntro')}</p>
          {replies.length === 0 ? <p className="text-sm text-muted">{t('cannedEmpty')}</p> : null}
          <ul className="space-y-2">
            {replies.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink">
                <span>
                  {locale === 'hi' ? r.titleHi : r.titleEn}
                  {r.active ? null : <span className="ms-2 text-xs text-muted">({t('cannedOff')})</span>}
                </span>
                <button
                  type="button"
                  className={portalQuiet}
                  onClick={() => {
                    edit(r);
                  }}
                >
                  {t('cannedEdit')}
                </button>
              </li>
            ))}
          </ul>
          <form
            noValidate
            onSubmit={(e) => {
              void save(e);
            }}
            className="space-y-2"
          >
            <h4 className="text-sm font-bold text-ink">{editing ? editing.key : t('cannedNew')}</h4>
            {field('key', t('cannedKey'))}
            {field('titleEn', t('cannedTitleEn'))}
            {field('titleHi', t('cannedTitleHi'))}
            {field('bodyEn', t('cannedBodyEn'), true)}
            {field('bodyHi', t('cannedBodyHi'), true)}
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => {
                  setDraft({ ...draft, active: e.target.checked });
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {t('cannedActive')}
            </label>
            {error ? (
              <p role="alert" className="text-sm font-bold text-error">
                {'known' in error ? t(`err_${error.known}`) : p(error.common)}
              </p>
            ) : null}
            {saved ? (
              <p role="status" className="text-sm font-bold text-ink">
                {t('cannedSaved')}
              </p>
            ) : null}
            <button type="submit" disabled={busy} className={portalPrimary}>
              {t('cannedSave')}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
