'use client';

import {
  COD_DECISION_REASONS,
  COD_REQUEST_STATES,
  COD_REVOKE_REASONS,
  type CodDecisionReason,
  type CodRequestState,
  type CodRevokeReason,
} from '@mechdost/shared/cod-eligibility';
import { maskPhone } from '@mechdost/shared/contact-mask';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { riskOfChange } from '@/lib/admin-settings-registry';
import { AUTH_MODE } from '@/lib/auth/mode';
import { formatPrice } from '@/lib/format';
import {
  decideDemoCod,
  revokeDemoCod,
  setDemoCodSwitches,
  useDemoCod,
  type DemoCodResult,
  type DemoCodState,
} from '@/demo/cod';
import { accountsSnapshot } from '@/demo/session';
import { DEMO_CITY } from '@/demo/city';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

const REAL = AUTH_MODE === 'firebase';
const FILTERS: readonly CodRequestState[] = COD_REQUEST_STATES;

interface Item {
  id: string;
  status: CodRequestState;
  customerName: string | null;
  customerPhone: string | null;
  pincode: string;
  cityCode: string;
  reasonCode: string;
  note: string | null;
  createdAt: string;
  deliveredOrders: number | null;
  cancelledOrders: number | null;
  ustaadVerified: boolean;
  capPaise: number | null;
  version: number;
}

type Load =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; items: Item[]; nextCursor: string | null };
type Form = { id: string; kind: 'approve' | 'reject' | 'revoke' } | null;
type ErrKey =
  | 'errCap'
  | 'errExpires'
  | 'errReason'
  | 'err_STALE_COD_REQUEST'
  | 'err_COD_SELF_DECISION'
  | 'err_COD_ALREADY_APPROVED'
  | 'err_NOT_FOUND'
  | 'err_generic';
const SERVER_ERRORS = new Set([
  'STALE_COD_REQUEST',
  'COD_SELF_DECISION',
  'COD_ALREADY_APPROVED',
  'NOT_FOUND',
]);
const errKey = (code: string): ErrKey =>
  SERVER_ERRORS.has(code) ? (`err_${code}` as ErrKey) : 'err_generic';

/**
 * Admin → Customers → COD requests (founder ruling 2026-11-26; spec 08 "COD requests"). One status at a time
 * (waiting first, oldest first); each card shows who asked, where, why, their order history and an Ustaad badge,
 * with Approve (optional personal limit and end date), Turn down (reason code) or Take back (reason code). Real
 * sign-in reads `/v1/admin/cod-requests` (only the staff member's cities); the demo uses its browser store and shows
 * the three switches here (on the API they live in Settings → Payments).
 */
