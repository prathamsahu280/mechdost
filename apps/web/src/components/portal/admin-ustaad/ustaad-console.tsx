'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { ConsoleCapsDto, type ConsoleCaps } from '@mechdost/shared/ustaad/dto/console';
import { adminApi } from '@/lib/admin-api';
import {
  consoleSectionsFor,
  parseConsoleSection,
  type ConsolePlace,
  type ConsoleSection,
} from '@/lib/admin-ustaad-console';
import {
  USTAAD_ADMIN_SECTIONS,
  adminMessage,
  sectionFromQuery,
  type UstaadAdminSection,
} from '@/lib/admin-ustaad-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { LoadState } from '../admin-site-api';
import { portalField } from '../portal-styles';
import { useConsoleT } from './console-common';
import { MembersSection } from './console-members';
import { AuditSection, LegalSection, NamesSection } from './console-records';
import { ReportsSection } from './console-reports';
import { VerifySection } from './console-verify';
import { AdminUstaadApi } from './ustaad-settings';

type Place =
  { kind: 'community'; section: ConsoleSection } | { kind: 'settings'; section: UstaadAdminSection };

/**
 * Admin → Ustaad Network (spec 23 § 3, § 13, § 15; tasks G1 + G2): one section switcher for the community console
 * (queue, holds, appeals, verify, members, legal, reserved names, my actions) and G1's ten settings sections. What the
 * caller may do comes from `GET /admin/ustaad/console`; sections and buttons the API would refuse are hidden, and the
 * API still checks every call. `?section=verify` (Partners › Applications) opens Verify; `?section=settings&sec=mod`
 * a settings section. The settings screen stays mounted once opened, so unsaved edits survive a visit to the queue.
 */
