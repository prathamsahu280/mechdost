'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { USTAAD_TESTER_ADD_REASONS, USTAAD_TESTER_REMOVE_REASONS } from '@mechdost/shared/ustaad/codes';
import { PreviewTesterRowDto, type PreviewTesterRow } from '@mechdost/shared/ustaad/dto/admin';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { adminCard } from '../admin-ui';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';

/**
 * Admin → Ustaad → General: preview testers (founder 2026-11-27; spec 23 § 3). Super admin only (the API answers 403
 * to everyone else, so this card is shown only to those who can edit settings). Add an account by its mobile number or
 * email with a reason code; the list shows the masked phone only. Remove asks for a reason inline (no stacked modal).
 */
type AddReason = (typeof USTAAD_TESTER_ADD_REASONS)[number];
type RemoveReason = (typeof USTAAD_TESTER_REMOVE_REASONS)[number];

const ListSchema: ResponseSchema<{ testers: PreviewTesterRow[] }> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('testers' in value) || !Array.isArray(value.testers))
      return { success: false };
    const rows: PreviewTesterRow[] = [];
    for (const r of value.testers) {
      const p = PreviewTesterRowDto.safeParse(r);
      if (!p.success) return { success: false };
      rows.push(p.data);
    }
    return { success: true, data: { testers: rows } };
  },
};
const OkSchema: ResponseSchema<true> = { safeParse: () => ({ success: true, data: true }) };

const ERROR_CODES = [
  'NOT_FOUND',
  'IDENTIFIER_FORMAT',
  'TESTER_EXISTS',
  'TESTERS_FULL',
  'STALE_TESTER',
] as const;
type ErrorKey = `err_${(typeof ERROR_CODES)[number]}` | 'err_other';
const errorKey = (code: string): ErrorKey =>
  (ERROR_CODES as readonly string[]).includes(code) ? (`err_${code}` as ErrorKey) : 'err_other';

/** Where keyboard focus goes after the next render (a11y review 2026-11-27: never drop focus to the page). */
type FocusTarget =
  { kind: 'identifier' } | { kind: 'remove'; rowId: string } | { kind: 'confirm'; rowId: string };

