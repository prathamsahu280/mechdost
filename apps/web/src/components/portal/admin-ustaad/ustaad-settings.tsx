'use client';

import { Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { USTAAD_LOCKED_ITEMS } from '@mechdost/shared/ustaad/admin-rules';
import {
  UstaadSettingsListDto,
  UstaadSettingsSavedDto,
  WordListDto,
  type UstaadSettingsList,
} from '@mechdost/shared/ustaad/dto/admin';
import {
  USTAAD_SETTINGS,
  type UstaadSettingKey,
  type UstaadSettingSpec,
} from '@mechdost/shared/ustaad/settings';
import { Switch } from '@/components/ui/switch';
import { adminApi } from '@/lib/admin-api';
import {
  ACCESS_KEY,
  USTAAD_ADMIN_SECTIONS,
  VIDEO_REASONS,
  adminMessage,
  changesOf,
  fieldProblems,
  flatKey,
  invariantMessage,
  isLockedKey,
  keysOfSection,
  needsVideoReason,
  riskOf,
  sectionFromQuery,
  toInput,
  unitOf,
  type FieldProblem,
  type UstaadAdminSection,
} from '@/lib/admin-ustaad-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { ConfirmDialog } from '../admin-settings-workbench';
import { LoadState } from '../admin-site-api';
import { StatusBadge, adminCard } from '../admin-ui';
import { PortalNavLink } from '../portal-nav-link';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';
import { UstaadSectionTables } from './ustaad-tables';

type Row = UstaadSettingsList['settings'][number];
type Status = { tone: 'ok' | 'error'; text: string } | null;

const ACCESS_MODES = ['off', 'staff_preview', 'open'] as const;

/**
 * Admin → Ustaad Network (spec 23 § 15; task G1; real sign-in builds). The access switch first (off · staff preview ·
 * open), then the ten sections of the network's settings, each with its rows (label, one-line help, range and
 * default, the value) and its lists (levels, badges, hashtags, words, reasons, cities, promotions, tutorial). One
 * save bar for every setting: the changed keys go in one request (invariants on the merged set, compare-and-set);
 * the access switch, switching the network off and a video above 180 s are confirmed first. Locked items (staff
 * final approval, the Sponsored label, the distance bands, the locked switches) are shown read-only.
 */
export function AdminUstaadApi({
  controlled,
}: {
  /**
   * G2: the community console owns the section switcher (one switcher for the community sections and these ten);
   * then this screen shows only the chosen section, and the audit link only to those who can read the audit log.
   */
  controlled?: {
    section: UstaadAdminSection;
    onSection: (s: UstaadAdminSection) => void;
    showAuditLink: boolean;
  };
} = {}) {
  const t = useTranslations('ustaad.admin');
  const p = useTranslations('portal');
  const locale = useLocale();
  const baseId = useId();
  const [data, setData] = useState<UstaadSettingsList | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [protectedWords, setProtectedWords] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [ownSection, setOwnSection] = useState<UstaadAdminSection>('general');
  const section = controlled?.section ?? ownSection;
  const setSection = (s: UstaadAdminSection) => {
    if (controlled) controlled.onSection(s);
    else setOwnSection(s);
  };
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [serverProblem, setServerProblem] = useState<{ key: string; code: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, words] = await Promise.all([
      adminApi(locale, '/admin/ustaad/settings', UstaadSettingsListDto),
      adminApi(locale, '/admin/ustaad/words', WordListDto),
    ]);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setData(res.data);
    if (words.ok)
      setProtectedWords(words.data.words.filter((w) => w.list === 'protected' && w.active).length);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Saved." stays a few seconds, an error until the next edit; then the bar goes away.
  useEffect(() => {
    if (status?.tone !== 'ok') return;
    const timer = window.setTimeout(() => {
      setStatus(null);
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status]);

  // `?sec=promo` opens that section (a refresh or a shared link keeps the place).
  // A controlled screen gets its section from the console instead.
  const isControlled = controlled !== undefined;
  useEffect(() => {
    if (!isControlled)
      setOwnSection(sectionFromQuery(new URLSearchParams(window.location.search).get('sec')));
  }, [isControlled]);

  const rows = useMemo(() => data?.settings ?? [], [data]);
  const canEdit = data?.canEdit ?? false;
  const changes = useMemo(() => changesOf(rows, draft), [rows, draft]);
  const problems = useMemo(
    () =>
      fieldProblems(rows, draft, {
        superAdmin: data?.canRaiseVideo ?? false,
        reasonCode: reason,
        protectedWords,
      }),
    [rows, draft, data, reason, protectedWords],
  );
  const risky = changes.filter((c) => riskOf(c) !== null);
  const askReason = needsVideoReason(changes);

  // Leaving with unsaved edits asks first (browser prompt), as on Admin → Settings.
  useEffect(() => {
    if (changes.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [changes.length]);

  function pick(id: UstaadAdminSection, via: 'list' | 'select') {
    setSection(id);
    try {
      window.history.replaceState(window.history.state, '', `?sec=${id}`);
    } catch {
      // The address bar is a convenience only.
    }
    track('admin_settings_nav', { category: `ustaad_${id}`, via });
  }

  function edit(key: UstaadSettingKey, value: string) {
    setStatus(null);
    setServerProblem(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function discard() {
    track('admin_settings_discard', { fields: changes.length });
    setDraft({});
    setReason('');
    setStatus(null);
    setServerProblem(null);
    setPendingFocus(`${baseId}-sec-title`);
  }

  // Focus moves after the render that shows the target (another section, the heading after a save).
  useEffect(() => {
    if (!pendingFocus) return;
    const el = document.getElementById(pendingFocus);
    if (el) {
      el.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, section, data]);

  function requestSave() {
    if (changes.length === 0 || busy) return;
    const first = Object.keys(problems)[0];
    if (first) {
      setStatus({ tone: 'error', text: t('invalid') });
      const key = first as UstaadSettingKey;
      const where = key === ACCESS_KEY ? null : keysOfSectionOf(key);
      if (where) setSection(where);
      setPendingFocus(
        key === 'ustaad.posts.video_max_s' && askReason ? `${baseId}-reason` : `${baseId}-${flatKey(key)}`,
      );
      return;
    }
    if (risky.length > 0) setConfirming(true);
    else void save();
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await sendSave();
    } finally {
      setBusy(false);
      // The buttons of the bar are disabled now: keep the keyboard on the page, at the section heading.
      setPendingFocus(`${baseId}-sec-title`);
    }
  }

  async function sendSave() {
    const res = await adminApi(locale, '/admin/ustaad/settings', UstaadSettingsSavedDto, {
      method: 'PATCH',
      body: {
        changes: changes.map((c) => ({ key: c.key, value: c.value, version: c.version })),
        ...(askReason && reason ? { reasonCode: reason } : {}),
      },
    });
    if (res.ok) {
      track('admin_ustaad_change', { area: 'settings', action: 'save', fields: changes.length });
      setDraft({});
      setReason('');
      setStatus({ tone: 'ok', text: t('saved') });
    } else {
      const key = detailKey(res.details);
      if (key && (res.code.startsWith('SETTING_') || res.code === 'VALIDATION'))
        setServerProblem({ key, code: res.code });
      // Someone else saved meanwhile: show their values (the message says so) instead of re-basing the edits on them.
      if (res.code === 'STALE_SETTING') setDraft({});
      setStatus({
        tone: 'error',
        text:
          res.code === 'STALE_SETTING'
            ? t('stale')
            : res.code.startsWith('SETTING_')
              ? t('invalid')
              : p(commonErrorKey(res.code)),
      });
    }
    await load();
  }

  if (!data) return <LoadState error={loadError} onRetry={() => void load()} />;

  const problemOf = (key: UstaadSettingKey): FieldProblem | undefined => {
    if (serverProblem?.key === key)
      return serverProblem.code === 'SETTING_RANGE' && USTAAD_SETTINGS[key].kind === 'int'
        ? {
            kind: 'range',
            min: (USTAAD_SETTINGS[key] as { min: number }).min,
            max: (USTAAD_SETTINGS[key] as { max: number }).max,
          }
        : {
            kind: serverProblem.code === 'SETTING_RELATION' ? 'relation' : 'invariant',
            message: invariantMessage(key),
          };
    return problems[key];
  };

  const accessRow = rows.find((r) => r.key === ACCESS_KEY);
  const accessValue = draft[ACCESS_KEY] ?? (accessRow ? toInput(accessRow.value) : 'staff_preview');
  const barOpen = changes.length > 0 || busy || status !== null;

  return (
    <div className="space-y-5">
      {!canEdit ? (
        <p role="note" className="rounded-tile bg-pill px-4 py-3 text-sm text-ink">
          {t('readonly_note')}
        </p>
      ) : null}

      <AccessCard
        value={accessValue}
        saved={accessRow ? toInput(accessRow.value) : 'staff_preview'}
        disabled={!canEdit || busy}
        onChange={(v) => {
          edit(ACCESS_KEY, v);
        }}
      />

      <div
        className={
          controlled
            ? 'min-w-0'
            : 'grid gap-4 min-[1200px]:grid-cols-[230px_minmax(0,1fr)] min-[1200px]:items-start'
        }
      >
        <div className={controlled ? 'hidden' : 'min-w-0'}>
          <div className="tab:hidden">
            <label htmlFor={`${baseId}-sec`} className="text-sm font-bold text-ink">
              {t('nav_select')}
            </label>
            <select
              id={`${baseId}-sec`}
              value={section}
              onChange={(e) => {
                pick(sectionFromQuery(e.target.value), 'select');
              }}
              className={portalField}
            >
              {USTAAD_ADMIN_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(adminMessage(`sec_${s}`))}
                  {dirtyIn(s, changes) > 0 ? ` (${String(dirtyIn(s, changes))})` : ''}
                </option>
              ))}
            </select>
          </div>
          <nav aria-label={t('nav_label')} className="hidden tab:block">
            <ul className="flex gap-2 overflow-x-auto pb-1 min-[1200px]:flex-col min-[1200px]:gap-1 min-[1200px]:overflow-visible min-[1200px]:pb-0">
              {USTAAD_ADMIN_SECTIONS.map((s) => (
                <li key={s} className="shrink-0">
                  <button
                    type="button"
                    aria-current={s === section ? 'true' : undefined}
                    onClick={() => {
                      pick(s, 'list');
                    }}
                    className={`press flex min-h-11 w-full items-center gap-2 rounded-pill px-4 text-left text-sm font-bold whitespace-nowrap min-[1200px]:rounded-button min-[1200px]:whitespace-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                      s === section ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
                    }`}
                  >
                    <span className="min-w-0 flex-1">{t(adminMessage(`sec_${s}`))}</span>
                    {dirtyIn(s, changes) > 0 ? (
                      <span className="rounded-pill bg-warning-bg px-2 text-xs text-warning">
                        <span className="sr-only">{t('bar_dirty', { count: dirtyIn(s, changes) })}</span>
                        <span aria-hidden="true">{dirtyIn(s, changes)}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <section aria-labelledby={`${baseId}-sec-title`} className="min-w-0 space-y-4">
          <div>
            <h3
              id={`${baseId}-sec-title`}
              tabIndex={-1}
              className="font-heading text-lg font-extrabold text-ink"
            >
              {t(adminMessage(`sec_${section}`))}
            </h3>
            <p className="mt-0.5 max-w-prose text-sm text-muted">{t(adminMessage(`sec_${section}_help`))}</p>
          </div>

          <ul className={`${adminCard} divide-y divide-line !py-1`}>
            {keysOfSection(section).map((key) => (
              <SettingRow
                key={key}
                id={`${baseId}-${flatKey(key)}`}
                settingKey={key}
                row={rows.find((r) => r.key === key)}
                value={draft[key]}
                problem={problemOf(key)}
                disabled={!canEdit || busy}
                onChange={(v) => {
                  edit(key, v);
                }}
              />
            ))}
            {USTAAD_LOCKED_ITEMS.filter((l) => lockedSection(l.item) === section).map((l) => (
              <LockedItemRow key={l.item} item={l} />
            ))}
          </ul>

          {section === 'posts' && askReason ? (
            <VideoReason
              id={`${baseId}-reason`}
              value={reason}
              superAdmin={data.canRaiseVideo}
              onChange={setReason}
            />
          ) : null}

          <UstaadSectionTables section={section} canEdit={canEdit} onWordsChanged={() => void load()} />

          {section === 'general' ? <LaterCard /> : null}

          {controlled && !controlled.showAuditLink ? null : (
            <PortalNavLink
              href={`${locale === 'hi' ? '/hi' : ''}/admin/audit`}
              className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
            >
              {t('audit_link')}
            </PortalNavLink>
          )}
        </section>
      </div>

      {canEdit ? (
        <SaveBar
          open={barOpen}
          dirty={changes.length}
          busy={busy}
          status={status}
          onDiscard={discard}
          onSave={requestSave}
        />
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t('confirm_title')}
        lead={t('confirm_lead')}
        confirmLabel={t('confirm_save')}
        backLabel={t('confirm_back')}
        onCancel={() => {
          track('admin_settings_confirm', { outcome: 'cancelled', risky: risky.length });
          setConfirming(false);
        }}
        onConfirm={() => {
          track('admin_settings_confirm', { outcome: 'saved', risky: risky.length });
          setConfirming(false);
          void save();
        }}
      >
        <ul className="space-y-2">
          {risky.map((c) => {
            const risk = riskOf(c);
            if (!risk) return null;
            const before = toInput(
              rows.find((r) => r.key === c.key)?.value ?? USTAAD_SETTINGS[c.key].default,
            );
            return (
              <li key={c.key} className="rounded-tile bg-warning-bg p-3 text-sm text-warning">
                <span className="font-bold">{t(adminMessage(`lbl_${flatKey(c.key)}`))}</span>
                <span className="block">
                  {risk === 'risk_access'
                    ? t('risk_access', {
                        from: t(adminMessage(`opt_access_${before}`)),
                        to: t(adminMessage(`opt_access_${toInput(c.value)}`)),
                      })
                    : t(risk)}
                </span>
              </li>
            );
          })}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

function keysOfSectionOf(key: UstaadSettingKey): UstaadAdminSection | null {
  return USTAAD_ADMIN_SECTIONS.find((s) => keysOfSection(s).includes(key)) ?? null;
}

function dirtyIn(section: UstaadAdminSection, changes: readonly { key: UstaadSettingKey }[]): number {
  const keys = keysOfSection(section);
  return changes.filter((c) => keys.includes(c.key)).length;
}

function lockedSection(item: string): UstaadAdminSection {
  if (item === 'ustaad.promo.label') return 'promo';
  if (item === 'ustaad.loc.distance_bands') return 'loc';
  return 'verify';
}

function detailKey(details: unknown): string | null {
  if (typeof details !== 'object' || details === null || !('key' in details)) return null;
  return typeof details.key === 'string' ? details.key : null;
}

/** The access switch (founder 2026-11-26): three choices as radio cards, saved with the other changes, confirmed. */
function AccessCard({
  value,
  saved,
  disabled,
  onChange,
}: {
  value: string;
  saved: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const a = useTranslations('ustaad.adminAccess');
  const t = useTranslations('ustaad.admin');
  const id = useId();
  return (
    <fieldset className={`${adminCard} space-y-3`} aria-describedby={`${id}-lead`}>
      <legend className="sr-only">{a('title')}</legend>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p aria-hidden="true" className="font-heading text-lg font-extrabold text-ink">
            {a('title')}
          </p>
          <p id={`${id}-lead`} className="mt-0.5 max-w-prose text-sm text-muted">
            {a('lead')}
          </p>
        </div>
        <StatusBadge tone={saved === 'open' ? 'success' : saved === 'off' ? 'danger' : 'warning'}>
          {a('current', { mode: a(modeKey(saved)) })}
        </StatusBadge>
      </div>
      <div className="grid gap-2 tab:grid-cols-3">
        {ACCESS_MODES.map((m) => (
          <label
            key={m}
            className={`flex min-h-11 cursor-pointer gap-3 rounded-tile border p-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
              value === m ? 'border-accent-button bg-accent-soft' : 'border-line-card'
            } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            <input
              type="radio"
              name={`${id}-access`}
              value={m}
              checked={value === m}
              disabled={disabled}
              aria-describedby={`${id}-${m}-help`}
              onChange={() => {
                onChange(m);
              }}
              className="mt-1 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">{a(modeKey(m))}</span>
              <span id={`${id}-${m}-help`} className="block text-xs text-muted">
                {a(`${modeKey(m)}_help`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {value !== saved ? <p className="text-xs font-bold text-warning">{t('access_card_note')}</p> : null}
    </fieldset>
  );
}

const modeKey = (m: string) =>
  m === 'off' ? 'mode_off' : m === 'open' ? 'mode_open' : ('mode_staff_preview' as const);

function SettingRow({
  id,
  settingKey,
  row,
  value,
  problem,
  disabled,
  onChange,
}: {
  id: string;
  settingKey: UstaadSettingKey;
  row: Row | undefined;
  value: string | undefined;
  problem: FieldProblem | undefined;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('ustaad.admin');
  const locale = useLocale();
  const num = (n: number) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n);
  const spec: UstaadSettingSpec = USTAAD_SETTINGS[settingKey];
  const flat = flatKey(settingKey);
  const saved = toInput(row?.value ?? spec.default);
  const shown = value ?? saved;
  const changed = shown !== saved;
  const locked = isLockedKey(settingKey);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const unit = unitOf(settingKey);
  const describedBy = [helpId, unit ? `${id}-unit` : '', problem ? errorId : ''].filter(Boolean).join(' ');
  const show = (v: string) =>
    spec.kind === 'boolean'
      ? t(v === 'true' ? 'on' : 'off')
      : spec.kind === 'enum'
        ? t(adminMessage(`opt_${flat}_${v}`))
        : `${num(Number(v))}${unit ? ` ${t(adminMessage(`unit_${unit}`))}` : ''}`;
  const hint = [
    spec.kind === 'int' ? t('range', { min: num(spec.min), max: num(spec.max) }) : null,
    t('default', { value: show(toInput(spec.default)) }),
  ]
    .filter(Boolean)
    .join(' · ');
  const error = problem
    ? problem.kind === 'type'
      ? t('err_type')
      : problem.kind === 'range'
        ? t('err_range', { min: num(problem.min), max: num(problem.max) })
        : t(adminMessage(problem.message))
    : null;

  return (
    <li className="grid gap-3 py-4 tab:grid-cols-[minmax(0,1fr)_auto] tab:items-start tab:gap-6">
      <div className="min-w-0">
        {locked ? (
          <p id={`${id}-lbl`} className="text-[15px] font-bold text-ink">
            {t(adminMessage(`lbl_${flat}`))}
          </p>
        ) : (
          <label htmlFor={id} className="text-[15px] font-bold text-ink">
            {t(adminMessage(`lbl_${flat}`))}
          </label>
        )}
        <p id={helpId} className="mt-0.5 text-sm text-muted">
          {t(adminMessage(`help_${flat}`))}
          <span className="mt-1 block text-xs">{locked ? t('locked_note') : hint}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-2">
          {locked ? (
            <StatusBadge tone="neutral">
              <Lock aria-hidden="true" className="mr-1 size-3.5" />
              {t('locked')}
            </StatusBadge>
          ) : null}
          {changed ? <StatusBadge tone="warning">{t('changed')}</StatusBadge> : null}
        </p>
        {error ? (
          <p id={errorId} className="mt-1 text-sm font-bold text-error">
            {error}
          </p>
        ) : null}
      </div>
      <div className="tab:pt-0.5">
        {locked ? (
          <p
            id={id}
            aria-labelledby={`${id}-lbl ${id}`}
            className="inline-flex min-h-11 items-center text-sm font-bold text-ink"
          >
            {t('always_on')}
          </p>
        ) : spec.kind === 'boolean' ? (
          <Switch
            id={id}
            checked={shown === 'true'}
            describedBy={describedBy}
            onText={t('on')}
            offText={t('off')}
            disabled={disabled}
            onChange={(v) => {
              onChange(v ? 'true' : 'false');
            }}
          />
        ) : spec.kind === 'enum' ? (
          <select
            id={id}
            value={shown}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            className={`${portalField} !mt-0 tab:w-64`}
          >
            {spec.values.map((v) => (
              <option key={v} value={v}>
                {t(adminMessage(`opt_${flat}_${v}`))}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex min-h-11 w-fit items-center gap-2 rounded-input border border-input-border bg-surface px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus has-[[aria-invalid=true]]:border-error">
            <input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={shown}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                onChange(e.target.value.trim());
              }}
              className="min-h-10 w-24 scroll-mb-32 bg-transparent text-right text-[15px] font-bold text-ink tabular-nums focus-visible:outline-none"
            />
            {unit ? (
              <span id={`${id}-unit`} className="text-sm text-muted">
                {t(adminMessage(`unit_${unit}`))}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/** Staff final approval, the Sponsored label, the distance bands: read-only, never a control. */
function LockedItemRow({ item }: { item: (typeof USTAAD_LOCKED_ITEMS)[number] }) {
  const t = useTranslations('ustaad.admin');
  const locale = useLocale();
  const flat = flatKey(item.item);
  const value =
    item.item === 'ustaad.promo.label' ? (
      <span>
        {locale === 'hi' ? (
          item.value.hi
        ) : (
          <>
            {item.value.en} / <span lang="hi">{item.value.hi}</span>
          </>
        )}
      </span>
    ) : item.item === 'ustaad.loc.distance_bands' ? (
      t('bands_value', { a: item.value[0], b: item.value[1], c: item.value[2] })
    ) : (
      t('always_on')
    );
  return (
    <li className="grid gap-3 py-4 tab:grid-cols-[minmax(0,1fr)_auto] tab:items-start tab:gap-6">
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-ink">{t(adminMessage(`lbl_${flat}`))}</p>
        <p className="mt-0.5 text-sm text-muted">{t(adminMessage(`help_${flat}`))}</p>
        <p className="mt-1">
          <StatusBadge tone="neutral">
            <Lock aria-hidden="true" className="mr-1 size-3.5" />
            {t('locked')}
          </StatusBadge>
        </p>
      </div>
      <p className="text-sm font-bold text-ink tab:pt-3">{value}</p>
    </li>
  );
}

/** A video above 180 s: only a super admin, and only with a reason code (audited). */
function VideoReason({
  id,
  value,
  superAdmin,
  onChange,
}: {
  id: string;
  value: string;
  superAdmin: boolean;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('ustaad.admin');
  return (
    <div className={`${adminCard} space-y-1`}>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {t('reason_label')}
      </label>
      <p id={`${id}-help`} className="text-xs text-muted">
        {superAdmin ? t('reason_help') : t('reason_super_only')}
      </p>
      <select
        id={id}
        value={value}
        disabled={!superAdmin}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={`${portalField} tab:w-80`}
      >
        <option value="">{t('reason_choose')}</option>
        {VIDEO_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(adminMessage(`reason_${r}`))}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Decide later" items (spec 23 § 15): shown greyed, nothing to switch. */
function LaterCard() {
  const t = useTranslations('ustaad.admin');
  return (
    <div className={`${adminCard} space-y-2`}>
      <h4 className="font-heading text-base font-extrabold text-ink">{t('later_title')}</h4>
      <p className="text-sm text-muted">{t('later_lead')}</p>
      <ul className="space-y-1">
        {(['later_job_card', 'later_trade_prices', 'later_udhaar'] as const).map((k) => (
          <li key={k} className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {t(k)}
            <StatusBadge tone="muted">{t('later_badge')}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The settings save bar (design system "Forms": sticky card, unsaved count, Discard, one primary button). */
function SaveBar({
  open,
  dirty,
  busy,
  status,
  onDiscard,
  onSave,
}: {
  open: boolean;
  dirty: number;
  busy: boolean;
  status: Status;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const t = useTranslations('ustaad.admin');
  return (
    <>
      <div
        aria-hidden="true"
        className={`transition-[height] duration-200 motion-reduce:transition-none ${open ? 'h-32 tab:h-24' : 'h-0'}`}
      />
      <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 h-0 nav:bottom-4">
        <div
          role="group"
          aria-label={t('bar_label')}
          className={`absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 rounded-card border border-line-card bg-surface px-4 py-3 shadow-float transition-[opacity,transform,visibility] duration-200 motion-reduce:transition-none min-[1200px]:left-[246px] ${
            open
              ? 'visible translate-y-0 opacity-100'
              : 'pointer-events-none invisible translate-y-4 opacity-0'
          }`}
        >
          <p
            role={status?.tone === 'error' ? 'alert' : 'status'}
            className={`min-w-0 basis-full text-sm font-bold tab:flex-1 tab:basis-0 ${
              status?.tone === 'error' ? 'text-error' : dirty > 0 ? 'text-ink' : 'text-success'
            }`}
          >
            {status?.tone === 'error'
              ? status.text
              : dirty > 0
                ? t('bar_dirty', { count: dirty })
                : (status?.text ?? '')}
          </p>
          <button
            type="button"
            disabled={dirty === 0 || busy}
            onClick={onDiscard}
            className={`${portalQuiet} flex-1 tab:flex-none`}
          >
            {t('bar_discard')}
          </button>
          <button
            type="button"
            disabled={dirty === 0 || busy}
            onClick={onSave}
            className={`${portalPrimary} flex-1 tab:flex-none`}
          >
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </>
  );
}
