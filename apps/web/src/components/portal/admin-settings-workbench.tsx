'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';
import { track } from '@/lib/analytics';
import {
  SETTINGS_CATEGORIES,
  matchesQuery,
  type RiskReason,
  type SettingsCategory,
  type SettingsCategoryId,
} from '@/lib/admin-settings-registry';
import { PortalNavLink } from './portal-nav-link';
import { portalCard, portalPrimary, portalQuiet } from './portal-styles';

/**
 * Admin → Settings, the screen around the settings (design 2026-11-24, spec 08). Groups every setting into the
 * categories of `admin-settings-registry`, with a category list (select on phones, tabs on tablets, a side list on
 * wide screens), a search over names and descriptions, one row per setting (label, one-line help, current value, unit
 * and range), a sticky save bar with the unsaved count, Discard and a confirm step for risky changes.
 *
 * It owns no data: the demo and the API editors (`admin-settings.tsx`) hand in the items, the values being edited and
 * the save/discard actions, so each keeps its own validation and calls.
 */
export interface SettingItem {
  /** Unique; also the input's DOM id. */
  id: string;
  category: SettingsCategoryId;
  label: string;
  help: string;
  kind: 'number' | 'switch';
  /** Text before the input (₹). */
  prefix?: string;
  /** Text after the input (minutes, days...). */
  unit?: string;
  /** The value being edited ('true' / 'false' for a switch). */
  value: string;
  /** The saved value in the same form; differs from `value` = an unsaved change. */
  saved: string;
  /** One line under the help: range, default. */
  hint: string;
  error?: string;
  /** Small tag beside the hint: "Same in every city", "Custom value". */
  badges?: readonly string[];
  /** Extra row content (the city override line with its reset button). */
  extra?: ReactNode;
  /** Set when saving this edit needs a second look (computed by the editor from the typed value). */
  risk?: RiskReason | null;
}

export interface SettingsPanel {
  id: string;
  category: SettingsCategoryId;
  title: string;
  help: string;
  node: ReactNode;
}

export interface SettingsStatus {
  tone: 'ok' | 'error' | 'muted';
  text: string;
}

