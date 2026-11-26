'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import {
  AdminContentList,
  AdminContentSaved,
  OkTrue,
  PolicyVersionList,
  SavedVersion,
  type AdminContentEntryDto,
  type PolicyVersionDto,
} from '@mechdost/shared/admin-config-api';
import {
  cleanPolicy,
  fillPolicyText,
  POLICY_KEYS,
  POLICY_LIMITS,
  type PolicyDoc,
  type PolicyKey,
  type PolicyProblem,
} from '@mechdost/shared/policy';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { builtInPolicy, POLICY_PATH } from '@/lib/policy-view';
import { companyFacts, site } from '@/lib/site';
import { PolicySections } from '../ui/policy-sections';
import { LoadState } from './admin-site-api';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { StatusBadge, adminCard } from './admin-ui';

/**
 * Admin -> Content -> Policy pages (design 2026-11-15 item 5; spec 08). Per policy and language: edit the sections,
 * preview them as customers will see them, save a draft, publish (needs `content:publish`; the website refreshes at
 * once), take the page down (the built-in text shows again), and restore any earlier version as a new one. Real
 * sign-in only: it reads and writes the API.
 */
type Lang = 'en' | 'hi';
type Status =
  'idle' | 'busy' | 'saved' | 'published' | 'unpublished' | 'restored' | 'invalid' | CommonErrorKey;

interface SectionDraft {
  id: number;
  heading: string;
  body: string;
  emoji: string;
}
interface Form {
  title: string;
  lead: string;
  updatedOn: string;
  sections: SectionDraft[];
}

let nextId = 1;
const toForm = (doc: PolicyDoc): Form => ({
  title: doc.title,
  lead: doc.lead,
  updatedOn: doc.updatedOn,
  sections: doc.sections.map((s) => ({
    id: nextId++,
    heading: s.heading,
    body: s.body,
    emoji: s.emoji ?? '',
  })),
});
const toDoc = (form: Form): PolicyDoc => ({
  title: form.title,
  lead: form.lead,
  updatedOn: form.updatedOn,
  sections: form.sections.map((s) => ({
    heading: s.heading,
    body: s.body,
    ...(s.emoji.trim() ? { emoji: s.emoji.trim() } : {}),
  })),
});
const isPolicy = (v: unknown): v is PolicyDoc => typeof v === 'object' && v !== null && 'sections' in v;
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST date

const PROBLEM_KEY = {
  shape: 'pol_err_shape',
  empty: 'pol_err_empty',
  too_many_sections: 'pol_err_tooMany',
  unknown_placeholder: 'pol_err_placeholder',
  date: 'pol_err_date',
  emoji: 'pol_err_emoji',
} as const satisfies Record<PolicyProblem, string>;

const POLICY_LABEL = {
  'policy.privacy': 'pol_name_privacy',
  'policy.returns': 'pol_name_returns',
  'policy.delivery': 'pol_name_delivery',
  'policy.service': 'pol_name_service',
  'policy.terms': 'pol_name_terms',
  'policy.community_rules': 'pol_name_communityRules',
} as const satisfies Record<PolicyKey, string>;

