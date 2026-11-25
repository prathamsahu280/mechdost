'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { AdminCompany, AdminCompanySaved } from '@mechdost/shared/admin-config-api';
import {
  cleanCompanyField,
  COMPANY_FIELDS,
  COMPANY_MAX,
  EMPTY_COMPANY,
  type CompanyField,
} from '@mechdost/shared/company';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { companyFacts, site } from '@/lib/site';
import { LoadState } from './admin-site-api';
import { portalField, portalPrimary } from './portal-styles';
import { adminCard } from './admin-ui';

/**
 * Admin -> Settings -> Company details (design 2026-11-15 item 8; Consumer Protection (E-Commerce) Rules 2020). Legal
 * name, CIN, GSTIN, registered address and the grievance officer, in English and Hindi where they are words. What is
 * filled shows in the website footer, the policy pages and the email footer; a field left empty shows nothing (the
 * legal name, GSTIN and address keep their built-in text). Needs an all-cities `settings:write` to save.
 */
type Status = 'idle' | 'busy' | 'saved' | 'invalid' | CommonErrorKey;

const LABEL = {
  legalName: 'com_legalName',
  legalNameHi: 'com_legalNameHi',
  cin: 'com_cin',
  gstin: 'com_gstin',
  registeredAddress: 'com_address',
  registeredAddressHi: 'com_addressHi',
  grievanceName: 'com_grievanceName',
  grievanceNameHi: 'com_grievanceNameHi',
  grievanceEmail: 'com_grievanceEmail',
  grievancePhone: 'com_grievancePhone',
} as const satisfies Record<CompanyField, string>;

const GROUPS: { id: 'legal' | 'grievance'; fields: CompanyField[] }[] = [
  {
    id: 'legal',
    fields: ['legalName', 'legalNameHi', 'cin', 'gstin', 'registeredAddress', 'registeredAddressHi'],
  },
  { id: 'grievance', fields: ['grievanceName', 'grievanceNameHi', 'grievanceEmail', 'grievancePhone'] },
];
const HINT: Partial<Record<CompanyField, 'com_hint_cin' | 'com_hint_gstin' | 'com_hint_phone'>> = {
  cin: 'com_hint_cin',
  gstin: 'com_hint_gstin',
  grievancePhone: 'com_hint_phone',
};
const HI_FIELDS: readonly CompanyField[] = ['legalNameHi', 'registeredAddressHi', 'grievanceNameHi'];
const LONG_FIELDS: readonly CompanyField[] = ['registeredAddress', 'registeredAddressHi'];

export function CompanyApi() {
  const t = useTranslations('adminTier2');
  const locale = useLocale();
  const [loaded, setLoaded] = useState<{ details: Record<string, string>; version: number | null } | null>(
    null,
  );
  const [error, setError] = useState<CommonErrorKey | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/company', AdminCompany);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setLoaded(res.data);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="company-title" className="space-y-4">
      <div>
        <h2 id="company-title" className="font-heading text-xl font-extrabold text-ink">
          {t('com_title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('com_lead')}</p>
      </div>
      {loaded ? (
        <CompanyForm key={String(loaded.version)} loaded={loaded} onSaved={load} />
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

function CompanyForm({
  loaded,
  onSaved,
}: {
  loaded: { details: Record<string, string>; version: number | null };
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('adminTier2');
  const locale = useLocale();
  const [draft, setDraft] = useState<Record<CompanyField, string>>(() => ({
    ...EMPTY_COMPANY,
    ...Object.fromEntries(COMPANY_FIELDS.map((f) => [f, loaded.details[f] ?? ''])),
  }));
  const [bad, setBad] = useState<CompanyField | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  // Built-in texts shown as placeholders: what the website uses for a field that is left empty.
  const builtIn: Partial<Record<CompanyField, string>> = {
    legalName: companyFacts('en').company,
    legalNameHi: companyFacts('hi').company,
    gstin: site.gstin,
    registeredAddress: companyFacts('en').registeredAddress,
    registeredAddressHi: companyFacts('hi').registeredAddress,
  };

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const first = COMPANY_FIELDS.find((f) => cleanCompanyField(f, draft[f]) === null);
    if (first) {
      setBad(first);
      setStatus('invalid');
      document.getElementById(`company-${first}`)?.focus();
      return;
    }
    setBad(null);
    setStatus('busy');
    const res = await adminApi(locale, '/admin/company', AdminCompanySaved, {
      method: 'PUT',
      body: { details: draft, version: loaded.version },
    });
    if (!res.ok) {
      const field = (res.details as { field?: unknown } | undefined)?.field;
      const named = COMPANY_FIELDS.find((f) => f === field);
      if (res.code === 'COMPANY_INVALID' && named) {
        setBad(named);
        setStatus('invalid');
      } else setStatus(commonErrorKey(res.code));
      await onSaved();
      return;
    }
    setStatus('saved');
    track('admin_site_change', {
      area: 'company',
      action: 'save',
      fields: COMPANY_FIELDS.filter((f) => draft[f].trim() !== '').length,
    });
    await onSaved();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className={`${adminCard} space-y-6`}
      noValidate
    >
      {GROUPS.map((group) => (
        <fieldset key={group.id}>
          <legend className="font-heading text-base font-extrabold text-ink">
            {t(`com_group_${group.id}`)}
          </legend>
          <p className="mt-1 text-xs text-muted">{t(`com_groupNote_${group.id}`)}</p>
          <div className="mt-3 grid gap-4 tab:grid-cols-2">
            {group.fields.map((f) => {
              const id = `company-${f}`;
              const hint = HINT[f];
              const long = LONG_FIELDS.includes(f);
              const common = {
                id,
                value: draft[f],
                maxLength: COMPANY_MAX[f],
                placeholder: builtIn[f] ?? '',
                // English fields are declared `en`: the statutory legal name and address stay English on /hi (audit 2C ruling).
                lang: HI_FIELDS.includes(f) ? 'hi' : 'en',
                'aria-invalid': bad === f ? true : undefined,
                'aria-describedby': `${id}-hint${bad === f ? ` ${id}-error` : ''}`,
                className: `${portalField} ${long ? 'min-h-20 py-2' : ''}`,
              };
              const set = (v: string) => {
                setStatus('idle');
                setBad(null);
                setDraft((d) => ({ ...d, [f]: v }));
              };
              return (
                <div key={f} className={long ? 'tab:col-span-2' : undefined}>
                  <label htmlFor={id} className="text-sm font-bold text-ink">
                    {t(LABEL[f])}
                  </label>
                  {long ? (
                    <textarea
                      {...common}
                      rows={2}
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
                  <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
                    {hint
                      ? t(hint)
                      : draft[f]
                        ? t('com_count', { count: draft[f].length, max: COMPANY_MAX[f] })
                        : t('com_emptyHides')}
                  </p>
                  {bad === f ? (
                    <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-bold text-error">
                      {t('com_err_format')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {t('com_save')}
        </button>
        <CompanyStatus status={status} />
      </div>
    </form>
  );
}

function CompanyStatus({ status }: { status: Status }) {
  const t = useTranslations('adminTier2');
  const p = useTranslations('portal');
  if (status === 'idle') return <p role="status" className="text-sm font-bold" />;
  const text =
    status === 'busy'
      ? p('api_common_saving')
      : status === 'saved'
        ? t('com_saved')
        : status === 'invalid'
          ? t('com_invalid')
          : p(status);
  const tone = status === 'busy' ? 'text-muted' : status === 'saved' ? 'text-success' : 'text-error';
  return (
    <p role="status" className={`text-sm font-bold ${tone}`}>
      {text}
    </p>
  );
}