export function PreviewTestersCard() {
  const t = useTranslations('ustaad.adminTesters');
  const locale = useLocale();
  const id = useId();
  const [rows, setRows] = useState<PreviewTesterRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [reason, setReason] = useState<AddReason>('qa_run');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState<RemoveReason>('run_finished');
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  const domId = useCallback(
    (f: FocusTarget) =>
      f.kind === 'identifier'
        ? `${id}-ident`
        : f.kind === 'remove'
          ? `${id}-rmbtn-${f.rowId}`
          : `${id}-rm-${f.rowId}`,
    [id],
  );

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(domId(focusTarget))?.focus();
    setFocusTarget(null);
  }, [focusTarget, domId, rows, removing]);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/ustaad/preview-testers', ListSchema);
    setLoadFailed(!res.ok);
    if (res.ok) setRows(res.data.testers);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    setAddError(null);
    const res = await adminApi(locale, '/admin/ustaad/preview-testers', PreviewTesterRowDto, {
      method: 'POST',
      body: { identifier, reasonCode: reason, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setBusy(false);
    if (!res.ok) {
      setAddError(t(errorKey(res.code)));
      setFocusTarget({ kind: 'identifier' });
      return;
    }
    track('admin_ustaad_change', { area: 'preview_testers', action: 'create', fields: 1 });
    setIdentifier('');
    setNote('');
    setStatus(t('added'));
    await load();
    setFocusTarget({ kind: 'identifier' });
  };

  const remove = async (row: PreviewTesterRow, list: readonly PreviewTesterRow[]) => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    setRowError(null);
    const res = await adminApi(locale, `/admin/ustaad/preview-testers/${row.id}/remove`, OkSchema, {
      method: 'POST',
      body: { reasonCode: removeReason, version: row.version },
    });
    setBusy(false);
    if (!res.ok) {
      setRowError(t(errorKey(res.code)));
      return;
    }
    track('admin_ustaad_change', { area: 'preview_testers', action: 'remove', fields: 1 });
    // Focus stays near the user's place: the next row's Remove, else the previous one, else the add field.
    const i = list.findIndex((r) => r.id === row.id);
    const neighbour = list[i + 1] ?? list[i - 1];
    setRemoving(null);
    setStatus(t('removed'));
    await load();
    setFocusTarget(neighbour ? { kind: 'remove', rowId: neighbour.id } : { kind: 'identifier' });
  };

  const cancel = (rowId: string) => {
    setRemoving(null);
    setRowError(null);
    setFocusTarget({ kind: 'remove', rowId });
  };

  const dateFmt = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <section className={`${adminCard} space-y-4`} aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
          {t('title')}
        </h2>
        <p className="mt-0.5 max-w-prose text-sm text-muted">{t('lead')}</p>
      </div>

      <form
        className="grid gap-3 tab:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] tab:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="grid gap-1">
          <label htmlFor={`${id}-ident`} className="text-sm font-bold text-ink">
            {t('identifier')}
          </label>
          <input
            id={`${id}-ident`}
            className={portalField}
            value={identifier}
            required
            minLength={3}
            maxLength={254}
            autoComplete="off"
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? `${id}-ident-help ${id}-ident-err` : `${id}-ident-help`}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setAddError(null);
            }}
          />
          <p id={`${id}-ident-help`} className="text-xs text-muted">
            {t('identifier_help')}
          </p>
          <p id={`${id}-ident-err`} role="alert" className="text-sm font-bold text-danger">
            {addError ?? ''}
          </p>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-reason`} className="text-sm font-bold text-ink">
            {t('reason')}
          </label>
          <select
            id={`${id}-reason`}
            className={portalField}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as AddReason);
            }}
          >
            {USTAAD_TESTER_ADD_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`add_${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-note`} className="text-sm font-bold text-ink">
            {t('note')}
          </label>
          <input
            id={`${id}-note`}
            className={portalField}
            value={note}
            maxLength={200}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </div>
        {/* Top-aligned row: the hint under the first field must not lift its input; the button drops by one label + gap (28 px, measured live). */}
        <button type="submit" className={`${portalPrimary} tab:mt-7`} aria-disabled={busy || undefined}>
          {t('add')}
        </button>
      </form>

      <p role="status" aria-live="polite" className="text-sm text-ink">
        {status}
      </p>

      {loadFailed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm font-bold text-danger">
          {t('err_other')}
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              void load();
            }}
          >
            {t('retry')}
          </button>
        </div>
      ) : rows === null ? (
        <p className="text-sm text-muted" aria-busy="true">
          {t('loading')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <div
          className="relative overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          role="region"
          aria-labelledby={`${id}-title`}
          tabIndex={0}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="border-b border-line-card text-muted">
                <th scope="col" className="py-2 pr-3 font-bold">
                  {t('col_phone')}
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  {t('col_reason')}
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  {t('col_added')}
                </th>
                <th scope="col" className="py-2 font-bold">
                  {t('col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const phone = row.maskedPhone ?? t('no_phone');
                return (
                  <tr key={row.id} className="border-b border-line-card align-top">
                    <td className="py-2 pr-3 font-mono text-ink">{phone}</td>
                    <td className="py-2 pr-3 text-ink">
                      {t(`add_${row.reasonCode}`)}
                      {row.note ? (
                        <span data-user-content className="block text-xs text-muted">
                          {row.note}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-ink">{dateFmt.format(new Date(row.addedAt))}</td>
                    <td className="py-2">
                      {removing === row.id ? (
                        <div
                          role="group"
                          aria-label={t('remove_label', { phone })}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <div className="grid gap-1">
                            <label htmlFor={`${id}-rm-${row.id}`} className="text-xs font-bold text-ink">
                              {t('remove_reason', { phone })}
                            </label>
                            <select
                              id={`${id}-rm-${row.id}`}
                              className={portalField}
                              value={removeReason}
                              onChange={(e) => {
                                setRemoveReason(e.target.value as RemoveReason);
                              }}
                            >
                              {USTAAD_TESTER_REMOVE_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {t(`rm_${r}`)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className={portalPrimary}
                            aria-disabled={busy || undefined}
                            aria-describedby={rowError ? `${id}-rm-err-${row.id}` : undefined}
                            onClick={() => {
                              void remove(row, rows);
                            }}
                          >
                            {t('confirm_remove')}
                          </button>
                          {/* Escape = this Cancel (PanelDismiss in the layout); focus goes back to the row's Remove. */}
                          <button
                            type="button"
                            className={portalQuiet}
                            data-panel-cancel={`tester-${row.id}`}
                            onClick={() => {
                              cancel(row.id);
                            }}
                          >
                            {t('cancel')}
                          </button>
                          <p
                            id={`${id}-rm-err-${row.id}`}
                            role="alert"
                            className="w-full text-sm font-bold text-danger"
                          >
                            {rowError ?? ''}
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          id={`${id}-rmbtn-${row.id}`}
                          data-disclosure-trigger={`tester-${row.id}`}
                          className={portalQuiet}
                          aria-disabled={busy || undefined}
                          onClick={() => {
                            if (busy) return;
                            setRemoveReason('run_finished');
                            setRowError(null);
                            setRemoving(row.id);
                            setFocusTarget({ kind: 'confirm', rowId: row.id });
                          }}
                        >
                          {t('remove')}
                          <span className="sr-only"> {phone}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