export function PoliciesApi() {
  const t = useTranslations('adminTier2');
  const locale = useLocale();
  const [entries, setEntries] = useState<AdminContentEntryDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  const [key, setKey] = useState<PolicyKey>('policy.privacy');
  const [lang, setLang] = useState<Lang>(locale === 'hi' ? 'hi' : 'en');

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/content', AdminContentList);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setEntries(res.data.entries);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const entry = entries?.find((e) => e.key === key && e.locale === lang);
  return (
    <section aria-labelledby="policies-title" className="space-y-4">
      <div>
        <h2 id="policies-title" className="font-heading text-xl font-extrabold text-ink">
          {t('pol_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('pol_lead')}</p>
      </div>
      <div className={`${adminCard} flex flex-wrap items-end gap-4`}>
        <div>
          <label htmlFor="policy-pick" className="text-sm font-bold text-ink">
            {t('pol_pick')}
          </label>
          <select
            id="policy-pick"
            value={key}
            onChange={(e) => {
              const next = POLICY_KEYS.find((k) => k === e.target.value);
              if (next) setKey(next);
            }}
            className={`${portalField} mt-1 w-64`}
          >
            {POLICY_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(POLICY_LABEL[k])}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-sm font-bold text-ink">{t('pol_language')}</legend>
          <div className="mt-1 flex gap-2">
            {(['en', 'hi'] as const).map((l) => (
              <label
                key={l}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-3 text-sm font-bold text-ink has-[:checked]:border-accent-button has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="policy-lang"
                  checked={lang === l}
                  onChange={() => {
                    setLang(l);
                  }}
                  className="size-5 accent-[var(--color-accent-button)]"
                />
                {t(l === 'en' ? 'pol_langEn' : 'pol_langHi')}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {entries ? (
        <PolicyEditor key={`${key}|${lang}`} policyKey={key} lang={lang} entry={entry} onChanged={load} />
      ) : (
        <LoadState
          error={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function PolicyEditor({
  policyKey,
  lang,
  entry,
  onChanged,
}: {
  policyKey: PolicyKey;
  lang: Lang;
  entry: AdminContentEntryDto | undefined;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('adminTier2');
  const locale = useLocale();
  const uid = useId();
  const start = [entry?.draft?.value, entry?.published?.value].find(isPolicy);
  const [form, setForm] = useState<Form | null>(start ? toForm(start) : null);
  const [status, setStatus] = useState<Status>('idle');
  const [problem, setProblem] = useState<PolicyProblem | null>(null);
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState<PolicyVersionDto[] | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const path = `/admin/content/${policyKey}/${lang}`;
  const liveVersion = entry?.published?.version ?? null;
  const hasDraft = Boolean(entry?.draft);

  const loadVersions = useCallback(async () => {
    const res = await adminApi(locale, `${path}/versions`, PolicyVersionList);
    if (res.ok) setVersions(res.data.versions);
  }, [locale, path]);
  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  function edit(change: (f: Form) => Form) {
    setStatus('idle');
    setProblem(null);
    setForm((f) => (f ? change(f) : f));
  }

  async function startFromBuiltIn() {
    const messages = (
      lang === 'hi'
        ? await import('@mechdost/shared/i18n/hi.json')
        : await import('@mechdost/shared/i18n/en.json')
    ).default;
    const doc = builtInPolicy(messages, policyKey, today());
    setForm(
      toForm(doc ?? { title: '', lead: '', updatedOn: today(), sections: [{ heading: '', body: '' }] }),
    );
    track('admin_site_change', { area: 'policies', action: 'preview', fields: 0 });
  }

  /** Check locally with the API's own rules, then save the draft; returns the draft version or null. */
  async function saveDraft(current: Form): Promise<number | null> {
    const checked = cleanPolicy(toDoc(current));
    if (!checked.ok) {
      setProblem(checked.problem);
      setStatus('invalid');
      return null;
    }
    const saved = await adminApi(locale, path, AdminContentSaved, {
      method: 'PUT',
      body: { city: null, value: checked.doc, version: entry?.draft?.version ?? null },
    });
    if (!saved.ok) {
      setStatus(saved.code === 'POLICY_INVALID' ? 'invalid' : commonErrorKey(saved.code));
      await onChanged();
      return null;
    }
    return saved.data.version;
  }

  async function onSave(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    setStatus('busy');
    const version = await saveDraft(form);
    if (version === null) return;
    setStatus('saved');
    track('admin_site_change', { area: 'policies', action: 'save', fields: form.sections.length });
    await onChanged();
  }

  async function onPublish() {
    if (!form) return;
    setStatus('busy');
    const version = await saveDraft(form);
    if (version === null) return;
    const live = await adminApi(locale, `${path}/publish`, SavedVersion, {
      method: 'POST',
      body: { city: null, version },
    });
    if (!live.ok) {
      setStatus(commonErrorKey(live.code));
      await onChanged();
      return;
    }
    setStatus('published');
    track('admin_site_change', { area: 'policies', action: 'publish', fields: form.sections.length });
    await onChanged();
    await loadVersions();
  }

  async function onUnpublish() {
    if (liveVersion === null) return;
    setStatus('busy');
    const res = await adminApi(locale, `${path}/unpublish`, OkTrue, {
      method: 'POST',
      body: { city: null, version: liveVersion },
    });
    if (!res.ok) {
      setStatus(commonErrorKey(res.code));
      await onChanged();
      return;
    }
    setStatus('unpublished');
    track('admin_site_change', { area: 'policies', action: 'reset', fields: 0 });
    await onChanged();
  }

  async function onRestore(versionNo: number) {
    setStatus('busy');
    const res = await adminApi(locale, `${path}/restore`, SavedVersion, {
      method: 'POST',
      body: { city: null, versionNo },
    });
    setConfirm(null);
    if (!res.ok) {
      setStatus(res.code === 'POLICY_INVALID' ? 'invalid' : commonErrorKey(res.code));
      return;
    }
    // The editor shows what is live now: the restored text.
    const restored = versions?.find((v) => v.versionNo === versionNo)?.value;
    if (isPolicy(restored)) setForm(toForm(restored));
    setStatus('restored');
    track('admin_site_change', { area: 'policies', action: 'restore', fields: 1 });
    await onChanged();
    await loadVersions();
  }

  if (!form)
    return (
      <div className={`${adminCard} space-y-3`}>
        <p className="text-sm text-muted">{t('pol_builtInNow')}</p>
        <button
          type="button"
          className={portalPrimary}
          onClick={() => {
            void startFromBuiltIn();
          }}
        >
          {t('pol_startFromBuiltIn')}
        </button>
      </div>
    );

  const facts = companyFacts(lang);
  const fill = (text: string) =>
    fillPolicyText(text, {
      company: facts.company,
      address: facts.registeredAddress,
      phone: site.supportPhone,
    });
  const sectionCount = form.sections.length;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          void onSave(e);
        }}
        className={`${adminCard} space-y-4`}
        noValidate
      >
        <p className="text-sm text-muted" role="note">
          {liveVersion === null
            ? t('pol_notLive')
            : t('pol_live', {
                version: liveVersion,
                date: formatDate(entry?.published?.publishedAt ?? new Date().toISOString(), locale),
              })}
          {hasDraft ? ` ${t('pol_hasDraft')}` : ''}
        </p>
        <p className="text-xs text-muted">{t('pol_placeholders')}</p>
        <div>
          <label htmlFor={`${uid}-title`} className="text-sm font-bold text-ink">
            {t('pol_fieldTitle')}
          </label>
          <input
            id={`${uid}-title`}
            lang={lang}
            maxLength={POLICY_LIMITS.title}
            value={form.title}
            onChange={(e) => {
              edit((f) => ({ ...f, title: e.target.value }));
            }}
            className={`${portalField} mt-1`}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-lead`} className="text-sm font-bold text-ink">
            {t('pol_fieldLead')}
          </label>
          <textarea
            id={`${uid}-lead`}
            lang={lang}
            rows={2}
            maxLength={POLICY_LIMITS.lead}
            value={form.lead}
            onChange={(e) => {
              edit((f) => ({ ...f, lead: e.target.value }));
            }}
            className={`${portalField} mt-1 min-h-20 py-2`}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-date`} className="text-sm font-bold text-ink">
            {t('pol_fieldUpdated')}
          </label>
          <input
            id={`${uid}-date`}
            type="date"
            value={form.updatedOn}
            onChange={(e) => {
              edit((f) => ({ ...f, updatedOn: e.target.value }));
            }}
            className={`${portalField} mt-1 w-48`}
          />
        </div>
        <ol className="space-y-3">
          {form.sections.map((s, i) => (
            <li key={s.id} className="rounded-tile border border-line-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-ink">{t('pol_sectionN', { n: i + 1 })}</p>
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    disabled={i === 0}
                    aria-label={t('pol_moveUp', { n: i + 1 })}
                    onClick={() => {
                      edit((f) => {
                        const next = [...f.sections];
                        const [item] = next.splice(i, 1);
                        if (item) next.splice(i - 1, 0, item);
                        return { ...f, sections: next };
                      });
                    }}
                    className={`${portalQuiet} min-w-11 px-0 disabled:opacity-40`}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    disabled={i === sectionCount - 1}
                    aria-label={t('pol_moveDown', { n: i + 1 })}
                    onClick={() => {
                      edit((f) => {
                        const next = [...f.sections];
                        const [item] = next.splice(i, 1);
                        if (item) next.splice(i + 1, 0, item);
                        return { ...f, sections: next };
                      });
                    }}
                    className={`${portalQuiet} min-w-11 px-0 disabled:opacity-40`}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    type="button"
                    disabled={sectionCount <= 1}
                    onClick={() => {
                      edit((f) => ({ ...f, sections: f.sections.filter((x) => x.id !== s.id) }));
                    }}
                    className={`${portalQuiet} disabled:opacity-40`}
                  >
                    {t('pol_removeSection', { n: i + 1 })}
                  </button>
                </span>
              </div>
              <div className="mt-2 grid gap-3 tab:grid-cols-[1fr_6rem]">
                <div>
                  <label htmlFor={`${uid}-h${String(s.id)}`} className="text-xs font-bold text-muted">
                    {t('pol_fieldHeading')}
                  </label>
                  <input
                    id={`${uid}-h${String(s.id)}`}
                    lang={lang}
                    maxLength={POLICY_LIMITS.heading}
                    value={s.heading}
                    onChange={(e) => {
                      edit((f) => ({
                        ...f,
                        sections: f.sections.map((x) =>
                          x.id === s.id ? { ...x, heading: e.target.value } : x,
                        ),
                      }));
                    }}
                    className={`${portalField} mt-1`}
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-e${String(s.id)}`} className="text-xs font-bold text-muted">
                    {t('pol_fieldEmoji')}
                  </label>
                  <input
                    id={`${uid}-e${String(s.id)}`}
                    maxLength={16}
                    value={s.emoji}
                    onChange={(e) => {
                      edit((f) => ({
                        ...f,
                        sections: f.sections.map((x) =>
                          x.id === s.id ? { ...x, emoji: e.target.value } : x,
                        ),
                      }));
                    }}
                    className={`${portalField} mt-1 text-center`}
                  />
                </div>
              </div>
              <label htmlFor={`${uid}-b${String(s.id)}`} className="mt-3 block text-xs font-bold text-muted">
                {t('pol_fieldBody')}
              </label>
              <textarea
                id={`${uid}-b${String(s.id)}`}
                lang={lang}
                rows={4}
                maxLength={POLICY_LIMITS.body}
                value={s.body}
                onChange={(e) => {
                  edit((f) => ({
                    ...f,
                    sections: f.sections.map((x) => (x.id === s.id ? { ...x, body: e.target.value } : x)),
                  }));
                }}
                className={`${portalField} mt-1 min-h-28 py-2`}
              />
              <p className="mt-1 text-xs text-muted">
                {t('pol_count', { count: s.body.length, max: POLICY_LIMITS.body })}
              </p>
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled={sectionCount >= POLICY_LIMITS.sections}
          onClick={() => {
            edit((f) => ({
              ...f,
              sections: [...f.sections, { id: nextId++, heading: '', body: '', emoji: '' }],
            }));
          }}
          className={`${portalQuiet} disabled:opacity-40`}
        >
          {t('pol_addSection')}
        </button>
        {status === 'invalid' ? (
          <p role="alert" className="text-sm font-bold text-error">
            {problem ? t(PROBLEM_KEY[problem]) : t('pol_err_server')}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="button"
            disabled={status === 'busy'}
            onClick={() => {
              void onPublish();
            }}
            className={portalPrimary}
          >
            {t('pol_publish')}
          </button>
          <button type="submit" disabled={status === 'busy'} className={portalQuiet}>
            {t('pol_saveDraft')}
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => {
              setPreview((p) => !p);
              track('admin_site_change', { area: 'policies', action: 'preview', fields: 0 });
            }}
            className={portalQuiet}
          >
            {preview ? t('pol_hidePreview') : t('pol_preview')}
          </button>
          {liveVersion !== null ? (
            <button
              type="button"
              disabled={status === 'busy'}
              onClick={() => {
                void onUnpublish();
              }}
              className={portalQuiet}
            >
              {t('pol_unpublish')}
            </button>
          ) : null}
          <PolicyStatus status={status} />
        </div>
      </form>

      {preview ? (
        <section aria-labelledby={`${uid}-preview`} className={adminCard}>
          <h3 id={`${uid}-preview`} className="font-heading text-lg font-extrabold text-ink">
            {t('pol_previewTitle')}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {t('pol_previewNote')}{' '}
            <a
              href={`${lang === 'hi' ? '/hi' : ''}${POLICY_PATH[policyKey]}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold underline-offset-4 hover:underline"
            >
              {t('pol_openPage')}
            </a>
          </p>
          <div lang={lang}>
            <h4 className="mt-4 font-heading text-2xl font-extrabold text-ink">{fill(form.title)}</h4>
            <p className="mt-2 text-sm text-muted">{fill(form.lead)}</p>
            <PolicySections
              sections={form.sections.map((s) => ({
                emoji: s.emoji.trim() || '📄',
                title: fill(s.heading),
                body: fill(s.body),
              }))}
              help={t('pol_previewHelp')}
              updated={t('pol_previewUpdated', { date: form.updatedOn })}
              track="admin_policy_preview_call"
            />
          </div>
        </section>
      ) : null}

      <section aria-labelledby={`${uid}-history`} className={adminCard}>
        <h3 id={`${uid}-history`} className="font-heading text-lg font-extrabold text-ink">
          {t('pol_historyTitle')}
        </h3>
        <p className="mt-1 text-xs text-muted">{t('pol_historyLead')}</p>
        {versions === null ? (
          <p role="status" className="mt-3 text-sm text-muted">
            {t('pol_historyLoading')}
          </p>
        ) : versions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('pol_historyEmpty')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {versions.map((v, i) => (
              <li
                key={v.versionNo}
                className="flex flex-wrap items-center gap-3 rounded-tile border border-line-card px-4 py-2 text-sm"
              >
                <span className="font-bold text-ink">{t('pol_versionN', { n: v.versionNo })}</span>
                <span className="text-muted">
                  {formatDate(v.createdAt, locale)}
                  {v.by ? (
                    <>
                      {' · '}
                      <span data-user-content>{v.by}</span>
                    </>
                  ) : null}
                  {v.action === 'restored' && v.restoredFrom !== null
                    ? ` · ${t('pol_restoredFrom', { n: v.restoredFrom })}`
                    : ''}
                </span>
                {i === 0 ? (
                  <StatusBadge tone="accent">{t('pol_current')}</StatusBadge>
                ) : confirm === v.versionNo ? (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">{t('pol_restoreAsk', { n: v.versionNo })}</span>
                    <button
                      type="button"
                      disabled={status === 'busy'}
                      onClick={() => {
                        void onRestore(v.versionNo);
                      }}
                      className={portalPrimary}
                    >
                      {t('pol_restoreYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirm(null);
                      }}
                      className={portalQuiet}
                    >
                      {t('pol_restoreNo')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirm(v.versionNo);
                    }}
                    className={`${portalQuiet} ml-auto`}
                  >
                    {t('pol_restore', { n: v.versionNo })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PolicyStatus({ status }: { status: Status }) {
  const t = useTranslations('adminTier2');
  const p = useTranslations('portal');
  if (status === 'idle' || status === 'invalid') return <p role="status" className="text-sm font-bold" />;
  const text =
    status === 'busy'
      ? p('api_common_saving')
      : status === 'saved'
        ? t('pol_savedDraft')
        : status === 'published'
          ? t('pol_published')
          : status === 'unpublished'
            ? t('pol_unpublished')
            : status === 'restored'
              ? t('pol_restored')
              : p(status);
  const ok =
    status === 'saved' || status === 'published' || status === 'unpublished' || status === 'restored';
  return (
    <p
      role="status"
      className={`text-sm font-bold ${status === 'busy' ? 'text-muted' : ok ? 'text-success' : 'text-error'}`}
    >
      {text}
    </p>
  );
}
