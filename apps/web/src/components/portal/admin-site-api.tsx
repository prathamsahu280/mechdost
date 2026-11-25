'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  AdminContentList,
  AdminContentSaved,
  OkTrue,
  SavedVersion,
  type AdminContentEntryDto,
} from '@mechdost/shared/admin-config-api';
import {
  CONTENT_KEYS,
  contentMax,
  isTrustKey,
  trustPlacementOf,
  TRUST_HIDDEN,
  type ContentKey,
  type TrustKey,
} from '@mechdost/shared/content';
import { adminApi } from '@/lib/admin-api';
import { contentField, contentStep } from '@/lib/admin-content-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import type { ContentDefaults } from './admin-site';
import { portalPrimary, portalQuiet, portalField } from './portal-styles';
import { adminCard } from './admin-ui';

type SaveStatus = 'idle' | 'busy' | 'saved' | 'invalid' | CommonErrorKey;

const CONTENT_LABEL = {
  'announcement.orders': 'field_announcement_orders',
  'announcement.workshops': 'field_announcement_workshops',
  'hero.eyebrow': 'field_hero_eyebrow',
  'hero.titleLine1': 'field_hero_titleLine1',
  'hero.titleLine2': 'field_hero_titleLine2',
  'hero.lead': 'field_hero_lead',
} as const satisfies Record<Exclude<ContentKey, TrustKey>, string>;

const CONTENT_GROUPS: { id: 'announcement' | 'hero' | 'trust'; keys: ContentKey[] }[] = [
  { id: 'announcement', keys: ['announcement.orders', 'announcement.workshops'] },
  { id: 'hero', keys: ['hero.eyebrow', 'hero.titleLine1', 'hero.titleLine2', 'hero.lead'] },
  {
    id: 'trust',
    keys: [
      'trust.homeGenuine',
      'trust.homeBill',
      'trust.homeEstimates',
      'trust.product',
      'trust.checkout',
      'trust.emailFooter',
      'trust.workshop',
      'trust.partner',
    ],
  },
];

function StatusLine({ status }: { status: SaveStatus }) {
  const t = useTranslations('portal');
  if (status === 'idle') return <p role="status" className="text-sm font-bold" />;
  const text =
    status === 'busy'
      ? t('api_common_saving')
      : status === 'saved'
        ? t('site_saved')
        : status === 'invalid'
          ? t('site_invalid')
          : t(status);
  const tone = status === 'busy' ? 'text-muted' : status === 'saved' ? 'text-success' : 'text-error';
  return (
    <p role="status" className={`text-sm font-bold ${tone}`}>
      {text}
    </p>
  );
}

export function LoadState({ error, onRetry }: { error: CommonErrorKey | null; onRetry: () => void }) {
  const t = useTranslations('portal');
  return error ? (
    <div role="alert" className={`${adminCard} space-y-3`}>
      <p className="text-sm font-bold text-error">{t(error)}</p>
      <button type="button" className={portalQuiet} onClick={onRetry}>
        {t('api_common_retry')}
      </button>
    </div>
  ) : (
    <p role="status" className={`${adminCard} text-sm text-muted`}>
      {t('api_common_loading')}
    </p>
  );
}

// ── Site content ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Admin → Site content on the API (spec 08; real sign-in builds). The live text per key and language: saving a
 * changed field writes its draft and publishes it; emptying a field takes the live text down (the default shows).
 */
