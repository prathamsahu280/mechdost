'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { USTAAD_ACCESS_MODES, type UstaadAccessMode } from '@mechdost/shared/ustaad/codes';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';

interface AccessRow {
  value: UstaadAccessMode;
  version: number | null;
}

const List: ResponseSchema<AccessRow> = {
  safeParse(v: unknown) {
    const rows = (v as { settings?: unknown } | null)?.settings;
    if (!Array.isArray(rows)) return { success: false };
    const row = rows.find((r: unknown) => (r as { key?: unknown }).key === 'ustaad.access') as
      { value?: unknown; version?: unknown } | undefined;
    const value = row?.value;
    if (typeof value !== 'string' || !(USTAAD_ACCESS_MODES as readonly string[]).includes(value))
      return { success: false };
    return {
      success: true,
      data: {
        value: value as UstaadAccessMode,
        version: typeof row?.version === 'number' ? row.version : null,
      },
    };
  },
};
const Saved: ResponseSchema<{ version: number }> = {
  safeParse(v: unknown) {
    const version = (v as { version?: unknown } | null)?.version;
    return typeof version === 'number' ? { success: true, data: { version } } : { success: false };
  },
};

/**
 * Admin → Settings: who can open the Ustaad Network (setting `ustaad.access`, founder 2026-11-26). Real sign-in only;
 * the API checks `ustaad:settings`, compare-and-sets on the version and writes the audit log. Workstream G1 moves this
 * into Admin → Ustaad with every other network setting.
 */
export function AdminUstaadAccess() {
  const t = useTranslations('ustaad.adminAccess');
  const locale = useLocale();
  const legend = useId();
  const [current, setCurrent] = useState<AccessRow | null>(null);
  const [choice, setChoice] = useState<UstaadAccessMode | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/ustaad/settings', List);
    if (res.ok) {
      setCurrent(res.data);
      setChoice(res.data.value);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current || !choice) return null;

  async function save() {
    if (!current || !choice) return;
    setBusy(true);
    setStatus(null);
    const res = await adminApi(locale, '/admin/ustaad/settings/ustaad.access', Saved, {
      method: 'PUT',
      body: { value: choice, version: current.version },
    });
    setBusy(false);
    if (res.ok) {
      setStatus({ tone: 'ok', text: t('saved') });
      await load();
    } else setStatus({ tone: 'error', text: res.status === 409 ? t('stale') : t('error') });
  }

  return (
    <section
      aria-labelledby={legend}
      className="mb-6 rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
    >
      <fieldset>
        <legend id={legend} className="font-heading text-lg font-extrabold text-ink">
          {t('title')}
        </legend>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('lead')}</p>
        <div className="mt-4 grid gap-2 tab:grid-cols-3">
          {USTAAD_ACCESS_MODES.map((mode) => (
            <label
              key={mode}
              className={`flex min-h-12 cursor-pointer gap-3 rounded-2xl border p-3 ${
                choice === mode ? 'border-accent bg-accent-soft' : 'border-line-card'
              }`}
            >
              <input
                type="radio"
                name="ustaad-access"
                value={mode}
                checked={choice === mode}
                onChange={() => {
                  setChoice(mode);
                }}
                className="mt-1 size-5 accent-[var(--color-accent-button)]"
              />
              <span>
                <span className="block text-sm font-bold text-ink">{t(`mode_${mode}`)}</span>
                <span className="block text-[13px] leading-snug text-muted">{t(`mode_${mode}_help`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || choice === current.value}
          onClick={() => {
            void save();
          }}
          data-track="admin_ustaad_access_save"
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-50"
        >
          {t('save')}
        </button>
        <p
          role="status"
          className={`text-sm ${status?.tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}
        >
          {status ? status.text : t('current', { mode: t(`mode_${current.value}`) })}
        </p>
      </div>
    </section>
  );
}