export function AdminUstaadConsole() {
  const c = useConsoleT();
  const t = useTranslations('ustaad.admin');
  const locale = useLocale();
  const baseId = useId();
  const headId = `${baseId}-head`;
  const [caps, setCaps] = useState<ConsoleCaps | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [focusHead, setFocusHead] = useState(false);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/ustaad/console', ConsoleCapsDto);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setCaps(res.data);
    const q = new URLSearchParams(window.location.search);
    // An older settings link (`?sec=mod`, G1) still opens that settings section.
    const asked = q.get('section') ?? (q.get('sec') ? 'settings' : null);
    const p: ConsolePlace = parseConsoleSection(asked, res.data);
    if (p === 'settings') {
      setPlace({ kind: 'settings', section: sectionFromQuery(q.get('sec')) });
      setSettingsOpened(true);
    } else setPlace({ kind: 'community', section: p });
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  // Focus the new section's heading after the switch (keyboard and screen-reader users land on it).
  useEffect(() => {
    if (!focusHead) return;
    if (place?.kind === 'community') document.getElementById(headId)?.focus();
    setFocusHead(false);
  }, [focusHead, place, headId]);

  if (!caps || !place) return <LoadState error={loadError} onRetry={() => void load()} />;
  const community = consoleSectionsFor(caps);
  const showSettings = caps.read || caps.settings;

  function go(next: Place, via: 'list' | 'select') {
    setPlace(next);
    if (next.kind === 'settings') setSettingsOpened(true);
    setFocusHead(next.kind === 'community' && via === 'list');
    try {
      const q =
        next.kind === 'settings' ? `?section=settings&sec=${next.section}` : `?section=${next.section}`;
      window.history.replaceState(window.history.state, '', q);
    } catch {
      // The address bar is a convenience only.
    }
    track('admin_ustaad_console_viewed', { section: next.kind === 'settings' ? 'settings' : next.section });
    if (next.kind === 'settings') track('admin_settings_nav', { category: `ustaad_${next.section}`, via });
  }

  const value = place.kind === 'settings' ? `settings:${place.section}` : place.section;
  const fromValue = (v: string): Place =>
    v.startsWith('settings:')
      ? { kind: 'settings', section: sectionFromQuery(v.slice('settings:'.length)) }
      : { kind: 'community', section: community.find((s) => s === v) ?? community[0] ?? 'audit' };
  const isCurrent = (p: Place) => p.kind === place.kind && p.section === place.section;
  const item = (p: Place, label: string) => (
    <li key={`${p.kind}-${p.section}`} className="shrink-0">
      <button
        type="button"
        aria-current={isCurrent(p) ? 'true' : undefined}
        onClick={() => {
          go(p, 'list');
        }}
        className={`press flex min-h-11 w-full items-center rounded-pill px-4 text-left text-sm font-bold whitespace-nowrap min-[1200px]:rounded-button min-[1200px]:whitespace-normal focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
          isCurrent(p) ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
        }`}
      >
        {label}
      </button>
    </li>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {caps.cities === null ? c('scope_all') : c('scope_cities', { cities: caps.cities.join(', ') })}
      </p>
      <div className="grid gap-4 min-[1200px]:grid-cols-[230px_minmax(0,1fr)] min-[1200px]:items-start">
        <div className="min-w-0">
          <div className="tab:hidden">
            <label htmlFor={`${baseId}-sec`} className="text-sm font-bold text-ink">
              {c('nav_select')}
            </label>
            <select
              id={`${baseId}-sec`}
              value={value}
              onChange={(e) => {
                go(fromValue(e.target.value), 'select');
              }}
              className={portalField}
            >
              <optgroup label={c('group_community')}>
                {community.map((s) => (
                  <option key={s} value={s}>
                    {c(`sec_${s}`)}
                  </option>
                ))}
              </optgroup>
              {showSettings ? (
                <optgroup label={c('group_settings')}>
                  {USTAAD_ADMIN_SECTIONS.map((s) => (
                    <option key={s} value={`settings:${s}`}>
                      {t(adminMessage(`sec_${s}`))}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <nav aria-label={c('nav_label')} className="hidden space-y-3 tab:block">
            <div>
              <p id={`${baseId}-g1`} className="px-3 pb-1 text-xs font-bold text-muted">
                {c('group_community')}
              </p>
              <ul
                aria-labelledby={`${baseId}-g1`}
                className="flex gap-2 overflow-x-auto p-1.5 min-[1200px]:flex-col min-[1200px]:gap-1 min-[1200px]:overflow-visible min-[1200px]:pb-0"
              >
                {community.map((s) => item({ kind: 'community', section: s }, c(`sec_${s}`)))}
              </ul>
            </div>
            {showSettings ? (
              <div>
                <p id={`${baseId}-g2`} className="px-3 pb-1 text-xs font-bold text-muted">
                  {c('group_settings')}
                </p>
                <ul
                  aria-labelledby={`${baseId}-g2`}
                  className="flex gap-2 overflow-x-auto p-1.5 min-[1200px]:flex-col min-[1200px]:gap-1 min-[1200px]:overflow-visible min-[1200px]:pb-0"
                >
                  {USTAAD_ADMIN_SECTIONS.map((s) =>
                    item({ kind: 'settings', section: s }, t(adminMessage(`sec_${s}`))),
                  )}
                </ul>
              </div>
            ) : null}
          </nav>
        </div>

        <div className="min-w-0">
          {place.kind === 'community' ? (
            <CommunitySection section={place.section} caps={caps} headId={headId} />
          ) : null}
          {settingsOpened ? (
            <div hidden={place.kind !== 'settings'}>
              <AdminUstaadApi
                controlled={{
                  section: place.kind === 'settings' ? place.section : 'general',
                  onSection: (s) => {
                    go({ kind: 'settings', section: s }, 'list');
                  },
                  showAuditLink: caps.settings,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CommunitySection({
  section,
  caps,
  headId,
}: {
  section: ConsoleSection;
  caps: ConsoleCaps;
  headId: string;
}) {
  switch (section) {
    case 'queue':
      return <ReportsSection key="open" queue="open" caps={caps} headId={headId} />;
    case 'holds':
      return <ReportsSection key="held" queue="held" caps={caps} headId={headId} />;
    case 'appeals':
      return <ReportsSection key="appealed" queue="appealed" caps={caps} headId={headId} />;
    case 'verify':
      return <VerifySection headId={headId} />;
    case 'members':
      return <MembersSection caps={caps} headId={headId} />;
    case 'legal':
      return <LegalSection caps={caps} headId={headId} />;
    case 'names':
      return <NamesSection caps={caps} headId={headId} />;
    case 'audit':
      return <AuditSection headId={headId} />;
  }
}
