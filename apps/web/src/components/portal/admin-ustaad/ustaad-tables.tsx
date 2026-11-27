'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { PROMOTION_STATES } from '@mechdost/shared/ustaad/codes';
import { promotionMoveAllowed } from '@mechdost/shared/ustaad/admin-rules';
import { adminApi } from '@/lib/admin-api';
import { adminMessage, type UstaadAdminSection } from '@/lib/admin-ustaad-view';
import { BY_SECTION, type TableConfig } from '@/lib/admin-ustaad-tables-config';
import {
  emptyForm,
  formFromRow,
  formProblems,
  shownProblems,
  type TableField,
  type TableForm,
  type TableRow,
  bodyFromForm,
  rowName,
  splitAroundName,
  tableErrorMessage,
} from '@/lib/admin-ustaad-tables';
import { track } from '@/lib/analytics';
import {
  EmptyState,
  StatusBadge,
  adminCard,
  adminTableClass,
  adminTd,
  adminTh,
  AdminTable,
} from '../admin-ui';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';

/** The lists of one section (levels, badges, hashtags, words, reasons, cities, promotions, tutorial). */
export function UstaadSectionTables({
  section,
  canEdit,
  onWordsChanged,
}: {
  section: UstaadAdminSection;
  canEdit: boolean;
  onWordsChanged: () => void;
}) {
  return (
    <>
      {BY_SECTION[section].map((c) => (
        <EditableTable
          key={c.id}
          config={c}
          canEdit={canEdit}
          onSaved={c.id === 'words_protected' ? onWordsChanged : undefined}
        />
      ))}
    </>
  );
}

