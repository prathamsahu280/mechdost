'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  EmailTemplateList,
  OkTrue,
  SavedVersion,
  type EmailTemplateRowDto,
} from '@mechdost/shared/admin-config-api';
import { renderEmailLayout } from '@mechdost/shared/email-layout';
import {
  EMAIL_TEMPLATES,
  composeEmail,
  emailOverrideProblem,
  emailTemplateKeys,
  sampleEmailParams,
  type EmailOverride,
  type EmailTemplateKey,
} from '@mechdost/shared/email-templates';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

type Lang = 'en' | 'hi';
const LANGS: readonly Lang[] = ['en', 'hi'];
/** The API stores "no override" for a body as an empty string; the form treats it as unset. */
const nonEmpty = (v: string | null | undefined): string | null =>
  v === undefined || v === null || v === '' ? null : v;
type Rows = Partial<Record<Lang, EmailTemplateRowDto>>;

const PROBLEM_KEY = {
  EMAIL_PLACEHOLDER: 'problem_placeholder',
  EMAIL_HTML: 'problem_html',
  EMAIL_SUBJECT_LINES: 'problem_lines',
  EMAIL_TOO_LONG: 'problem_long',
  EMAIL_TEST_NO_ADDRESS: 'problem_test_address',
} as const;
type ProblemKey = (typeof PROBLEM_KEY)[keyof typeof PROBLEM_KEY];
const problemKeyOf = (code: string): ProblemKey | null =>
  Object.hasOwn(PROBLEM_KEY, code) ? PROBLEM_KEY[code as keyof typeof PROBLEM_KEY] : null;

const PURPOSE_KEY = {
  updates: 'purpose_updates',
  billing: 'purpose_billing',
  support: 'purpose_support',
  promotions: 'purpose_promotions',
  system: 'purpose_system',
} as const;