export function AdminCodRequests({ actor }: { actor: string }) {
  const t = useTranslations('adminCod');
  const r = useTranslations('codRequest');
  const locale = useLocale();
  const uid = useId();
  const [status, setStatus] = useState<CodRequestState>('pending');
  const [real, setReal] = useState<Load>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState<Form>(null);
  const [cap, setCap] = useState('');
  const [expires, setExpires] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ErrKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<'done_approved' | 'done_rejected' | 'done_revoked' | null>(null);
  const demo = useDemoCod();

  useEffect(() => {
    if (!REAL) return;
    let live = true;
    void import('@/lib/cod-api').then(async ({ fetchCodQueue }) => {
      const res = await fetchCodQueue(locale, status, null);
      if (!live) return;
      setReal(
        res.ok
          ? { state: 'ready', items: res.data.items, nextCursor: res.data.nextCursor }
          : { state: 'error' },
      );
    });
    return () => {
      live = false;
    };
  }, [locale, status, reload]);

  async function more(cursor: string) {
    const { fetchCodQueue } = await import('@/lib/cod-api');
    const res = await fetchCodQueue(locale, status, cursor);
    if (res.ok)
      setReal((prev) =>
        prev.state === 'ready'
          ? { state: 'ready', items: [...prev.items, ...res.data.items], nextCursor: res.data.nextCursor }
          : prev,
      );
  }

  const load: Load = REAL ? real : { state: 'ready', items: demoItems(status, demo), nextCursor: null };
  const refresh = useCallback(() => {
    setReload((n) => n + 1);
  }, []);

  function open(id: string, kind: 'approve' | 'reject' | 'revoke') {
    setForm({ id, kind });
    setCap('');
    setExpires('');
    setReason('');
    setError(null);
    setDone(null);
    // The pressed button is replaced by the form: focus its first field (a11y review 2026-11-26).
    const field = `${uid}-${id}-${kind === 'approve' ? 'cap' : 'reason'}`;
    window.requestAnimationFrame(() => document.getElementById(field)?.focus());
  }

  const focusField = (item: Item, part: 'cap' | 'exp' | 'reason') => {
    window.requestAnimationFrame(() => document.getElementById(`${uid}-${item.id}-${part}`)?.focus());
  };

  async function confirm(item: Item) {
    if (!form || saving) return;
    let capPaise: number | null = null;
    let expiresAt: string | null = null;
    if (form.kind === 'approve') {
      if (cap.trim() !== '') {
        const rupees = Number(cap);
        if (!Number.isInteger(rupees) || rupees < 1 || rupees > 100_000) {
          setError('errCap');
          focusField(item, 'cap');
          return;
        }
        capPaise = rupees * 100;
      }
      if (expires !== '') {
        // End of the chosen day in India.
        const at = new Date(`${expires}T23:59:59+05:30`);
        if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + 3_600_000) {
          setError('errExpires');
          focusField(item, 'exp');
          return;
        }
        expiresAt = at.toISOString();
      }
    } else if (reason === '') {
      setError('errReason');
      focusField(item, 'reason');
      return;
    }
    setSaving(true);
    let result: { ok: true } | { ok: false; code: string };
    if (REAL) {
      const { decideCod } = await import('@/lib/cod-api');
      const d =
        form.kind === 'approve'
          ? ({ kind: 'approve', capPaise, expiresAt } as const)
          : form.kind === 'reject'
            ? ({ kind: 'reject', reasonCode: reason as CodDecisionReason } as const)
            : ({ kind: 'revoke', reasonCode: reason as CodRevokeReason } as const);
      const res = await decideCod(locale, item.id, item.version, d);
      result = res.ok ? { ok: true } : { ok: false, code: res.code };
    } else {
      const res: DemoCodResult =
        form.kind === 'revoke'
          ? revokeDemoCod({ id: item.id, version: item.version, reasonCode: reason as CodRevokeReason })
          : decideDemoCod({
              id: item.id,
              version: item.version,
              by: actor,
              decision: form.kind,
              reasonCode: form.kind === 'reject' ? (reason as CodDecisionReason) : null,
              capPaise,
              expiresAt,
            });
      result = res;
    }
    setSaving(false);
    if (!result.ok) {
      setError(errKey(result.code));
      if (result.code === 'STALE_COD_REQUEST') refresh();
      return;
    }
    setDone(
      form.kind === 'approve' ? 'done_approved' : form.kind === 'reject' ? 'done_rejected' : 'done_revoked',
    );
    setForm(null);
    refresh();
    // The card leaves this list: focus the result line, where the outcome is read.
    window.requestAnimationFrame(() => document.getElementById(`${uid}-result`)?.focus());
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));

  return (
    <section className={`${portalCard} mt-6`} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="font-heading text-xl font-extrabold text-ink">
        {t('title')}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t('intro')}</p>
      {REAL ? (
        <Link
          href={`${locale === 'hi' ? '/hi' : ''}/admin/settings?cat=payments`}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-ink underline underline-offset-2"
        >
          {t('settingsLink')}
        </Link>
      ) : (
        <DemoSwitches />
      )}

      <fieldset className="mt-4">
        <legend className="text-sm font-bold text-ink">{t('filterLabel')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <label
              key={f}
              className={`press inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-button border px-3 text-sm font-bold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${status === f ? 'border-ink bg-ink text-surface' : 'border-input-border text-ink hover:bg-pill'}`}
            >
              <input
                type="radio"
                name={`${uid}-status`}
                value={f}
                checked={status === f}
                onChange={() => {
                  setStatus(f);
                  setForm(null);
                  setDone(null);
                  if (REAL) setReal({ state: 'loading' });
                }}
                className="sr-only"
              />
              {/* Not colour alone: the chosen filter also carries a tick. */}
              {status === f ? <span aria-hidden="true">✓</span> : null}
              {t(`status_${f}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* One persistent live region: decision results, else how many requests the filter shows. */}
      <div id={`${uid}-result`} tabIndex={-1} role="status" className="mt-3 text-sm font-bold text-ink">
        {done ? t(done) : load.state === 'ready' ? t('results', { count: load.items.length }) : ''}
      </div>

      {load.state === 'loading' ? (
        <p className="mt-3 text-sm text-muted">{t('loading')}</p>
      ) : load.state === 'error' ? (
        <div className="mt-3">
          <p role="alert" className="text-sm font-bold text-error">
            {t('error')}
          </p>
          <button type="button" onClick={refresh} className={`${portalQuiet} mt-2`}>
            {t('retry')}
          </button>
        </div>
      ) : load.items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {status === 'pending' ? t('empty_pending') : t('empty_other')}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {load.items.map((item) => {
            const formId = `${uid}-${item.id}`;
            const isOpen = form?.id === item.id;
            return (
              <li key={item.id} className="rounded-tile border border-line-card p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p id={`${formId}-who`} className="font-bold text-ink">
                    <span translate="no">{item.customerName ?? '—'}</span>{' '}
                    <span className="font-normal text-muted" translate="no">
                      {item.customerPhone ?? ''}
                    </span>
                  </p>
                  {item.ustaadVerified ? (
                    <span className="rounded-pill bg-pill px-2 py-0.5 text-xs font-bold text-ink">
                      {t('ustaadBadge')}
                    </span>
                  ) : null}
                </div>
                <p className="text-muted">
                  {t('place', { pincode: item.pincode, city: item.cityCode })} ·{' '}
                  {t('asked', { date: date(item.createdAt) })}
                </p>
                <p className="mt-1 text-ink">
                  <span className="font-bold">{t('reason')}:</span> {r(`reason_${reasonOf(item.reasonCode)}`)}
                </p>
                {item.note ? (
                  <p className="mt-1 text-ink">
                    <span className="font-bold">{t('note')}:</span> <span>{item.note}</span>
                  </p>
                ) : null}
                {item.deliveredOrders !== null && item.cancelledOrders !== null ? (
                  <p className="mt-1 text-muted">
                    {t('history', { delivered: item.deliveredOrders, cancelled: item.cancelledOrders })}
                  </p>
                ) : null}
                {item.status === 'approved' && item.capPaise !== null ? (
                  <p className="mt-1 text-muted">{formatPrice(item.capPaise)}</p>
                ) : null}

                {!isOpen && (item.status === 'pending' || item.status === 'approved') ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          data-disclosure-trigger={`cod-${item.id}-approve`}
                          aria-describedby={`${formId}-who`}
                          className={portalPrimary}
                          onClick={() => {
                            open(item.id, 'approve');
                          }}
                        >
                          {t('approve')}
                        </button>
                        <button
                          type="button"
                          data-disclosure-trigger={`cod-${item.id}-reject`}
                          aria-describedby={`${formId}-who`}
                          className={portalQuiet}
                          onClick={() => {
                            open(item.id, 'reject');
                          }}
                        >
                          {t('reject')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-disclosure-trigger={`cod-${item.id}-revoke`}
                        aria-describedby={`${formId}-who`}
                        className={portalQuiet}
                        onClick={() => {
                          open(item.id, 'revoke');
                        }}
                      >
                        {t('revoke')}
                      </button>
                    )}
                  </div>
                ) : null}

                {isOpen ? (
                  <div
                    className="mt-3 rounded-tile bg-surface-alt p-3"
                    role="group"
                    aria-labelledby={`${formId}-legend`}
                  >
                    <p id={`${formId}-legend`} className="font-bold text-ink">
                      {t(
                        form.kind === 'approve'
                          ? 'confirmApprove'
                          : form.kind === 'reject'
                            ? 'confirmReject'
                            : 'confirmRevoke',
                      )}
                    </p>
                    {form.kind === 'approve' ? (
                      <div className="mt-2 grid gap-3 min-[600px]:grid-cols-2">
                        <div>
                          <label htmlFor={`${formId}-cap`} className="block font-bold text-ink">
                            {t('capLabel')}
                          </label>
                          <input
                            id={`${formId}-cap`}
                            value={cap}
                            onChange={(e) => {
                              setCap(e.target.value.replace(/\D/g, '').slice(0, 6));
                            }}
                            inputMode="numeric"
                            autoComplete="off"
                            aria-invalid={error === 'errCap'}
                            aria-describedby={`${formId}-cap-hint${error === 'errCap' ? ` ${formId}-error` : ''}`}
                            className={portalField}
                          />
                          <p id={`${formId}-cap-hint`} className="mt-1 text-xs text-muted">
                            {t('capHint')}
                          </p>
                        </div>
                        <div>
                          <label htmlFor={`${formId}-exp`} className="block font-bold text-ink">
                            {t('expiresLabel')}
                          </label>
                          <input
                            id={`${formId}-exp`}
                            type="date"
                            value={expires}
                            onChange={(e) => {
                              setExpires(e.target.value);
                            }}
                            aria-invalid={error === 'errExpires'}
                            aria-describedby={error === 'errExpires' ? `${formId}-error` : undefined}
                            className={portalField}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <label htmlFor={`${formId}-reason`} className="block font-bold text-ink">
                          {t(form.kind === 'reject' ? 'rejectReason' : 'revokeReason')}
                        </label>
                        <select
                          id={`${formId}-reason`}
                          value={reason}
                          onChange={(e) => {
                            setReason(e.target.value);
                          }}
                          aria-invalid={error === 'errReason'}
                          aria-describedby={error === 'errReason' ? `${formId}-error` : undefined}
                          className={portalField}
                        >
                          <option value="">{t('choose')}</option>
                          {(form.kind === 'reject' ? COD_DECISION_REASONS : COD_REVOKE_REASONS).map(
                            (code) => (
                              <option key={code} value={code}>
                                {form.kind === 'reject'
                                  ? t(`dreason_${code as CodDecisionReason}`)
                                  : t(`rreason_${code as CodRevokeReason}`)}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    )}
                    {error ? (
                      <p id={`${formId}-error`} role="alert" className="mt-2 font-bold text-error">
                        {t(error)}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-disabled={saving}
                        className={portalPrimary}
                        onClick={() => void confirm(item)}
                      >
                        {saving
                          ? t('saving')
                          : t(
                              form.kind === 'approve'
                                ? 'confirmApprove'
                                : form.kind === 'reject'
                                  ? 'confirmReject'
                                  : 'confirmRevoke',
                            )}
                      </button>
                      <button
                        type="button"
                        data-panel-cancel={`cod-${item.id}-${form.kind}`}
                        className={portalQuiet}
                        onClick={() => {
                          setForm(null);
                          setError(null);
                        }}
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {load.state === 'ready' && load.nextCursor ? (
        <button
          type="button"
          className={`${portalQuiet} mt-3`}
          onClick={() => void more(load.nextCursor ?? '')}
        >
          {t('more')}
        </button>
      ) : null}
    </section>
  );
}

const REQUEST_REASON_KEYS = [
  'no_upi_or_card',
  'prefer_pay_on_receipt',
  'business_cash_account',
  'regular_buyer',
  'large_order',
  'other',
] as const;
type RequestReasonKey = (typeof REQUEST_REASON_KEYS)[number];
const reasonOf = (code: string): RequestReasonKey =>
  (REQUEST_REASON_KEYS as readonly string[]).includes(code) ? (code as RequestReasonKey) : 'other';

/** The demo's requests for one status, oldest first while waiting (as on the API). */
function demoItems(status: CodRequestState, state: DemoCodState): Item[] {
  const accounts = new Map(accountsSnapshot().map((a) => [a.id, a]));
  const now = Date.now();
  const rows = state.requests
    .map((q) => ({
      ...q,
      status:
        q.status === 'approved' && q.expiresAt !== null && Date.parse(q.expiresAt) <= now
          ? ('expired' as const)
          : q.status,
    }))
    .filter((q) => q.status === status);
  const ordered = status === 'pending' ? rows : rows.toReversed();
  return ordered.map((q) => {
    const a = accounts.get(q.accountId);
    return {
      id: q.id,
      status: q.status,
      customerName: a?.name ?? null,
      customerPhone: a ? maskPhone(`+91${a.phone}`) : null,
      pincode: q.pincode,
      cityCode: DEMO_CITY.code,
      reasonCode: q.reasonCode,
      note: q.note,
      createdAt: q.createdAt,
      deliveredOrders: null,
      cancelledOrders: null,
      ustaadVerified: state.ustaad[q.accountId]?.verificationState === 'verified',
      capPaise: q.capPaise,
      version: q.version,
    };
  });
}

/** Demo only: who can pay cash on delivery (Settings → Payments on the API), with the risk note for "everyone". */
function DemoSwitches() {
  const t = useTranslations('adminCod');
  const a = useTranslations('adminSettings');
  const demo = useDemoCod();
  const uid = useId();
  const [risk, setRisk] = useState(false);
  const keys = [
    ['everyone', 'switch_everyone', 'checkout.cod_everyone'],
    ['approved', 'switch_approved', 'checkout.cod_approved_customers'],
    ['ustaad', 'switch_ustaad', 'checkout.cod_ustaad_verified'],
  ] as const;
  return (
    <fieldset className="mt-3 rounded-tile border border-line-card p-3">
      <legend className="px-1 text-sm font-bold text-ink">{t('switchesTitle')}</legend>
      {keys.map(([key, label, setting]) => (
        <label key={key} className="flex min-h-11 items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={demo.switches[key]}
            aria-describedby={key === 'everyone' && risk ? `${uid}-risk` : undefined}
            onChange={(e) => {
              const on = e.target.checked;
              setRisk(riskOfChange(setting, demo.switches[key], on) === 'risk_codEveryone');
              setDemoCodSwitches({ [key]: on });
            }}
            className="size-6 accent-[var(--color-accent-button)]"
          />
          {t(label)}
        </label>
      ))}
      {/* Always mounted so the warning is announced when it appears. */}
      <p
        id={`${uid}-risk`}
        role="status"
        className={
          risk ? 'mt-2 rounded-input bg-warning-bg px-3 py-2 text-sm font-bold text-warning' : 'sr-only'
        }
      >
        {risk ? a('risk_codEveryone') : ''}
      </p>
    </fieldset>
  );
}