function EditableTable({
  config,
  canEdit,
  onSaved,
}: {
  config: TableConfig;
  canEdit: boolean;
  onSaved: (() => void) | undefined;
}) {
  const t = useTranslations('ustaad.admin');
  const locale = useLocale();
  const baseId = useId();
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // `null` = no form open, `'new'` = adding, otherwise the id of the row being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<TableForm>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // SIM-B7: fields the person has left, and whether Save was pressed (errors show only after either).
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [merging, setMerging] = useState<{ id: string; into: string } | null>(null);
  // Where the keyboard goes after the next render (the form's first field on open, the heading on close).
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingFocus) return;
    const el = document.getElementById(pendingFocus);
    if (el) {
      el.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, editing, merging, rows]);

  const load = useCallback(async () => {
    const r = await config.read(locale);
    setFailed(r === null);
    if (r) setRows(r);
  }, [config, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (field: TableField) => t(adminMessage(`f_${field.label ?? field.name}`));
  const fieldById = (name: string) => config.fields.find((f) => f.name === name);
  const problems = editing ? formProblems(config.fields, form) : {};
  const visibleProblems = shownProblems(problems, touched, submitted);

  function open(row: TableRow | null) {
    setMessage(null);
    setMerging(null);
    setTouched(new Set());
    setSubmitted(false);
    if (row) {
      setEditing(String(row[config.idField]));
      setForm(formFromRow(config.fields, row));
    } else {
      setEditing('new');
      setForm(emptyForm(config.fields));
    }
    setPendingFocus(`${baseId}-${config.fields[0]?.name ?? ''}`);
  }

  function close() {
    setEditing(null);
    setMerging(null);
    setPendingFocus(`${baseId}-title`);
  }

  async function send(
    method: 'POST' | 'PATCH' | 'PUT',
    path: string,
    body: unknown,
    action: 'create' | 'update' | 'merge' | 'move',
  ) {
    setBusy(true);
    setMessage(null);
    const res = await adminApi(
      locale,
      path,
      { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
      {
        method,
        body,
      },
    );
    setBusy(false);
    if (res.ok) {
      track('admin_ustaad_change', { area: config.id, action, fields: 1 });
      setMessage({ tone: 'ok', text: t('t_saved') });
      close();
      onSaved?.();
      await load();
      return;
    }
    setMessage({ tone: 'error', text: t(adminMessage(tableErrorMessage(res.code, res.details))) });
    // SIM-B3: a refused save is said next to the Save button (inside the open form), with the keyboard there.
    if (editing !== null) setPendingFocus(`${baseId}-form-error`);
    if (res.status === 409) await load();
  }

  function submit() {
    setSubmitted(true);
    if (Object.keys(problems).length > 0) {
      setMessage({ tone: 'error', text: t('t_err_invalid') });
      const first = config.fields.find((f) => problems[f.name]);
      if (first) document.getElementById(`${baseId}-${first.name}`)?.focus();
      return;
    }
    const editedRow = rows?.find((r) => String(r[config.idField]) === editing);
    const body = { ...bodyFromForm(config.id, config.fields, form, editedRow), ...config.fixed };
    if (editing === 'new') {
      void send('POST', config.path, body, 'create');
      return;
    }
    const row = rows?.find((r) => String(r[config.idField]) === editing);
    if (!row) return;
    const version = typeof row.version === 'number' ? row.version : null;
    const { list: _list, ...rest } = body as Record<string, unknown>;
    void send(
      config.method,
      `${config.path}/${encodeURIComponent(String(row[config.idField]))}`,
      { ...(config.id.startsWith('words_') ? rest : body), version },
      'update',
    );
  }

  const shown = (row: TableRow, name: string) => {
    const v = row[name];
    const field = fieldById(name);
    if (name === 'status' && typeof v === 'string') return t(adminMessage(`e_promoState_${v}`));
    if (name === 'code' && config.id === 'reasons' && typeof v === 'string')
      return t(adminMessage(`e_reason_${v}`));
    if (typeof v === 'boolean')
      return (
        <StatusBadge tone={v ? 'success' : 'muted'} className="whitespace-nowrap">
          {t(v ? 't_active' : 't_inactive')}
        </StatusBadge>
      );
    if (field?.kind === 'select' && typeof v === 'string') return t(adminMessage(`e_${field.group}_${v}`));
    if (field?.kind === 'datetime' && typeof v === 'string')
      return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(v));
    if (typeof v === 'number') return new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(v);
    return <span data-user-content>{typeof v === 'string' ? v : ''}</span>;
  };

  const titleId = `${baseId}-title`;
  const editable = canEdit;

  return (
    <section aria-labelledby={titleId} className={`${adminCard} space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={titleId} tabIndex={-1} className="font-heading text-base font-extrabold text-ink">
            {t(adminMessage(`tbl_${config.id}`))}
          </h4>
          <p className="mt-0.5 max-w-prose text-sm text-muted">{t(adminMessage(`tbl_${config.id}_help`))}</p>
          {config.id === 'promotions' ? (
            <p className="mt-1 text-xs text-muted">{t('t_sponsored_note')}</p>
          ) : null}
          {config.id === 'cards' ? <p className="mt-1 text-xs text-muted">{t('t_media_later')}</p> : null}
        </div>
        {editable && config.create && editing === null ? (
          <button
            type="button"
            className={portalQuiet}
            data-disclosure-trigger={`ustaad-${config.id}-new`}
            onClick={() => {
              open(null);
            }}
          >
            {t('t_add')}
          </button>
        ) : null}
      </div>

      {message && (editing === null || message.tone === 'ok') ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm font-bold ${message.tone === 'error' ? 'text-error' : 'text-success'}`}
        >
          {message.text}
        </p>
      ) : null}

      {rows === null ? (
        failed ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t('load_error')}{' '}
            <button type="button" className={portalQuiet} onClick={() => void load()}>
              {t('retry')}
            </button>
          </p>
        ) : (
          <div className="skeleton h-16 rounded-card" aria-hidden="true" />
        )
      ) : rows.length === 0 && editing !== 'new' ? (
        <EmptyState
          title={t(
            adminMessage(config.id.startsWith('words_') ? 'tbl_words_empty' : `tbl_${config.id}_empty`),
          )}
        />
      ) : rows.length > 0 ? (
        <AdminTable label={t('t_rows', { name: t(adminMessage(`tbl_${config.id}`)) })}>
          <table className={adminTableClass}>
            <thead>
              <tr>
                {config.columns.map((c) => (
                  <th key={c} scope="col" className={adminTh}>
                    {t(adminMessage(`f_${fieldById(c)?.label ?? (c === 'name' ? 'city' : c)}`))}
                  </th>
                ))}
                {editable ? (
                  <th scope="col" className={adminTh}>
                    <span className="sr-only">{t('t_actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row[config.idField]);
                // Read out in the page language (hard rule 10): the Hindi text on /hi, else the typed text,
                // marked as user content (state audit API-ADM-USTAAD, 2026-11-26).
                const own = rowName(config, row, locale);
                const name = own.text === '' ? { text: id, localized: false } : own;
                const hiName = config.id === 'cities' && locale === 'hi' ? name.text : null;
                const merged =
                  typeof row.mergedIntoId === 'string'
                    ? rows.find((r) => r.id === row.mergedIntoId)
                    : undefined;
                const status = typeof row.status === 'string' ? row.status : null;
                return (
                  <tr key={id} className="hover:bg-pill/60">
                    {config.columns.map((c, i) => {
                      const Cell = i === 0 ? 'th' : 'td';
                      return (
                        <Cell
                          key={c}
                          scope={i === 0 ? 'row' : undefined}
                          className={`${adminTd} ${i === 0 ? 'font-bold' : ''}`}
                        >
                          {c === 'name' && hiName ? hiName : shown(row, c)}
                          {c === 'slug' && merged ? (
                            <span className="block text-xs text-muted">
                              {t('t_merged_into', { slug: String(merged.slug) })}
                            </span>
                          ) : null}
                        </Cell>
                      );
                    })}
                    {editable ? (
                      <td className={`${adminTd} whitespace-nowrap`}>
                        <div className="flex flex-wrap gap-2">
                          {config.id === 'cities' ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={portalQuiet}
                              onClick={() =>
                                void send(
                                  'PUT',
                                  `${config.path}/${id}`,
                                  {
                                    enabled: row.enabled !== true,
                                    version: typeof row.version === 'number' ? row.version : null,
                                  },
                                  'update',
                                )
                              }
                            >
                              <RowLabel
                                name={name}
                                message={(n) =>
                                  t(row.enabled === true ? 't_city_close' : 't_city_open', { city: n })
                                }
                              />
                            </button>
                          ) : status === 'live' || status === 'ended' || merged ? null : (
                            <button
                              type="button"
                              disabled={busy}
                              data-disclosure-trigger={`ustaad-${config.id}-${id}`}
                              className={portalQuiet}
                              onClick={() => {
                                open(row);
                              }}
                            >
                              <span aria-hidden="true">{t('t_edit')}</span>
                              <span className="sr-only">
                                <RowLabel name={name} message={(n) => t('t_edit_row', { name: n })} />
                              </span>
                            </button>
                          )}
                          {config.id === 'tags' && !merged && row.active === true ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={portalQuiet}
                              data-disclosure-trigger={`ustaad-${config.id}-merge`}
                              onClick={() => {
                                setEditing(null);
                                setMerging({ id, into: '' });
                                setPendingFocus(`${baseId}-merge`);
                              }}
                            >
                              <span aria-hidden="true">{t('t_merge')}</span>
                              <span className="sr-only">
                                <RowLabel name={name} message={(n) => t('t_merge_row', { name: n })} />
                              </span>
                            </button>
                          ) : null}
                          {config.id === 'promotions' && status
                            ? (['scheduled', 'draft', 'ended'] as const)
                                .filter((to) => isPromotionState(status) && promotionMoveAllowed(status, to))
                                .map((to) => (
                                  <button
                                    key={to}
                                    type="button"
                                    disabled={busy}
                                    className={to === 'scheduled' ? portalPrimary : portalQuiet}
                                    onClick={() =>
                                      void send(
                                        'POST',
                                        `${config.path}/${id}/move`,
                                        { to, version: row.version },
                                        'move',
                                      )
                                    }
                                  >
                                    <span aria-hidden="true">{t(adminMessage(`t_move_${to}`))}</span>
                                    <span className="sr-only">
                                      <RowLabel
                                        name={name}
                                        message={(n) =>
                                          t('t_move_row', {
                                            action: t(adminMessage(`t_move_${to}`)),
                                            name: n,
                                          })
                                        }
                                      />
                                    </span>
                                  </button>
                                ))
                            : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTable>
      ) : null}

      {merging && rows ? (
        <div className="space-y-2 rounded-tile bg-pill p-3">
          <label htmlFor={`${baseId}-merge`} className="text-sm font-bold text-ink">
            {t('t_merge_into_named', {
              name: textOf(rows.find((r) => r.id === merging.id)?.slug),
            })}
          </label>
          <p id={`${baseId}-merge-help`} className="text-xs text-muted">
            {t('t_merge_help')}
          </p>
          <select
            id={`${baseId}-merge`}
            value={merging.into}
            aria-describedby={`${baseId}-merge-help`}
            onChange={(e) => {
              setMerging({ ...merging, into: e.target.value });
            }}
            className={`${portalField} tab:w-72`}
          >
            <option value="">{t('t_choose')}</option>
            {rows
              .filter((r) => r.id !== merging.id && r.active === true && r.mergedIntoId === null)
              .map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  #{String(r.slug)}
                </option>
              ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || merging.into === ''}
              className={portalPrimary}
              onClick={() => {
                const row = rows.find((r) => r.id === merging.id);
                void send(
                  'POST',
                  `${config.path}/${merging.id}/merge`,
                  { intoId: merging.into, version: row?.version },
                  'merge',
                );
              }}
            >
              {t('t_merge')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              data-panel-cancel={`ustaad-${config.id}-merge`}
              onClick={close}
            >
              {t('t_cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {editing !== null ? (
        <form
          noValidate
          aria-label={editing === 'new' ? t('t_new') : t('t_edit')}
          className="space-y-3 rounded-tile bg-pill p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 tab:grid-cols-2">
            {config.fields.map((f) => {
              const id = `${baseId}-${f.name}`;
              const problem = visibleProblems[f.name];
              const errId = `${id}-error`;
              const lang = f.name.endsWith('En') ? 'en' : f.name.endsWith('Hi') ? 'hi' : undefined;
              return (
                <div
                  key={f.name}
                  className={f.kind === 'text' && f.max > 120 ? 'tab:col-span-2' : ''}
                  onBlur={() => {
                    if (!touched.has(f.name)) setTouched(new Set([...touched, f.name]));
                  }}
                >
                  {f.kind === 'bool' ? (
                    <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-ink">
                      <input
                        id={id}
                        type="checkbox"
                        checked={form[f.name] === 'true'}
                        onChange={(e) => {
                          setForm({ ...form, [f.name]: e.target.checked ? 'true' : 'false' });
                        }}
                        className="size-5"
                      />
                      {label(f)}
                    </label>
                  ) : (
                    <>
                      <label htmlFor={id} className="text-sm font-bold text-ink">
                        {label(f)}
                      </label>
                      {f.kind === 'select' ? (
                        <select
                          id={id}
                          value={form[f.name] ?? ''}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? errId : undefined}
                          onChange={(e) => {
                            setForm({ ...form, [f.name]: e.target.value });
                          }}
                          className={portalField}
                        >
                          <option value="">{t('t_choose')}</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {t(adminMessage(`e_${f.group}_${o}`))}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          type={f.kind === 'datetime' ? 'datetime-local' : 'text'}
                          inputMode={f.kind === 'number' ? 'numeric' : undefined}
                          lang={lang}
                          autoComplete="off"
                          value={form[f.name] ?? ''}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={
                            [f.kind === 'list' ? `${id}-help` : '', problem ? errId : '']
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          onChange={(e) => {
                            setForm({ ...form, [f.name]: e.target.value });
                          }}
                          className={portalField}
                        />
                      )}
                      {f.kind === 'list' ? (
                        <p id={`${id}-help`} className="mt-1 text-xs text-muted">
                          {t('t_aliases_help')}
                        </p>
                      ) : null}
                    </>
                  )}
                  {problem ? (
                    <p id={errId} className="mt-1 text-sm font-bold text-error">
                      {problem.kind === 'range'
                        ? t('err_range', { min: problem.min, max: problem.max })
                        : t('err_type')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {message?.tone === 'error' ? (
            <p
              id={`${baseId}-form-error`}
              role="alert"
              tabIndex={-1}
              className="text-sm font-bold text-error"
            >
              {message.text}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={portalPrimary}>
              {busy ? t('t_saving') : t('t_save')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              data-panel-cancel={`ustaad-${config.id}-${editing}`}
              onClick={() => {
                setMessage(null);
                close();
              }}
            >
              {t('t_cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** A translated label around a row's name; a name staff typed in one language only is marked as user content. */
function RowLabel({
  name,
  message,
}: {
  name: { text: string; localized: boolean };
  message: (name: string) => string;
}) {
  const { before, after } = splitAroundName(message);
  return (
    <>
      {before}
      {name.localized ? name.text : <span data-user-content>{name.text}</span>}
      {after}
    </>
  );
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');

function isPromotionState(s: string): s is (typeof PROMOTION_STATES)[number] {
  return (PROMOTION_STATES as readonly string[]).includes(s);
}