/** Admin → Notifications → Emails (spec 10, design 2026-11-15; real sign-in builds, loaded on demand). */
export function EmailsPanel() {
  const t = useTranslations('adminEmails');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [rows, setRows] = useState<EmailTemplateRowDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  const [open, setOpen] = useState<EmailTemplateKey | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/notifications/emails', EmailTemplateList);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setRows(res.data.templates);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = useMemo(() => {
    const map = new Map<string, Rows>();
    for (const r of rows ?? []) map.set(r.key, { ...map.get(r.key), [r.locale]: r });
    return map;
  }, [rows]);

  const groups = (['customer', 'partner'] as const).map((audience) => ({
    audience,
    keys: emailTemplateKeys().filter((k) => EMAIL_TEMPLATES[k].audience === audience),
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
      {!rows && !error ? (
        <p role="status" className={`${adminCard} text-sm text-muted`}>
          {p('api_common_loading')}
        </p>
      ) : null}
      {rows
        ? groups.map((g) => (
            <section key={g.audience} aria-labelledby={`emails-${g.audience}`} className="space-y-3">
              <h3 id={`emails-${g.audience}`} className="font-heading text-base font-extrabold text-ink">
                {t(g.audience === 'customer' ? 'group_customer' : 'group_partner')}
              </h3>
              <ul className="grid gap-3">
                {g.keys.map((key) => (
                  <li key={key}>
                    <EmailItem
                      templateKey={key}
                      rows={byKey.get(key) ?? {}}
                      open={open === key}
                      onToggle={() => {
                        setOpen(open === key ? null : key);
                      }}
                      onReload={load}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        : null}
    </div>
  );
}

type Status = 'idle' | 'busy' | 'saved' | 'reset' | 'test' | 'stale' | ProblemKey | CommonErrorKey;

function EmailItem({
  templateKey,
  rows,
  open,
  onToggle,
  onReload,
}: {
  templateKey: EmailTemplateKey;
  rows: Rows;
  open: boolean;
  onToggle: () => void;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('adminEmails');
  const locale = useLocale();
  const def = EMAIL_TEMPLATES[templateKey];
  const name = t(`tpl_${templateKey}`);
  const on = rows.en?.enabled !== false && rows.hi?.enabled !== false;
  const edited = LANGS.filter(
    (l) => rows[l] && (rows[l].subject ?? rows[l].heading ?? rows[l].buttonLabel ?? rows[l].body),
  );
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<CommonErrorKey | null>(null);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setFailed(null);
    for (const lang of LANGS) {
      const row = rows[lang];
      if (!row && enabled) continue;
      const res = await adminApi(locale, '/admin/notifications/emails', SavedVersion, {
        method: 'PUT',
        body: {
          key: templateKey,
          locale: lang,
          subject: row?.subject ?? null,
          heading: row?.heading ?? null,
          body: nonEmpty(row?.body),
          buttonLabel: row?.buttonLabel ?? null,
          enabled,
          version: row?.version ?? null,
        },
      });
      if (!res.ok) {
        setFailed(commonErrorKey(res.code));
        break;
      }
    }
    setBusy(false);
    setConfirmOff(false);
    track('admin_notifications_change', { target: templateKey, action: enabled ? 'enabled' : 'disabled' });
    await onReload();
  }

  return (
    <div className={adminCard}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-heading text-base font-extrabold text-ink">{name}</h4>
          <p className="mt-0.5 text-xs font-bold text-muted">
            {t(PURPOSE_KEY[def.purpose])} ·{' '}
            {edited.length > 0
              ? t('state_edited', {
                  langs: edited.map((l) => t(l === 'en' ? 'lang_en' : 'lang_hi')).join(', '),
                })
              : t('state_default')}
            {on ? '' : ` · ${t('state_off')}`}
          </p>
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold text-ink">
          {t('switch_label')}
          <input
            type="checkbox"
            role="switch"
            checked={on}
            disabled={busy}
            onChange={(e) => {
              if (e.target.checked) void setEnabled(true);
              else setConfirmOff(true);
            }}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-7 w-12 rounded-pill bg-line transition-colors peer-checked:bg-accent-button peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
          />
          <span className="w-10 text-xs text-muted">{on ? t('on') : t('off')}</span>
        </label>
      </div>
      {confirmOff ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-line-card bg-private-bg p-3 text-sm text-private"
        >
          <p className="font-bold">{t('off_title', { name })}</p>
          <p className="mt-1">{t('off_body')}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className={portalPrimary}
              disabled={busy}
              onClick={() => {
                void setEnabled(false);
              }}
            >
              {t('off_confirm')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                setConfirmOff(false);
              }}
            >
              {t('off_cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-2 text-sm font-bold text-error">
          <FailedText code={failed} />
        </p>
      ) : null}
      <div className="mt-3">
        <button
          type="button"
          aria-expanded={open}
          data-disclosure-trigger={`email-${templateKey}`}
          data-panel-cancel={open ? `email-${templateKey}` : undefined}
          className={portalQuiet}
          onClick={onToggle}
        >
          {open ? t('close') : t('edit')}
        </button>
      </div>
      {open ? (
        <div data-panel-for={`email-${templateKey}`}>
          <Editor templateKey={templateKey} rows={rows} onReload={onReload} />
        </div>
      ) : null}
    </div>
  );
}

function FailedText({ code }: { code: CommonErrorKey }) {
  const p = useTranslations('portal');
  return <>{p(code)}</>;
}

type FieldName = 'subject' | 'heading' | 'body' | 'buttonLabel';

function Editor({
  templateKey,
  rows,
  onReload,
}: {
  templateKey: EmailTemplateKey;
  rows: Rows;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('adminEmails');
  const [lang, setLang] = useState<Lang>('en');
  return (
    <div className="mt-4 space-y-4 border-t border-line-card pt-4">
      <div role="tablist" aria-label={t('lang_label')} className="flex gap-2">
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={lang === l}
            className={`${portalQuiet} ${lang === l ? 'bg-pill' : ''}`}
            onClick={() => {
              setLang(l);
            }}
          >
            {t(l === 'en' ? 'lang_en' : 'lang_hi')}
          </button>
        ))}
      </div>
      <LangEditor key={lang} templateKey={templateKey} lang={lang} row={rows[lang]} onReload={onReload} />
    </div>
  );
}

function LangEditor({
  templateKey,
  lang,
  row,
  onReload,
}: {
  templateKey: EmailTemplateKey;
  lang: Lang;
  row: EmailTemplateRowDto | undefined;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('adminEmails');
  const locale = useLocale();
  const id = useId();
  const def = EMAIL_TEMPLATES[templateKey];
  const defaults = def[lang];
  const initial = {
    subject: row?.subject ?? defaults.subject,
    heading: row?.heading ?? defaults.heading,
    body: nonEmpty(row?.body) ?? defaults.body,
    buttonLabel: row?.buttonLabel ?? defaults.button ?? '',
  };
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<Status>('idle');
  const refs = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const lastField = useRef<FieldName>('body');

  /** A field equal to the default is stored as "default" so it keeps following the code text. */
  const stored = (name: FieldName, fallback: string): string | null => {
    const v = draft[name].trim();
    return v === '' || v === fallback.trim() ? null : v;
  };
  const override: EmailOverride = {
    subject: stored('subject', defaults.subject),
    heading: stored('heading', defaults.heading),
    body: stored('body', defaults.body),
    buttonLabel: def.button ? stored('buttonLabel', defaults.button ?? '') : null,
  };
  const problem = emailOverrideProblem(templateKey, override);
  const problemKey = problem ? problemKeyOf(problem) : null;

  const html = useMemo(() => {
    const composed = composeEmail(
      templateKey,
      lang,
      sampleEmailParams(templateKey),
      { webBaseUrl: 'https://mechdost.com', grievanceContact: null },
      override,
    );
    return renderEmailLayout(composed, { locale: lang, grievanceContact: null }).html;
    // The override object is rebuilt from `draft` on every render; the draft is the real dependency.
  }, [templateKey, lang, draft]);

  function insert(placeholder: string) {
    const name = lastField.current;
    const el = refs.current[name];
    const token = `{${placeholder}}`;
    const at = el?.selectionStart ?? draft[name].length;
    const end = el?.selectionEnd ?? at;
    setDraft({ ...draft, [name]: draft[name].slice(0, at) + token + draft[name].slice(end) });
    setStatus('idle');
    el?.focus();
  }

  const fail = (code: string): Status => {
    const k = problemKeyOf(code);
    if (k) return k;
    if (code === 'STALE_TEMPLATE' || code === 'CONFLICT') return 'stale';
    return commonErrorKey(code);
  };

  async function save() {
    if (problemKey) {
      setStatus(problemKey);
      return;
    }
    setStatus('busy');
    const res = await adminApi(locale, '/admin/notifications/emails', SavedVersion, {
      method: 'PUT',
      body: {
        key: templateKey,
        locale: lang,
        ...override,
        enabled: row?.enabled ?? true,
        version: row?.version ?? null,
      },
    });
    if (!res.ok) {
      setStatus(fail(res.code));
      return;
    }
    setStatus('saved');
    track('admin_notifications_change', { target: templateKey, action: 'saved' });
    await onReload();
  }

  async function reset() {
    if (!row) return;
    setStatus('busy');
    const res = await adminApi(locale, '/admin/notifications/emails/reset', OkTrue, {
      method: 'POST',
      body: { key: templateKey, locale: lang, version: row.version },
    });
    if (!res.ok) {
      setStatus(fail(res.code));
      return;
    }
    setDraft({
      subject: defaults.subject,
      heading: defaults.heading,
      body: defaults.body,
      buttonLabel: defaults.button ?? '',
    });
    setStatus('reset');
    track('admin_notifications_change', { target: templateKey, action: 'reset' });
    await onReload();
  }

  async function test() {
    setStatus('busy');
    const res = await adminApi(locale, '/admin/notifications/emails/test', OkTrue, {
      method: 'POST',
      body: { key: templateKey, locale: lang },
    });
    if (!res.ok) {
      setStatus(fail(res.code));
      return;
    }
    setStatus('test');
    track('admin_notifications_change', { target: templateKey, action: 'test_sent' });
  }

  const fields: { name: FieldName; label: string; rows?: number }[] = [
    { name: 'subject', label: t('field_subject') },
    { name: 'heading', label: t('field_heading') },
    { name: 'body', label: t('field_body'), rows: 9 },
    ...(def.button ? [{ name: 'buttonLabel' as const, label: t('field_button') }] : []),
  ];

  return (
    <div className="grid gap-5 tab:grid-cols-2">
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-xs text-muted">{t('field_help')}</p>
        {fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={`${id}-${f.name}`} className="text-xs font-bold text-muted">
              {f.label}
            </label>
            {f.rows ? (
              <textarea
                id={`${id}-${f.name}`}
                lang={lang}
                rows={f.rows}
                value={draft[f.name]}
                ref={(el) => {
                  refs.current[f.name] = el;
                }}
                onFocus={() => {
                  lastField.current = f.name;
                }}
                aria-invalid={problemKey ? true : undefined}
                onChange={(e) => {
                  setDraft({ ...draft, [f.name]: e.target.value });
                  setStatus('idle');
                }}
                className={`${portalField} py-2`}
              />
            ) : (
              <input
                id={`${id}-${f.name}`}
                lang={lang}
                value={draft[f.name]}
                ref={(el) => {
                  refs.current[f.name] = el;
                }}
                onFocus={() => {
                  lastField.current = f.name;
                }}
                aria-invalid={problemKey ? true : undefined}
                onChange={(e) => {
                  setDraft({ ...draft, [f.name]: e.target.value });
                  setStatus('idle');
                }}
                className={portalField}
              />
            )}
          </div>
        ))}
        {def.button ? null : <p className="text-xs text-muted">{t('no_button')}</p>}
        <div>
          <p className="text-xs font-bold text-muted">{t('placeholders')}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {def.text.map((ph) => (
              <li key={ph}>
                <button
                  type="button"
                  className="press min-h-11 rounded-button border border-input-border px-3 font-mono text-xs text-ink hover:bg-pill"
                  onClick={() => {
                    insert(ph);
                  }}
                >
                  {`{${ph}}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {problemKey ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t(problemKey)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={status === 'busy' || problemKey !== null} className={portalPrimary}>
            {t('save')}
          </button>
          <button
            type="button"
            disabled={status === 'busy'}
            className={portalQuiet}
            onClick={() => void test()}
          >
            {t('test')}
          </button>
          <button
            type="button"
            disabled={status === 'busy' || !row}
            className={portalQuiet}
            onClick={() => void reset()}
          >
            {t('reset')}
          </button>
        </div>
        <StatusLine status={status} />
      </form>
      <div>
        <p className="text-xs font-bold text-muted">{t('preview')}</p>
        <iframe
          title={t('preview_title', { name: t(`tpl_${templateKey}`) })}
          sandbox=""
          srcDoc={html}
          lang={lang}
          className="mt-1 h-[34rem] w-full rounded-lg border border-line-card bg-white"
        />
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  const t = useTranslations('adminEmails');
  const p = useTranslations('portal');
  const ok = 'text-success';
  const bad = 'text-error';
  let text: string | null = null;
  let tone = 'text-muted';
  if (status === 'busy') {
    text = t('saving');
  } else if (status === 'saved') {
    text = t('saved');
    tone = ok;
  } else if (status === 'reset') {
    text = t('reset_done');
    tone = ok;
  } else if (status === 'test') {
    text = t('test_sent');
    tone = ok;
  } else if (status === 'stale') {
    text = t('err_stale');
    tone = bad;
  } else if (status.startsWith('problem_')) {
    text = t(status as ProblemKey);
    tone = bad;
  } else if (status.startsWith('api_common_err_')) {
    text = p(status as CommonErrorKey);
    tone = bad;
  }
  return (
    <p role="status" className={`text-sm font-bold ${tone}`}>
      {text}
    </p>
  );
}
