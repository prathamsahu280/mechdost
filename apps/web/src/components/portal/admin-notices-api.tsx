'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { OkTrue, SavedVersion } from '@mechdost/shared/admin-config-api';
import {
  NoticeTemplateListDto,
  type NoticeCatalogueEntry,
  type NoticeTemplateRow,
} from '@mechdost/shared/notice-api';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

type Lang = 'en' | 'hi';
type Channel = 'inapp' | 'push';
const LANGS: readonly Lang[] = ['en', 'hi'];
const CHANNELS: readonly Channel[] = ['inapp', 'push'];
const LIMITS = { title: 80, body: 240 } as const;

const PROBLEM_KEY = {
  NOTICE_UNKNOWN_PLACEHOLDER: 'problem_placeholder',
  NOTICE_HTML: 'problem_html',
  NOTICE_TOO_LONG: 'problem_long',
} as const;
type ProblemKey = (typeof PROBLEM_KEY)[keyof typeof PROBLEM_KEY];
const problemKeyOf = (code: string): ProblemKey | null =>
  Object.hasOwn(PROBLEM_KEY, code) ? PROBLEM_KEY[code as keyof typeof PROBLEM_KEY] : null;

type Status = 'idle' | 'busy' | 'saved' | 'reset' | 'stale' | ProblemKey | CommonErrorKey;
type RowMap = Map<string, NoticeTemplateRow>;
const rowKey = (key: string, channel: Channel, lang: Lang) => `${key}|${channel}|${lang}`;

/**
 * Admin → Notifications → Messages (spec 10, design 2026-11-15; hard rule 8): the text of the bell and push messages
 * in both languages. Defaults come from the locale files; a field left the same as the default keeps following the
 * default. Real sign-in builds only; loaded on demand next to the Emails tab.
 */