export function ContentApi({ defaults }: { defaults: ContentDefaults }) {
  const locale = useLocale();
  const [entries, setEntries] = useState<AdminContentEntryDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);

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

  return (
    <section aria-labelledby="admin-page-title" className="space-y-4">
      {entries ? (
        <ContentForm entries={entries} defaults={defaults} onSaved={load} />
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

const draftKey = (key: string, lang: 'en' | 'hi') => `${key}|${lang}`;

function ContentForm({
  entries,
  defaults,
  onSaved,
}: {
  entries: AdminContentEntryDto[];
  defaults: ContentDefaults;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const tt = useTranslations('trust');
  const locale = useLocale();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CONTENT_KEYS.flatMap((key) =>
        (['en', 'hi'] as const).map((lang) => [draftKey(key, lang), contentField(entries, key, lang).text]),
      ),
    ),
  );
  const [status, setStatus] = useState<SaveStatus>('idle');

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('busy');
    let fields = 0;
    for (const key of CONTENT_KEYS)
      for (const lang of ['en', 'hi'] as const) {
        const step = contentStep(contentField(entries, key, lang), draft[draftKey(key, lang)] ?? '');
        if (step.kind === 'none') continue;
        fields += 1;
        const path = `/admin/content/${key}/${lang}`;
        if (step.kind === 'unpublish') {
          const res = await adminApi(locale, `${path}/unpublish`, OkTrue, {
            method: 'POST',
            body: { city: null, version: step.version },
          });
          if (!res.ok) return fail(res.code);
          continue;
        }
        const saved = await adminApi(locale, path, AdminContentSaved, {
          method: 'PUT',
          body: { city: null, value: step.text, version: step.draftVersion },
        });
        if (!saved.ok) return fail(saved.code);
        const live = await adminApi(locale, `${path}/publish`, SavedVersion, {
          method: 'POST',
          body: { city: null, version: saved.data.version },
        });
        if (!live.ok) return fail(live.code);
      }
    setStatus('saved');
    track('admin_site_change', { area: 'content', action: 'save', fields });
    await onSaved();
  }

  async function fail(code: string) {
    setStatus(code === 'CONTENT_EMPTY' ? 'invalid' : commonErrorKey(code));
    await onSaved();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={adminCard}
      noValidate
    >
      {CONTENT_GROUPS.map((group) => (
        <fieldset key={group.id} className="mt-2 first:mt-0">
          <legend className="font-heading text-lg font-extrabold text-ink">
            {group.id === 'trust' ? tt('group') : t(`content_group_${group.id}`)}
          </legend>
          {group.id === 'trust' ? <p className="mt-1 text-xs text-muted">{tt('hideHint')}</p> : null}
          <div className="mt-3 space-y-5">
            {group.keys.map((key) => {
              const max = contentMax(key);
              const long = max > 120;
              return (
                <div key={key} className="rounded-tile border border-line-card p-4">
                  <p className="text-sm font-bold text-ink">
                    {isTrustKey(key)
                      ? tt(`lineLabel_${trustPlacementOf(key) ?? 'product'}`, { brand: '{brand}' })
                      : t(CONTENT_LABEL[key])}
                  </p>
                  <div className="mt-2 grid gap-3 tab:grid-cols-2">
                    {(['en', 'hi'] as const).map((lang) => {
                      const inputId = `api-content-${key.replace('.', '_')}-${lang}`;
                      const value = draft[draftKey(key, lang)] ?? '';
                      const common = {
                        id: inputId,
                        value,
                        maxLength: max,
                        lang,
                        placeholder: defaults[key][lang],
                        'aria-describedby': `${inputId}-hint`,
                        className: `${portalField} ${long ? 'min-h-24 py-2' : ''}`,
                      };
                      const set = (next: string) => {
                        setStatus('idle');
                        setDraft((d) => ({ ...d, [draftKey(key, lang)]: next }));
                      };
                      return (
                        <div key={lang}>
                          <label htmlFor={inputId} className="text-xs font-bold text-muted">
                            {t(`content_${lang}`)}
                          </label>
                          {long ? (
                            <textarea
                              {...common}
                              rows={3}
                              onChange={(e) => {
                                set(e.target.value);
                              }}
                            />
                          ) : (
                            <input
                              {...common}
                              onChange={(e) => {
                                set(e.target.value);
                              }}
                            />
                          )}
                          <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
                            {value.trim() === TRUST_HIDDEN && isTrustKey(key)
                              ? tt('hidden')
                              : value
                                ? t('content_count', { count: value.length, max })
                                : t('content_usingDefault')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('api_content_publish')}
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}