export interface WorkbenchProps {
  title: string;
  lead: string;
  /** Under the heading: the demo note, the city picker. */
  toolbar?: ReactNode;
  headerActions?: ReactNode;
  items: readonly SettingItem[];
  panels: readonly SettingsPanel[];
  /** Replaces the settings while they load or fail to load. */
  placeholder?: ReactNode;
  onChange: (id: string, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  busy: boolean;
  status: SettingsStatus | null;
  /** Ask to show and focus one item (the first invalid field); `n` makes a repeat request count. */
  focusRequest: { id: string; n: number } | null;
  /** Below the list: recent changes / audit link. */
  footer?: ReactNode;
}

type Via = 'list' | 'select' | 'search';

export function SettingsWorkbench(props: WorkbenchProps) {
  const { items, panels, onChange, onSave, onDiscard, busy, status, focusRequest } = props;
  const t = useTranslations('adminSettings');
  const p = useTranslations('portal');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const baseId = useId();

  const visible = useMemo(
    () =>
      SETTINGS_CATEGORIES.filter(
        (c) => items.some((i) => i.category === c.id) || panels.some((x) => x.category === c.id),
      ),
    [items, panels],
  );
  const [chosen, setChosen] = useState<SettingsCategoryId | null>(null);
  const [query, setQuery] = useState('');
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // `?cat=orders` opens that category once it exists (the API's settings arrive after the first paint).
  const deepLink = useRef(true);
  useEffect(() => {
    if (!deepLink.current) return;
    const wanted = new URLSearchParams(window.location.search).get('cat');
    const found = visible.find((c) => c.id === wanted);
    if (found) {
      deepLink.current = false;
      setChosen(found.id);
    }
  }, [visible]);

  const active = visible.find((c) => c.id === chosen)?.id ?? visible[0]?.id ?? null;
  const searching = query.trim() !== '';

  const matchItem = (i: SettingItem) => matchesQuery(`${i.label} ${i.help} ${i.hint} ${i.id}`, query);
  const matchPanel = (x: SettingsPanel) => matchesQuery(`${x.title} ${x.help}`, query);
  const shownItems = searching ? items.filter(matchItem) : items.filter((i) => i.category === active);
  const shownPanels = searching ? panels.filter(matchPanel) : panels.filter((x) => x.category === active);
  const resultCount = shownItems.length + shownPanels.length;

  const dirty = items.filter((i) => i.value !== i.saved);
  const risky = dirty.filter((i) => i.risk);
  const dirtyIn = (c: SettingsCategoryId) => dirty.filter((i) => i.category === c).length;
  const hits = (c: SettingsCategoryId) =>
    items.filter((i) => i.category === c && matchItem(i)).length +
    panels.filter((x) => x.category === c && matchPanel(x)).length;

  // Search usage, counted once the person pauses typing (never the words).
  useEffect(() => {
    if (!searching) return;
    const timer = window.setTimeout(() => {
      track('admin_settings_search', { results: resultCount });
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searching, resultCount, query]);

  // Leaving with unsaved edits asks first (browser prompt), as in any form.
  const hasUnsaved = items.some((i) => i.value !== i.saved);
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [hasUnsaved]);

  // Show and focus a requested field (an invalid one after Save), whichever category it is in.
  useEffect(() => {
    if (!focusRequest) return;
    const item = items.find((i) => i.id === focusRequest.id);
    if (!item) return;
    setQuery('');
    setChosen(item.category);
    setPendingFocus(item.id);
    // Only a new request moves focus, not every change of the items.
  }, [focusRequest]);
  useEffect(() => {
    if (!pendingFocus) return;
    const el = document.getElementById(pendingFocus);
    if (el) {
      el.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, active, query]);

  function pick(id: SettingsCategoryId, via: Via) {
    deepLink.current = false;
    setQuery('');
    setChosen(id);
    // The address keeps the category (a refresh or a shared link opens it) without a navigation.
    try {
      window.history.replaceState(window.history.state, '', `?cat=${id}`);
    } catch {
      // The address bar is a convenience only.
    }
    track('admin_settings_nav', { category: id, via });
  }

  function requestSave() {
    if (dirty.length === 0 || busy) return;
    if (risky.length > 0) setConfirming(true);
    else onSave();
  }

  return (
    <section aria-labelledby={`${baseId}-title`} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${baseId}-title`} className="font-heading text-xl font-extrabold text-ink">
            {props.title}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">{props.lead}</p>
        </div>
        {props.headerActions}
      </div>
      {props.toolbar}

      <div className="grid gap-4 min-[1200px]:grid-cols-[230px_minmax(0,1fr)] min-[1200px]:items-start">
        <div className="space-y-3 min-[1200px]:sticky min-[1200px]:top-28">
          <div>
            <label htmlFor={`${baseId}-search`} className="sr-only">
              {t('search_label')}
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted"
              >
                🔍
              </span>
              <input
                id={`${baseId}-search`}
                type="search"
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('search_placeholder')}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                className="min-h-11 w-full rounded-input border border-input-border bg-surface pr-3 pl-10 text-[15px] text-ink placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
            </div>
          </div>

          <div className="tab:hidden">
            <label htmlFor={`${baseId}-cat`} className="sr-only">
              {t('nav_select')}
            </label>
            <select
              id={`${baseId}-cat`}
              value={searching ? '' : (active ?? '')}
              onChange={(e) => {
                const id = visible.find((c) => c.id === e.target.value)?.id;
                if (id) pick(id, 'select');
              }}
              className="min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {searching ? <option value="">{t('search_results', { count: resultCount })}</option> : null}
              {visible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {t(`cat_${c.id}`)}
                  {dirtyIn(c.id) > 0 ? ` (${String(dirtyIn(c.id))})` : ''}
                </option>
              ))}
            </select>
          </div>

          <nav aria-label={t('nav_label')} className="hidden tab:block">
            <ul className="flex gap-2 overflow-x-auto pb-1 min-[1200px]:flex-col min-[1200px]:gap-1 min-[1200px]:overflow-visible min-[1200px]:pb-0">
              {visible.map((c) => (
                <li key={c.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={!searching && c.id === active ? 'true' : undefined}
                    onClick={() => {
                      pick(c.id, 'list');
                    }}
                    className={`press flex min-h-11 w-full items-center gap-2 rounded-pill px-4 text-left text-sm font-bold whitespace-nowrap focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus min-[1200px]:rounded-button ${
                      !searching && c.id === active
                        ? 'bg-accent-soft text-accent-soft-text'
                        : 'text-ink hover:bg-pill'
                    } ${searching && hits(c.id) === 0 ? 'opacity-50' : ''}`}
                  >
                    <span aria-hidden="true" className="text-[16px] leading-none">
                      {c.emoji}
                    </span>
                    <span className="min-w-0 flex-1">{t(`cat_${c.id}`)}</span>
                    {searching && hits(c.id) > 0 ? (
                      <span className="rounded-pill bg-pill px-2 text-xs text-ink">{hits(c.id)}</span>
                    ) : null}
                    {dirtyIn(c.id) > 0 ? (
                      <span
                        className="rounded-pill bg-warning-bg px-2 text-xs text-warning"
                        title={t('bar_dirty', { count: dirtyIn(c.id) })}
                      >
                        <span className="sr-only">{t('bar_dirty', { count: dirtyIn(c.id) })}</span>
                        <span aria-hidden="true">{dirtyIn(c.id)}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="min-w-0 space-y-4">
          {props.placeholder}
          {searching ? (
            <p role="status" className="text-sm font-bold text-ink">
              {resultCount === 0
                ? t('search_none', { query: query.trim() })
                : t('search_results', { count: resultCount })}
            </p>
          ) : (
            <CategoryHeading category={visible.find((c) => c.id === active)} prefix={prefix} />
          )}
          <Rows
            items={shownItems}
            panels={shownPanels}
            grouped={searching}
            onChange={onChange}
            baseId={baseId}
          />
          {props.footer}
        </div>
      </div>

      <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 nav:bottom-4">
        <div
          role="group"
          aria-label={t('bar_label')}
          className="mx-auto flex flex-wrap items-center gap-3 rounded-card border border-line-card bg-surface px-4 py-3 shadow-float"
        >
          <p
            role="status"
            className={`min-w-0 basis-full text-sm font-bold tab:flex-1 tab:basis-0 ${
              dirty.length > 0
                ? 'text-ink'
                : status?.tone === 'error'
                  ? 'text-error'
                  : status?.tone === 'ok'
                    ? 'text-success'
                    : 'text-muted'
            }`}
          >
            {dirty.length > 0
              ? status?.tone === 'error'
                ? status.text
                : t('bar_dirty', { count: dirty.length })
              : (status?.text ?? t('bar_clean'))}
          </p>
          <button
            type="button"
            disabled={dirty.length === 0 || busy}
            onClick={() => {
              track('admin_settings_discard', { fields: dirty.length });
              onDiscard();
            }}
            className={`${portalQuiet} flex-1 tab:flex-none`}
          >
            {t('bar_discard')}
          </button>
          <button
            type="button"
            disabled={dirty.length === 0 || busy}
            onClick={requestSave}
            className={`${portalPrimary} flex-1 tab:flex-none`}
          >
            {busy ? p('api_common_saving') : p('site_save')}
          </button>
        </div>
      </div>

      <ConfirmRisky
        open={confirming}
        risky={risky}
        onCancel={() => {
          track('admin_settings_confirm', { outcome: 'cancelled', risky: risky.length });
          setConfirming(false);
        }}
        onConfirm={() => {
          track('admin_settings_confirm', { outcome: 'saved', risky: risky.length });
          setConfirming(false);
          onSave();
        }}
      />
    </section>
  );
}

function CategoryHeading({ category, prefix }: { category: SettingsCategory | undefined; prefix: string }) {
  const t = useTranslations('adminSettings');
  if (!category) return null;
  const link = category.link;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h3 className="font-heading text-lg font-extrabold text-ink">
          <span aria-hidden="true">{category.emoji} </span>
          {t(`cat_${category.id}`)}
        </h3>
        <p className="mt-0.5 max-w-prose text-sm text-muted">{t(`cat_${category.id}_help`)}</p>
      </div>
      {link ? (
        <PortalNavLink
          href={`${prefix}/admin/${link.section}`}
          className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t(`link_${link.section}`)}
          <span aria-hidden="true">&nbsp;→</span>
        </PortalNavLink>
      ) : null}
    </div>
  );
}

function Rows({
  items,
  panels,
  grouped,
  onChange,
  baseId,
}: {
  items: readonly SettingItem[];
  panels: readonly SettingsPanel[];
  /** Search results: a small heading per category. */
  grouped: boolean;
  onChange: (id: string, value: string) => void;
  baseId: string;
}) {
  const t = useTranslations('adminSettings');
  const order = SETTINGS_CATEGORIES.filter(
    (c) => items.some((i) => i.category === c.id) || panels.some((x) => x.category === c.id),
  );
  if (order.length === 0) {
    return (
      <div className={`${portalCard} text-center`}>
        <p className="text-sm text-muted">{t('empty')}</p>
      </div>
    );
  }
  return (
    <>
      {order.map((c) => {
        const own = items.filter((i) => i.category === c.id);
        return (
          <div key={c.id} className="space-y-4">
            {grouped ? (
              <h3 className="font-heading text-base font-extrabold text-ink">
                <span aria-hidden="true">{c.emoji} </span>
                {t(`cat_${c.id}`)}
              </h3>
            ) : null}
            {own.length > 0 ? (
              <ul className={`${portalCard} divide-y divide-line !py-1`}>
                {own.map((item) => (
                  <Row key={item.id} item={item} onChange={onChange} baseId={baseId} />
                ))}
              </ul>
            ) : null}
            {panels
              .filter((x) => x.category === c.id)
              .map((x) => (
                <div key={x.id}>{x.node}</div>
              ))}
          </div>
        );
      })}
    </>
  );
}

function Row({
  item,
  onChange,
  baseId,
}: {
  item: SettingItem;
  onChange: (id: string, value: string) => void;
  baseId: string;
}) {
  const t = useTranslations('adminSettings');
  const changed = item.value !== item.saved;
  const helpId = `${baseId}-${item.id}-help`;
  const errorId = `${baseId}-${item.id}-error`;
  const describedBy = `${helpId}${item.error ? ` ${errorId}` : ''}`;
  return (
    <li className="grid gap-3 py-4 tab:grid-cols-[minmax(0,1fr)_auto] tab:items-start tab:gap-6">
      <div className="min-w-0">
        <label htmlFor={item.id} className="text-[15px] font-bold text-ink">
          {item.label}
        </label>
        <p id={helpId} className="mt-0.5 text-sm text-muted">
          {item.help}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{item.hint}</span>
          {item.badges?.map((b) => (
            <span key={b} className="rounded-pill bg-pill px-2 py-0.5 font-bold text-ink">
              {b}
            </span>
          ))}
          {changed ? (
            <span className="rounded-pill bg-warning-bg px-2 py-0.5 font-bold text-warning">
              {t('changed')}
            </span>
          ) : null}
        </p>
        {item.extra}
        {item.error ? (
          <p id={errorId} className="mt-1 text-xs font-bold text-error">
            {item.error}
          </p>
        ) : null}
      </div>
      <div className="tab:pt-0.5">
        {item.kind === 'switch' ? (
          <Switch
            id={item.id}
            checked={item.value === 'true'}
            describedBy={describedBy}
            onText={t('on')}
            offText={t('off')}
            onChange={(v) => {
              onChange(item.id, v ? 'true' : 'false');
            }}
          />
        ) : (
          <div className="flex min-h-11 w-fit items-center gap-2 rounded-input border border-input-border bg-surface px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus has-[[aria-invalid=true]]:border-error">
            {item.prefix ? (
              <span aria-hidden="true" className="text-sm font-bold text-muted">
                {item.prefix}
              </span>
            ) : null}
            <input
              id={item.id}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={item.value}
              aria-invalid={item.error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                onChange(item.id, e.target.value.replace(/\D/g, ''));
              }}
              className="min-h-10 w-24 scroll-mb-32 bg-transparent text-right tabular-nums text-[15px] font-bold text-ink focus-visible:outline-none"
            />
            {item.unit ? <span className="text-sm text-muted">{item.unit}</span> : null}
          </div>
        )}
      </div>
    </li>
  );
}

/** The risky edits of one save, each with the reason it needs a second look. */
function ConfirmRisky({
  open,
  risky,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  risky: readonly SettingItem[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('adminSettings');
  return (
    <ConfirmDialog
      open={open}
      title={t('confirm_title')}
      lead={t('confirm_lead')}
      confirmLabel={t('confirm_save')}
      backLabel={t('confirm_back')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <ul className="space-y-2">
        {risky.map((item) =>
          item.risk ? (
            <li key={item.id} className="rounded-tile bg-warning-bg p-3 text-sm text-warning">
              <span className="font-bold">{item.label}</span>
              <span className="block">{t(item.risk)}</span>
            </li>
          ) : null,
        )}
      </ul>
    </ConfirmDialog>
  );
}

/**
 * One native `<dialog>` (focus trapped, Escape closes, focus returns to the button that opened it): a title, a line,
 * optional detail, "Go back" and the confirming button. Never stacked; the settings screen has only this one.
 */
export function ConfirmDialog({
  open,
  title,
  lead,
  confirmLabel,
  backLabel,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  lead: string;
  confirmLabel: string;
  backLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-card bg-surface p-0 text-ink shadow-dialog backdrop:bg-black/60"
    >
      <div className="space-y-4 p-5">
        <h3 id={titleId} className="font-heading text-lg font-extrabold">
          {title}
        </h3>
        <p className="text-sm text-muted">{lead}</p>
        {children}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onCancel} className={portalQuiet}>
            {backLabel}
          </button>
          <button type="button" onClick={onConfirm} className={portalPrimary}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