export function NoticesPanel() {
  const t = useTranslations('adminNotices');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [catalogue, setCatalogue] = useState<NoticeCatalogueEntry[] | null>(null);
  const [rows, setRows] = useState<RowMap>(new Map());
  const [error, setError] = useState<CommonErrorKey | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/notifications/notices', NoticeTemplateListDto);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setCatalogue(res.data.catalogue);
    setRows(new Map(res.data.templates.map((r) => [rowKey(r.key, r.channel, r.locale), r])));
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = (['customer', 'partner', 'staff'] as const).map((audience) => ({
    audience,
    items: (catalogue ?? []).filter((c) => c.audience === audience),
  }));

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-muted">{t('intro')}</p>
      {error ? (
        <div role="alert" className={`${adminCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{p(error)}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            {p('api_common_retry')}
          </button>
        </div>
      ) : null}
      {!catalogue && !error ? (
        <p role="status" className={`${adminCard} text-sm text-muted`}>
          {p('api_common_loading')}
        </p>
      ) : null}
      {catalogue
        ? groups.map((g) => (
            <section key={g.audience} aria-labelledby={`notices-${g.audience}`} className="space-y-3">
              <h3 id={`notices-${g.audience}`} className="font-heading text-base font-extrabold text-ink">
                {t(`group_${g.audience}`)}
              </h3>
              <ul className="grid gap-3">
                {g.items.map((entry) => (
                  <li key={entry.key} className={adminCard}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="font-heading text-base font-extrabold text-ink">
                          {entry.defaults[locale === 'hi' ? 'hi' : 'en'].title}
                        </h4>
                        <p className="text-xs font-bold text-muted">
                          {entry.key}
                          {CHANNELS.some((c) => LANGS.some((l) => rows.has(rowKey(entry.key, c, l))))
                            ? ` · ${t('state_edited')}`
                            : ` · ${t('state_default')}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-expanded={open === entry.key}
                        data-disclosure-trigger={`notice-${entry.key}`}
                        data-panel-cancel={open === entry.key ? `notice-${entry.key}` : undefined}
                        className={portalQuiet}
                        onClick={() => {
                          setOpen(open === entry.key ? null : entry.key);
                        }}
                      >
                        {open === entry.key ? t('close') : t('edit')}
                      </button>
                    </div>
                    {open === entry.key ? (
                      <div data-panel-for={`notice-${entry.key}`}>
                        <NoticeEditor entry={entry} rows={rows} onReload={load} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        : null}
    </div>
  );
}

function NoticeEditor({
  entry,
  rows,
  onReload,
}: {
  entry: NoticeCatalogueEntry;
  rows: RowMap;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('adminNotices');
  const [channel, setChannel] = useState<Channel>('inapp');
  const [lang, setLang] = useState<Lang>('en');
  const tab = (label: string, active: boolean, on: () => void) => (
    <button
      key={label}
      type="button"
      role="tab"
      aria-selected={active}
      className={`${portalQuiet} ${active ? 'bg-pill' : ''}`}
      onClick={on}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-4 space-y-4 border-t border-line-card pt-4">
      <div className="flex flex-wrap gap-4">
        <div role="tablist" aria-label={t('channel_label')} className="flex gap-2">
          {CHANNELS.map((c) =>
            tab(t(c === 'inapp' ? 'channel_inapp' : 'channel_push'), channel === c, () => {
              setChannel(c);
            }),
          )}
        </div>
        <div role="tablist" aria-label={t('lang_label')} className="flex gap-2">
          {LANGS.map((l) =>
            tab(t(l === 'en' ? 'lang_en' : 'lang_hi'), lang === l, () => {
              setLang(l);
            }),
          )}
        </div>
      </div>
      <LangEditor
        key={`${channel}|${lang}`}
        entry={entry}
        channel={channel}
        lang={lang}
        row={rows.get(rowKey(entry.key, channel, lang))}
        onReload={onReload}
      />
    </div>
  );
}

function LangEditor({
  entry,
  channel,
  lang,
  row,
  onReload,
}: {
  entry: NoticeCatalogueEntry;
  channel: Channel;
  lang: Lang;
  row: NoticeTemplateRow | undefined;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('adminNotices');
  const locale = useLocale();
  const id = useId();
  const defaults = entry.defaults[lang];
  const [title, setTitle] = useState(row?.title ?? defaults.title);
  const [body, setBody] = useState(row?.body && row.body !== '' ? row.body : defaults.body);
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [status, setStatus] = useState<Status>('idle');

  /** A field equal to the default is stored as "default" so it keeps following the shipped text. */
  const stored = (value: string, fallback: string) => {
    const v = value.trim();
    return v === '' || v === fallback.trim() ? null : v;
  };
  const problem = useMemo<ProblemKey | null>(() => {
    const allowed = new Set(entry.placeholders);
    for (const [v, max] of [
      [title, LIMITS.title],
      [body, LIMITS.body],
    ] as const) {
      if (v.length > max) return 'problem_long';
      if (/[<>]/.test(v)) return 'problem_html';
      for (const m of v.matchAll(/\{(\w*)\}/g)) if (!allowed.has(m[1] ?? '')) return 'problem_placeholder';
    }
    return null;
  }, [title, body, entry.placeholders]);

  const fail = (code: string): Status =>
    problemKeyOf(code) ?? (code === 'STALE_TEMPLATE' || code === 'CONFLICT' ? 'stale' : commonErrorKey(code));

  async function save() {
    if (problem) {
      setStatus(problem);
      return;
    }
    setStatus('busy');
    const res = await adminApi(locale, '/admin/notifications/notices', SavedVersion, {
      method: 'PUT',
      body: {
        key: entry.key,
        channel,
        locale: lang,
        title: stored(title, defaults.title),
        body: stored(body, defaults.body),
        enabled,
        version: row?.version ?? null,
      },
    });
    if (!res.ok) {
      setStatus(fail(res.code));
      return;
    }
    track('admin_notifications_change', { target: entry.key, action: 'saved' });
    setStatus('saved');
    await onReload();
  }

  async function reset() {
    if (!row) return;
    setStatus('busy');
    const res = await adminApi(locale, '/admin/notifications/notices/reset', OkTrue, {
      method: 'POST',
      body: { key: entry.key, channel, locale: lang, version: row.version },
    });
    if (!res.ok) {
      setStatus(fail(res.code));
      return;
    }
    track('admin_notifications_change', { target: entry.key, action: 'reset' });
    setStatus('reset');
    await onReload();
  }

  const statusText =
    status === 'saved'
      ? t('saved')
      : status === 'reset'
        ? t('reset_done')
        : status === 'stale'
          ? t('err_stale')
          : status === 'idle' || status === 'busy'
            ? ''
            : status.startsWith('problem_')
              ? t(status as ProblemKey)
              : null;
  const toolsId = `${id}-tools`;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t('field_help')}</p>
      <label className="block text-sm font-bold text-ink">
        {t('field_title')}
        <input
          className={portalField}
          value={title}
          maxLength={LIMITS.title + 20}
          onChange={(e) => {
            setTitle(e.target.value);
            setStatus('idle');
          }}
        />
      </label>
      <label className="block text-sm font-bold text-ink">
        {t('field_body')}
        <textarea
          className={`${portalField} min-h-24 py-2`}
          value={body}
          maxLength={LIMITS.body + 40}
          onChange={(e) => {
            setBody(e.target.value);
            setStatus('idle');
          }}
        />
      </label>
      <p id={toolsId} className="text-xs text-muted">
        {entry.placeholders.length > 0
          ? t('placeholders', { list: entry.placeholders.map((x) => `{${x}}`).join(' ') })
          : t('no_placeholders')}
      </p>
      <label className="inline-flex min-h-11 items-center gap-3 text-sm font-bold text-ink">
        <input
          type="checkbox"
          checked={enabled}
          className="size-5 accent-[var(--color-accent-button)]"
          onChange={(e) => {
            setEnabled(e.target.checked);
            setStatus('idle');
          }}
        />
        {t(channel === 'inapp' ? 'switch_inapp' : 'switch_push')}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={portalPrimary}
          disabled={status === 'busy'}
          onClick={() => void save()}
        >
          {status === 'busy' ? t('saving') : t('save')}
        </button>
        {row ? (
          <button
            type="button"
            className={portalQuiet}
            disabled={status === 'busy'}
            onClick={() => void reset()}
          >
            {t('reset')}
          </button>
        ) : null}
      </div>
      <p role={statusText ? 'status' : undefined} aria-live="polite" className="min-h-5 text-sm text-muted">
        {statusText ?? <FailedText code={status as CommonErrorKey} />}
      </p>
    </div>
  );
}

function FailedText({ code }: { code: CommonErrorKey }) {
  const p = useTranslations('portal');
  return <span className="font-bold text-error">{p(code)}</span>;
}
