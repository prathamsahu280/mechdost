'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { StaffListDto, StaffMemberDto } from '@mechdost/shared/admin-people-api';
import { fetchStaff, grantStaff, revokeStaff } from '@/lib/admin-people-api';
import { formatDateTimeIst, peopleErrorKey } from '@/lib/admin-people-view';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

/** The staff roles the catalogue defines; their names are translated here (the API sends the English names). */
const ROLE_KEYS = [
  'super_admin',
  'ops_manager',
  'city_manager',
  'support_agent',
  'finance',
  'catalogue_manager',
  'marketing',
] as const;
type RoleKey = (typeof ROLE_KEYS)[number];
const isRoleKey = (v: string): v is RoleKey => (ROLE_KEYS as readonly string[]).includes(v);

type Mode = 'idle' | 'grant' | { revoke: string };
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * Admin → Staff (real sign-in builds; design 2026-11-15, spec 08/13): who holds a staff role, with city scope, last
 * sign-in and phone-code state. One primary action: give a role (phone, role, city for city roles, a reason). Each
 * role has a quiet "Remove" that asks for a reason in place. Your own roles show no controls (nobody edits their
 * own); the API enforces every rule, this screen only explains the refusals.
 */
export function AdminStaffApi() {
  const t = useTranslations('adminPeople');
  const tc = useTranslations('portal');
  const locale = useLocale();
  const [data, setData] = useState<StaffListDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetchStaff(locale);
    if (!res.ok) {
      setLoadError(res.code);
      return;
    }
    setLoadError(null);
    setData(res.data);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const errorText = (code: string) => {
    const own = peopleErrorKey(code);
    return own ? t(own) : tc(commonErrorKey(code));
  };
  const roleName = (key: string, fallback: string) => (isRoleKey(key) ? t(`role_${key}`) : fallback);
  const cityName = (id: string | null) => {
    const c = data?.cities.find((x) => x.id === id);
    if (!c) return t('staff_allCities');
    return locale === 'hi' && c.nameHi ? c.nameHi : c.name;
  };

  function open(next: Mode) {
    setMode(next);
    setError(null);
    if (next === 'grant') {
      track('admin_staff_screen', { action: 'grant_opened' });
      setRole('');
      setTimeout(() => phoneRef.current?.focus(), 0);
    } else if (typeof next === 'object') {
      setTimeout(() => document.getElementById(`revoke-${next.revoke}`)?.focus(), 0);
    }
  }

  async function onGrant(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const chosen = text(f.get('role'));
    const option = data?.roles.find((r) => r.key === chosen);
    const city = text(f.get('city'));
    if (!option) {
      setError('VALIDATION');
      return;
    }
    setBusy(true);
    const res = await grantStaff(locale, {
      phone: text(f.get('phone')).trim(),
      role: chosen,
      cityId: option.scope === 'city' && city ? city : null,
      reason: text(f.get('reason')).trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('admin_staff_screen', { action: 'grant_saved' });
    setMode('idle');
    await load();
  }

  async function onRevoke(e: SyntheticEvent<HTMLFormElement>, grantId: string) {
    e.preventDefault();
    const reason = text(new FormData(e.currentTarget).get('reason')).trim();
    setBusy(true);
    const res = await revokeStaff(locale, grantId, reason);
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('admin_staff_screen', { action: 'revoke_confirmed' });
    setMode('idle');
    await load();
  }

  const errorLine = error ? (
    <p id="staff-error" role="alert" className="mt-2 text-sm font-bold text-error">
      {errorText(error)}
    </p>
  ) : null;

  return (
    <section aria-labelledby="staff-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="staff-title" className="font-heading text-xl font-extrabold text-ink">
            {t('staff_title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('staff_lead')}</p>
        </div>
        {data && mode !== 'grant' ? (
          <button
            data-disclosure-trigger="staff-grant"
            type="button"
            className={portalPrimary}
            onClick={() => {
              open('grant');
            }}
          >
            {t('staff_give')}
          </button>
        ) : null}
      </div>

      {!data && !loadError ? (
        <p role="status" className="text-sm text-muted">
          {tc('api_common_loading')}
        </p>
      ) : null}
      {loadError ? (
        <div role="alert" className={`${portalCard} flex flex-wrap items-center gap-3`}>
          <p className="text-sm font-bold text-error">{errorText(loadError)}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            {tc('api_common_retry')}
          </button>
        </div>
      ) : null}

      {data && mode === 'grant' ? (
        <form
          noValidate
          onSubmit={(e) => {
            void onGrant(e);
          }}
          aria-labelledby="staff-give-title"
          className={`${portalCard} grid gap-3 min-[700px]:grid-cols-2`}
        >
          <h3
            id="staff-give-title"
            className="font-heading text-base font-extrabold text-ink min-[700px]:col-span-2"
          >
            {t('staff_give')}
          </h3>
          <div>
            <label htmlFor="staff-phone" className="text-sm font-bold text-ink">
              {t('staff_phone')}
            </label>
            <input
              ref={phoneRef}
              id="staff-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={20}
              aria-describedby="staff-phone-help"
              className={portalField}
            />
            <p id="staff-phone-help" className="mt-1 text-xs text-muted">
              {t('staff_phoneHelp')}
            </p>
          </div>
          <div>
            <label htmlFor="staff-role" className="text-sm font-bold text-ink">
              {t('staff_role')}
            </label>
            <select
              id="staff-role"
              name="role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
              }}
              className={portalField}
            >
              <option value="" disabled>
                {t('staff_rolePick')}
              </option>
              {data.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {roleName(r.key, r.name)}
                </option>
              ))}
            </select>
          </div>
          {data.roles.find((r) => r.key === role)?.scope === 'city' ? (
            <div>
              <label htmlFor="staff-city" className="text-sm font-bold text-ink">
                {t('staff_city')}
              </label>
              <select id="staff-city" name="city" defaultValue="" className={portalField}>
                <option value="" disabled>
                  {t('staff_cityPick')}
                </option>
                {data.cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === 'hi' && c.nameHi ? c.nameHi : c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="min-[700px]:col-span-2">
            <label htmlFor="staff-reason" className="text-sm font-bold text-ink">
              {t('staff_reason')}
            </label>
            <input
              id="staff-reason"
              name="reason"
              autoComplete="off"
              maxLength={300}
              aria-describedby={error ? 'staff-error' : undefined}
              className={portalField}
            />
            {errorLine}
          </div>
          <div className="flex flex-wrap gap-2 min-[700px]:col-span-2">
            <button type="submit" disabled={busy} className={portalPrimary}>
              {t('staff_save')}
            </button>
            <button
              data-panel-cancel="staff-grant"
              type="button"
              className={portalQuiet}
              onClick={() => {
                open('idle');
              }}
            >
              {t('staff_cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {data?.staff.length === 0 ? (
        <div className={portalCard}>
          <p className="text-sm text-muted">{t('staff_empty')}</p>
        </div>
      ) : null}

      {data ? (
        <ul className="space-y-3">
          {data.staff.map((m) => (
            <MemberCard
              key={m.userId}
              member={m}
              roleName={roleName}
              cityName={cityName}
              mode={mode}
              busy={busy}
              errorLine={errorLine}
              error={error}
              onOpen={open}
              onRevoke={onRevoke}
            />
          ))}
        </ul>
      ) : null}
      {data?.truncated ? <p className="text-sm text-muted">{t('staff_truncated')}</p> : null}
    </section>
  );
}

function MemberCard({
  member: m,
  roleName,
  cityName,
  mode,
  busy,
  errorLine,
  error,
  onOpen,
  onRevoke,
}: {
  member: StaffMemberDto;
  roleName: (key: string, fallback: string) => string;
  cityName: (id: string | null) => string;
  mode: Mode;
  busy: boolean;
  errorLine: React.ReactNode;
  error: string | null;
  onOpen: (m: Mode) => void;
  onRevoke: (e: SyntheticEvent<HTMLFormElement>, grantId: string) => Promise<void>;
}) {
  const t = useTranslations('adminPeople');
  const locale = useLocale();
  return (
    <li className={portalCard}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading text-base font-extrabold break-words text-ink">
            <span data-user-content>{m.name ?? t('staff_noName')}</span>
            {m.isSelf ? (
              <span className="ml-2 rounded-pill bg-pill px-2.5 py-0.5 text-xs font-bold text-muted">
                {t('staff_you')}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted" lang="en">
            {m.phoneMasked ?? ''} {m.emailMasked ? `· ${m.emailMasked}` : ''}
          </p>
        </div>
        <span
          className={`rounded-pill px-3 py-1 text-xs font-extrabold ${
            m.twoFactor === 'ready' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
          }`}
        >
          {m.twoFactor === 'ready' ? t('staff_2faReady') : t('staff_2faMissing')}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {m.lastSignInAt
          ? t('staff_lastSignIn', { when: formatDateTimeIst(m.lastSignInAt, locale) })
          : t('staff_neverSignedIn')}
        {m.status !== 'active' ? ` · ${t('staff_inactive')}` : ''}
      </p>
      <ul className="mt-3 space-y-2">
        {m.grants.map((g) => {
          const label = roleName(g.role, g.roleName);
          const removing = typeof mode === 'object' && mode.revoke === g.grantId;
          return (
            <li key={g.grantId} className="rounded-lg bg-surface-alt px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink">
                  {label}
                  <span className="font-normal text-muted"> · {cityName(g.cityId)}</span>
                </p>
                {!m.isSelf && !removing ? (
                  <button
                    data-disclosure-trigger={`revoke-${g.grantId}`}
                    type="button"
                    className={portalQuiet}
                    onClick={() => {
                      onOpen({ revoke: g.grantId });
                    }}
                  >
                    {t('staff_remove')}
                    <span className="sr-only"> {label}</span>
                  </button>
                ) : null}
              </div>
              {removing ? (
                <form
                  noValidate
                  onSubmit={(e) => {
                    void onRevoke(e, g.grantId);
                  }}
                  className="mt-2"
                >
                  <label htmlFor={`revoke-${g.grantId}`} className="text-sm font-bold text-ink">
                    {t('staff_removeReason', { role: label })}
                  </label>
                  <input
                    id={`revoke-${g.grantId}`}
                    name="reason"
                    autoComplete="off"
                    maxLength={300}
                    aria-describedby={error ? 'staff-error' : undefined}
                    className={portalField}
                  />
                  {errorLine}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="submit" disabled={busy} className={portalPrimary}>
                      {t('staff_removeConfirm')}
                    </button>
                    <button
                      data-panel-cancel={`revoke-${g.grantId}`}
                      type="button"
                      className={portalQuiet}
                      onClick={() => {
                        onOpen('idle');
                      }}
                    >
                      {t('staff_cancel')}
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
