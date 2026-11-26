'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  AdminTable,
  EmptyState,
  StatusBadge,
  adminCard,
  adminTableClass,
  adminTd,
  adminTh,
} from '@/components/portal/admin-ui';
import { portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { useLiveReload } from '@/lib/delivery/use-delivery-client';
import {
  PAYOUT_METHODS,
  type AdminAgentRowView,
  type AdminDeliveryClient,
  type AdminPayoutView,
  type PayoutMethod,
  type PayoutSummaryRow,
} from '@/lib/delivery/types';
import { useStatusLine } from './parts';

/** Today and seven days back as IST calendar dates (YYYY-MM-DD), the default period. */
function lastWeek(): { from: string; to: string } {
  const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
  const now = Date.now();
  return { from: ist(now - 6 * 86_400_000), to: ist(now) };
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break; a leading = + - @ is neutralised (CSV injection). */
function csvField(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Admin → Delivery → Payouts (founder ruling 2026-11-26: manual for now). Staff record what they paid an agent
 * (amount in ₹ → integer paise, period, method, reference/UTR, note), see per agent how many jobs were delivered in the
 * period to work out the amount, correct a payout with a reversing entry (never an edit), and export the list as CSV.
 */
export function PayoutsTab({ client, agents }: { client: AdminDeliveryClient; agents: AdminAgentRowView[] }) {
  const t = useTranslations('deliveryAdmin');
  const locale = useLocale();
  const { say, line } = useStatusLine();
  const [period, setPeriod] = useState(lastWeek);
  const [agentId, setAgentId] = useState('');
  const [items, setItems] = useState<AdminPayoutView[] | null>(null);
  const [summary, setSummary] = useState<PayoutSummaryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const reload = useCallback(() => {
    void Promise.all([
      client.payouts({ agentId: agentId || undefined, from: period.from, to: period.to }),
      client.payoutSummary(period.from, period.to),
    ]).then(([p, s]) => {
      if (p.ok) setItems(p.data.items);
      if (s.ok) setSummary(s.data.items);
      setFailed(!p.ok || !s.ok);
    });
  }, [client, agentId, period]);
  useLiveReload(client, reload, 30_000);
  useEffect(() => {
    track('click', { id: 'admin_delivery_payouts_viewed', path: window.location.pathname });
  }, []);

  function exportCsv() {
    const rows = [
      [
        'created_at',
        'agent',
        'amount_paise',
        'period_from',
        'period_to',
        'method',
        'reference',
        'reverses_id',
        'note',
      ],
      ...(items ?? []).map((p) => [
        p.createdAt,
        p.agentName,
        p.amountPaise,
        p.periodFrom,
        p.periodTo,
        p.method,
        p.reference ?? '',
        p.reversesId ?? '',
        p.note ?? '',
      ]),
    ];
    const blob = new Blob([`${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mechdost-agent-payouts-${period.from}-to-${period.to}.csv`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 1000);
    track('click', { id: 'admin_delivery_payouts_csv', path: window.location.pathname });
  }

  async function correct(id: string) {
    if (note.trim().length < 5) {
      say(t('overrideReasonError'), 'error');
      document.getElementById(`correct-note-${id}`)?.focus();
      return;
    }
    const r = await client.correctPayout(id, note.trim());
    track('click', {
      id: r.ok ? 'admin_delivery_payout_corrected' : 'admin_delivery_payout_correct_failed',
      path: window.location.pathname,
    });
    say(r.ok ? t('payoutCorrected') : t('genericError', { code: r.code }), r.ok ? 'ok' : 'error');
    setCorrecting(null);
    setNote('');
    reload();
  }

  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? '';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="payout-agent" className="text-sm font-bold text-ink">
            {t('col_agent')}
          </label>
          <select
            id="payout-agent"
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
            }}
            className={`${portalField} block`}
          >
            <option value="">{t('filterAll')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="payout-from" className="text-sm font-bold text-ink">
            {t('periodFrom')}
          </label>
          <input
            id="payout-from"
            type="date"
            value={period.from}
            max={period.to}
            onChange={(e) => {
              if (e.target.value) setPeriod({ ...period, from: e.target.value });
            }}
            className={`${portalField} block`}
          />
        </div>
        <div>
          <label htmlFor="payout-to" className="text-sm font-bold text-ink">
            {t('periodTo')}
          </label>
          <input
            id="payout-to"
            type="date"
            value={period.to}
            min={period.from}
            onChange={(e) => {
              if (e.target.value) setPeriod({ ...period, to: e.target.value });
            }}
            className={`${portalField} block`}
          />
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className={portalQuiet}
          aria-disabled={!items?.length || undefined}
        >
          {t('exportCsv')}
        </button>
      </div>
      {line}
      {failed ? (
        <div role="alert" className={`${adminCard} text-sm`}>
          <p>{t('loadError')}</p>
          <button type="button" onClick={reload} className={`${portalQuiet} mt-2`}>
            {t('retry')}
          </button>
        </div>
      ) : null}

      <section aria-labelledby="payout-summary" className="space-y-2">
        <h3 id="payout-summary" className="font-heading text-lg font-extrabold text-ink">
          {t('payoutSummaryTitle')}
        </h3>
        <p className="text-sm text-muted">{t('payoutSummaryNote')}</p>
        {summary ? (
          <AdminTable label={t('payoutSummaryTitle')}>
            <table className={adminTableClass}>
              <caption className="sr-only">{t('payoutSummaryTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col" className={adminTh}>
                    {t('col_agent')}
                  </th>
                  <th scope="col" className={adminTh}>
                    {t('col_delivered')}
                  </th>
                  <th scope="col" className={adminTh}>
                    {t('col_paid')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.agentId}>
                    <th scope="row" className={`${adminTd} font-bold`} data-user-content>
                      {r.name}
                    </th>
                    <td className={`${adminTd} tabular-nums`}>{r.delivered}</td>
                    <td className={`${adminTd} tabular-nums`}>{formatPrice(r.paidPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
        ) : (
          <div className="skeleton h-24 rounded-card" aria-hidden="true" />
        )}
      </section>

      <RecordForm
        agents={agents}
        period={period}
        onSave={async (input) => {
          const r = await client.recordPayout(input);
          track('click', {
            id: r.ok ? 'admin_delivery_payout_recorded' : 'admin_delivery_payout_failed',
            path: window.location.pathname,
          });
          say(r.ok ? t('payoutSaved') : t('genericError', { code: r.code }), r.ok ? 'ok' : 'error');
          reload();
          return r.ok;
        }}
      />

      <section aria-labelledby="payout-list" className="space-y-2">
        <h3 id="payout-list" className="font-heading text-lg font-extrabold text-ink">
          {t('payoutsTitle')}
        </h3>
        {items?.length === 0 ? <EmptyState title={t('payoutsEmpty')} /> : null}
        {items && items.length > 0 ? (
          <AdminTable label={t('payoutsTitle')}>
            <table className={adminTableClass}>
              <caption className="sr-only">{t('payoutsTitle')}</caption>
              <thead>
                <tr>
                  {(
                    [
                      'col_date',
                      'col_agent',
                      'col_period',
                      'col_amount',
                      'col_method',
                      'col_reference',
                    ] as const
                  ).map((c) => (
                    <th key={c} scope="col" className={adminTh}>
                      {t(c)}
                    </th>
                  ))}
                  <th scope="col" className={adminTh}>
                    <span className="sr-only">{t('correct')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td className={adminTd}>{formatDate(p.createdAt, locale)}</td>
                    <th scope="row" className={`${adminTd} font-bold`} data-user-content>
                      {p.agentName || name(p.agentId)}
                    </th>
                    <td className={adminTd}>
                      {t('periodRange', {
                        from: formatDate(p.periodFrom, locale),
                        to: formatDate(p.periodTo, locale),
                      })}
                    </td>
                    <td className={`${adminTd} tabular-nums ${p.amountPaise < 0 ? 'text-error' : ''}`}>
                      {p.amountPaise < 0 ? `− ${formatPrice(-p.amountPaise)}` : formatPrice(p.amountPaise)}
                      {p.reversesId ? (
                        <div>
                          <StatusBadge tone="warning">{t('reversal')}</StatusBadge>
                        </div>
                      ) : null}
                    </td>
                    <td className={adminTd}>{t(`method_${p.method}`)}</td>
                    <td className={adminTd}>
                      {p.reference ? <span lang="en">{p.reference}</span> : '—'}
                      {p.note ? (
                        <span className="block text-xs text-muted" data-user-content>
                          {p.note}
                        </span>
                      ) : null}
                    </td>
                    <td className={adminTd}>
                      {p.corrected ? (
                        <StatusBadge tone="muted">{t('correctedBadge')}</StatusBadge>
                      ) : p.reversesId ? null : correcting === p.id ? (
                        <div className="grid gap-2">
                          <label htmlFor={`correct-note-${p.id}`} className="text-xs font-bold text-ink">
                            {t('correctWhy')}
                          </label>
                          <input
                            id={`correct-note-${p.id}`}
                            value={note}
                            maxLength={300}
                            onChange={(e) => {
                              setNote(e.target.value);
                            }}
                            className={portalField}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={portalPrimary}
                              onClick={() => void correct(p.id)}
                            >
                              {t('correct')}
                            </button>
                            <button
                              type="button"
                              data-panel-cancel={`correct-${p.id}`}
                              className={portalQuiet}
                              onClick={() => {
                                setCorrecting(null);
                              }}
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-disclosure-trigger={`correct-${p.id}`}
                          className={portalQuiet}
                          onClick={() => {
                            setCorrecting(p.id);
                            setNote('');
                          }}
                        >
                          {t('correct')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTable>
        ) : null}
      </section>
    </div>
  );
}

function RecordForm({
  agents,
  period,
  onSave,
}: {
  agents: AdminAgentRowView[];
  period: { from: string; to: string };
  onSave: (input: {
    agentId: string;
    amountPaise: number;
    periodFrom: string;
    periodTo: string;
    method: PayoutMethod;
    reference?: string;
    note?: string;
  }) => Promise<boolean>;
}) {
  const t = useTranslations('deliveryAdmin');
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const d = new FormData(form);
    const get = (k: string) => {
      const x = d.get(k);
      return typeof x === 'string' ? x.trim() : '';
    };
    const agentId = agents.find((a) => a.id === get('agent'))?.id;
    const amount = parseRupees(get('amount'));
    const method = PAYOUT_METHODS.find((m) => m === get('method'));
    const from = get('from');
    const to = get('to');
    const bad = !agentId
      ? ['pay-agent', t('payoutErrAgent')]
      : !amount.ok
        ? ['pay-amount', t('payoutErrAmount')]
        : !method
          ? ['pay-method', t('payoutErrMethod')]
          : !from || !to || from > to
            ? ['pay-from', t('payoutErrPeriod')]
            : null;
    if (bad || !agentId || !amount.ok || !method) {
      setProblem(bad?.[1] ?? null);
      if (bad) document.getElementById(bad[0] ?? '')?.focus();
      return;
    }
    setProblem(null);
    setBusy(true);
    const done = await onSave({
      agentId,
      amountPaise: amount.paise,
      periodFrom: from,
      periodTo: to,
      method,
      ...(get('reference') ? { reference: get('reference') } : {}),
      ...(get('note') ? { note: get('note') } : {}),
    });
    setBusy(false);
    if (done) {
      form.reset();
      setOpen(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        data-disclosure-trigger="record-payout"
        className={portalPrimary}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('recordPayout')}
      </button>
    );
  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-labelledby="record-payout-title"
      aria-busy={busy || undefined}
      className={`${adminCard} grid gap-3 tab:grid-cols-3`}
    >
      <h3 id="record-payout-title" className="font-heading text-lg font-extrabold text-ink tab:col-span-3">
        {t('recordPayout')}
      </h3>
      <div>
        <label htmlFor="pay-agent" className="text-sm font-bold text-ink">
          {t('col_agent')}
        </label>
        <select id="pay-agent" name="agent" defaultValue="" className={`${portalField} block`}>
          <option value="">{t('reasonChoose')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="pay-amount" className="text-sm font-bold text-ink">
          {t('amountRupees')}
        </label>
        <input id="pay-amount" name="amount" inputMode="decimal" autoComplete="off" className={portalField} />
      </div>
      <div>
        <label htmlFor="pay-method" className="text-sm font-bold text-ink">
          {t('col_method')}
        </label>
        <select id="pay-method" name="method" defaultValue="" className={`${portalField} block`}>
          <option value="">{t('reasonChoose')}</option>
          {PAYOUT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`method_${m}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="pay-from" className="text-sm font-bold text-ink">
          {t('periodFrom')}
        </label>
        <input
          id="pay-from"
          name="from"
          type="date"
          defaultValue={period.from}
          className={`${portalField} block`}
        />
      </div>
      <div>
        <label htmlFor="pay-to" className="text-sm font-bold text-ink">
          {t('periodTo')}
        </label>
        <input
          id="pay-to"
          name="to"
          type="date"
          defaultValue={period.to}
          className={`${portalField} block`}
        />
      </div>
      <div>
        <label htmlFor="pay-reference" className="text-sm font-bold text-ink">
          {t('referenceLabel')}
        </label>
        <input
          id="pay-reference"
          name="reference"
          maxLength={60}
          autoComplete="off"
          className={portalField}
        />
      </div>
      <div className="tab:col-span-3">
        <label htmlFor="pay-note" className="text-sm font-bold text-ink">
          {t('statusNote')}
        </label>
        <input id="pay-note" name="note" maxLength={300} className={portalField} />
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-bold text-error tab:col-span-3">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2 tab:col-span-3">
        <button type="submit" aria-disabled={busy || undefined} className={portalPrimary}>
          {t('savePayout')}
        </button>
        <button
          type="button"
          data-panel-cancel="record-payout"
          className={portalQuiet}
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
