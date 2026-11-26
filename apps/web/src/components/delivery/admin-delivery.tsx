'use client';

import {
  AGENT_DOCUMENT_REJECT_REASONS,
  AGENT_STATUS_REASONS,
  AGENT_VEHICLE_TYPES,
  DELIVERY_SWITCH_REASONS,
  DELIVERY_WITHDRAW_REASONS,
  SHOP_MODE_REJECT_REASONS,
  type AgentDocumentKind,
  type AgentDocumentRejectReason,
  type AgentStatus,
  type AgentStatusReason,
  type AgentVehicleType,
  type DeliverySwitchReason,
  type DeliveryWithdrawReason,
  type ShopModeRejectReason,
} from '@mechdost/shared/delivery/codes';
import { APPLICATION_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import { agentStatusMachine, AGENT_STATUSES } from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useNow } from '@/components/portal/use-now';
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
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { useAdminDeliveryClient, useLiveReload } from '@/lib/delivery/use-delivery-client';
import type {
  AdminAgentDetailView,
  AdminAgentRowView,
  AdminDeliveryClient,
  AdminJobDetailView,
  AdminJobRowView,
  AdminJobsView,
  AdminShopModeRequestView,
  AgentApplicationView,
  AgentInviteRowView,
  Result,
} from '@/lib/delivery/types';
import { countdown, kmText } from '@/lib/delivery/view';
import { PayoutsTab } from './admin-delivery-payouts';
import { useStatusLine } from './status-line';

const TABS = ['jobs', 'applications', 'agents', 'payouts', 'requests', 'settings'] as const;
type Tab = (typeof TABS)[number];
const VIEWS: readonly AdminJobsView[] = ['needs_agent', 'offered', 'active', 'failed', 'returning', 'done'];
const POLL_MS = 15_000;
/** A job waiting longer than this shows a "Late" chip (SLA). */
const LATE_MIN = 15;

/**
 * Admin → Delivery (spec 24, spec 08): the jobs queue (needs an agent / offered / on the road / failed / coming back /
 * done) with ranked agent suggestions and timers, applications and invites, agents (status with reason and history,
 * documents with an audited view, rating), shop delivery-mode requests and the per-city settings. One status line
 * per screen; every action is checked again by the API (`delivery_jobs:assign`, `delivery_agents:manage`).
 */
export function AdminDelivery() {
  const t = useTranslations('deliveryAdmin');
  const client = useAdminDeliveryClient();
  const [tab, setTab] = useState<Tab>('jobs');
  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('sectionLabel')} className="flex flex-wrap gap-2">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            className={tab === k ? portalPrimary : portalQuiet}
            onClick={() => {
              setTab(k);
              track('click', { id: `admin_delivery_tab_${k}`, path: window.location.pathname });
            }}
          >
            {t(`tab_${k}`)}
          </button>
        ))}
      </div>
      {client?.sample ? <p className="text-xs text-muted">{t('sample')}</p> : null}
      {!client ? <div className="skeleton h-64 rounded-card" aria-hidden="true" /> : null}
      {client && tab === 'jobs' ? <JobsTab client={client} /> : null}
      {client && tab === 'applications' ? <ApplicationsTab client={client} /> : null}
      {client && tab === 'agents' ? <AgentsTab client={client} /> : null}
      {client && tab === 'payouts' ? <PayoutsHost client={client} /> : null}
      {client && tab === 'requests' ? <RequestsTab client={client} /> : null}
      {client && tab === 'settings' ? <SettingsTab /> : null}
    </div>
  );
}

/** Loads one list; reloads on demo changes or every `POLL_MS` on the API. */
function useList<T>(client: AdminDeliveryClient, load: () => Promise<Result<{ items: T[] }>>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    void load().then((r) => {
      if (r.ok) {
        setItems(r.data.items);
        setFailed(false);
      } else setFailed(true);
    });
  }, [load]);
  useLiveReload(client, reload, POLL_MS);
  return { items, failed, reload };
}

function ListState({ failed, loading, onRetry }: { failed: boolean; loading: boolean; onRetry: () => void }) {
  const t = useTranslations('deliveryAdmin');
  if (failed)
    return (
      <div role="alert" className={`${adminCard} text-sm`}>
        <p>{t('loadError')}</p>
        <button type="button" onClick={onRetry} className={`${portalQuiet} mt-2`}>
          {t('retry')}
        </button>
      </div>
    );
  return loading ? <div className="skeleton h-40 rounded-card" aria-hidden="true" /> : null;
}

function useErr() {
  const t = useTranslations('deliveryAdmin');
  const e = useTranslations('delivery.errors');
  return (code: string) => {
    try {
      return e(code as 'JOB_CHANGED', { attemptsLeft: 0 });
    } catch {
      return t('genericError', { code });
    }
  };
}

/** A reason select (codes; rule 16) used by the admin forms. */
function ReasonSelect<C extends string>({
  id,
  label,
  codes,
  text,
  value,
  onChange,
}: {
  id: string;
  label: string;
  codes: readonly C[];
  text: (c: C) => string;
  value: C | '';
  onChange: (c: C | '') => void;
}) {
  const t = useTranslations('deliveryAdmin');
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(codes.find((c) => c === e.target.value) ?? '');
        }}
        className={`${portalField} block`}
      >
        <option value="">{t('reasonChoose')}</option>
        {codes.map((c) => (
          <option key={c} value={c}>
            {text(c)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── jobs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function JobsTab({ client }: { client: AdminDeliveryClient }) {
  const t = useTranslations('deliveryAdmin');
  const s = useTranslations('delivery.jobStatus');
  const l = useTranslations('delivery.loadClass');
  const [view, setView] = useState<AdminJobsView>('needs_agent');
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(1000);
  const load = useCallback(() => client.jobs(view, null), [client, view]);
  const { items, failed, reload } = useList<AdminJobRowView>(client, load);
  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('viewsLabel')} className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            className={view === v ? portalPrimary : portalQuiet}
            onClick={() => {
              setView(v);
              setOpen(null);
            }}
          >
            {t(`view_${v}`)}
          </button>
        ))}
      </div>
      <ListState failed={failed && !items} loading={!items && !failed} onRetry={reload} />
      {items?.length === 0 ? (
        <EmptyState
          title={t(`empty_${view}`)}
          action={
            view === 'needs_agent' ? (
              <LocalLink href="/admin/orders" className={portalQuiet}>
                {t('emptyAction')}
              </LocalLink>
            ) : undefined
          }
        />
      ) : null}
      {items && items.length > 0 ? (
        <AdminTable label={t(`view_${view}`)}>
          <table className={adminTableClass}>
            <caption className="sr-only">{t(`view_${view}`)}</caption>
            <thead>
              <tr>
                <th scope="col" className={adminTh}>
                  {t('col_order')}
                </th>
                <th scope="col" className={adminTh}>
                  {t('col_shop')}
                </th>
                <th scope="col" className={adminTh}>
                  {t('col_pin')}
                </th>
                <th scope="col" className={adminTh}>
                  {t('col_agent')}
                </th>
                <th scope="col" className={adminTh}>
                  {t('col_load')}
                </th>
                <th scope="col" className={adminTh}>
                  {t('col_waiting')}
                </th>
                <th scope="col" className={adminTh}>
                  <span className="sr-only">{t('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => {
                const left = countdown(j.offerExpiresAt, now);
                return (
                  <tr key={j.jobId}>
                    <th scope="row" className={`${adminTd} font-bold`}>
                      {j.orderCode}
                      <div className="mt-1">
                        <StatusBadge code={j.status}>{s(j.status)}</StatusBadge>
                      </div>
                    </th>
                    <td className={adminTd}>{j.shopName}</td>
                    <td className={`${adminTd} tabular-nums`}>{j.customerPincode}</td>
                    <td className={adminTd}>
                      {j.agent ? <span data-user-content>{j.agent.name}</span> : t('noAgent')}
                      {left ? (
                        <div className="text-xs text-muted tabular-nums">
                          {t('offerEnds', { time: left.text })}
                        </div>
                      ) : null}
                    </td>
                    <td className={adminTd}>{l(j.loadClass)}</td>
                    <td className={`${adminTd} tabular-nums`}>
                      {t('waiting', { min: j.waitingMin })}{' '}
                      {j.waitingMin >= LATE_MIN && view !== 'done' ? (
                        <StatusBadge tone="warning">{t('late')}</StatusBadge>
                      ) : null}
                    </td>
                    <td className={adminTd}>
                      <button
                        type="button"
                        aria-expanded={open === j.jobId}
                        aria-controls={`job-${j.jobId}`}
                        onClick={() => {
                          setOpen(open === j.jobId ? null : j.jobId);
                        }}
                        className={portalQuiet}
                      >
                        {open === j.jobId ? t('close') : t('open')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTable>
      ) : null}
      {open ? <JobDetail key={open} client={client} jobId={open} onChanged={reload} /> : null}
    </div>
  );
}

function JobDetail({
  client,
  jobId,
  onChanged,
}: {
  client: AdminDeliveryClient;
  jobId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryAdmin');
  const v = useTranslations('delivery.vehicle');
  const fr = useTranslations('delivery.failReason');
  const wr = useTranslations('delivery.withdrawReason');
  const sr = useTranslations('delivery.switchReason');
  const err = useErr();
  const [job, setJob] = useState<AdminJobDetailView | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  const reload = useCallback(() => {
    void client.job(jobId).then((r) => {
      if (r.ok) setJob(r.data);
    });
  }, [client, jobId]);
  useLiveReload(client, reload, POLL_MS);

  async function act(id: string, run: () => Promise<Result<null>>, okText: string) {
    if (busy) return;
    setBusy(true);
    const res = await run();
    setBusy(false);
    track('click', { id: res.ok ? id : `${id}_failed`, path: window.location.pathname });
    if (res.ok) say(okText);
    else say(err(res.code), 'error');
    reload();
    onChanged();
  }

  if (!job) return <div className="skeleton h-48 rounded-card" aria-hidden="true" />;
  const v2 = job.version;
  return (
    <section
      id={`job-${jobId}`}
      aria-labelledby={`job-${jobId}-title`}
      className={adminCard}
      aria-busy={busy || undefined}
    >
      <h3 id={`job-${jobId}-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('jobTitle', { code: job.orderCode })}
      </h3>
      <p className="text-sm text-muted">{t('attempt', { n: job.attempt })}</p>
      <div className="mt-2">{line}</div>

      {job.status === 'needs_agent' ? (
        <div className="mt-3">
          <h4 className="text-sm font-bold text-ink">{t('suggestions')}</h4>
          {job.suggestions.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{t('noSuggestions')}</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {job.suggestions.map((a) => (
                <li
                  key={a.agentId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-button border border-line p-3"
                >
                  <span>
                    <span className="block font-bold text-ink" data-user-content>
                      {a.name}
                    </span>
                    <span className="block text-sm text-muted">
                      {t('suggestionMeta', {
                        vehicle: v(a.vehicleType),
                        jobs: a.activeJobs,
                        distance:
                          a.distanceM === null ? t('distanceUnknown') : t('km', { km: kmText(a.distanceM) }),
                      })}
                      {a.acceptanceRateBp !== null
                        ? ` · ${t('acceptance', { pct: Math.round(a.acceptanceRateBp / 100) })}`
                        : ''}
                    </span>
                    {a.carriesLoad ? null : (
                      <span className="block text-sm font-bold text-warning">{t('cannotCarry')}</span>
                    )}
                  </span>
                  {a.carriesLoad ? (
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          'admin_delivery_offered',
                          () => client.offer(jobId, a.agentId, v2),
                          t('offered', { name: a.name }),
                        )
                      }
                      className={portalPrimary}
                    >
                      {t('offerTo', { name: a.name })}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <SwitchForm
            orderCode={job.orderCode}
            reasons={DELIVERY_SWITCH_REASONS}
            text={(c) => sr(c)}
            onSend={(r, note) =>
              void act(
                'admin_delivery_switch_to_shop',
                () => client.switchToShop(job.orderCode, r, note),
                t('switchSent'),
              )
            }
          />
        </div>
      ) : null}

      {job.status === 'offered' || job.status === 'accepted' ? (
        <WithdrawForm
          jobId={jobId}
          reasons={DELIVERY_WITHDRAW_REASONS}
          text={(c) => wr(c)}
          onSend={(r) =>
            void act('admin_delivery_withdrawn', () => client.withdraw(jobId, r, v2), t('withdrawn'))
          }
        />
      ) : null}

      {job.status === 'failed' ? (
        <div className="mt-3 rounded-button bg-warning-bg p-3">
          <p className="font-bold text-warning">
            {job.failReason ? t('failedWhy', { reason: fr(job.failReason) }) : null}
          </p>
          <h4 className="mt-2 text-sm font-bold text-ink">{t('decideTitle')}</h4>
          {job.retryAllowed === false ? <p className="text-sm text-ink">{t('retryLimitNote')}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {job.retryAllowed === false ? null : (
              <>
                <button
                  type="button"
                  className={portalQuiet}
                  onClick={() =>
                    void act(
                      'admin_delivery_retry_same',
                      () => client.failureDecision(jobId, 'retry', 'same', v2),
                      t('decisionSaved'),
                    )
                  }
                >
                  {t('retrySame')}
                </button>
                <button
                  type="button"
                  className={portalQuiet}
                  onClick={() =>
                    void act(
                      'admin_delivery_retry_other',
                      () => client.failureDecision(jobId, 'retry', 'other', v2),
                      t('decisionSaved'),
                    )
                  }
                >
                  {t('retryOther')}
                </button>
              </>
            )}
            <button
              type="button"
              className={portalPrimary}
              onClick={() =>
                void act(
                  'admin_delivery_return_to_shop',
                  () => client.failureDecision(jobId, 'return_to_shop', undefined, v2),
                  t('decisionSaved'),
                )
              }
            >
              {t('returnToShop')}
            </button>
          </div>
        </div>
      ) : null}

      {(job.status === 'accepted' && job.pickupLocked) ||
      (job.status === 'picked_up' && job.deliveryLocked) ||
      job.status === 'returning' ? (
        <OverrideForm
          kind={job.status === 'accepted' ? 'pickup' : job.status === 'picked_up' ? 'delivery' : 'return'}
          onSend={(kind, reason) =>
            void act(
              `admin_delivery_override_${kind}`,
              () => client.override(jobId, kind, reason, v2),
              t('overrideDone'),
            )
          }
        />
      ) : null}

      <JobTimeline job={job} />
    </section>
  );
}

function SwitchForm({
  orderCode,
  reasons,
  text,
  onSend,
}: {
  orderCode: string;
  reasons: readonly DeliverySwitchReason[];
  text: (c: DeliverySwitchReason) => string;
  onSend: (r: DeliverySwitchReason, note?: string) => void;
}) {
  const t = useTranslations('deliveryAdmin');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeliverySwitchReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = `switch-${orderCode}`;
  if (!open)
    return (
      <button
        type="button"
        data-disclosure-trigger={id}
        onClick={() => {
          setOpen(true);
        }}
        className={`${portalQuiet} mt-3`}
      >
        {t('switchToShop')}
      </button>
    );
  return (
    <form
      noValidate
      className="mt-3 grid gap-2 rounded-button border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason === '') {
          setProblem(t('reasonRequired'));
          return;
        }
        if (reason === 'other' && note.trim() === '') {
          setProblem(t('noteRequired'));
          return;
        }
        setProblem(null);
        onSend(reason, note.trim() || undefined);
        setOpen(false);
      }}
    >
      <ReasonSelect
        id={`${id}-reason`}
        label={t('switchWhy')}
        codes={reasons}
        text={text}
        value={reason}
        onChange={setReason}
      />
      {reason === 'other' ? <NoteField id={`${id}-note`} value={note} onChange={setNote} /> : null}
      {problem ? (
        <p role="alert" className="text-sm font-bold text-error">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={portalPrimary}>
          {t('switchSend')}
        </button>
        <button
          type="button"
          data-panel-cancel={id}
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function NoteField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('deliveryAdmin');
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {t('note')}
      </label>
      <input
        id={id}
        value={value}
        maxLength={300}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={portalField}
      />
    </div>
  );
}

function WithdrawForm({
  jobId,
  reasons,
  text,
  onSend,
}: {
  jobId: string;
  reasons: readonly DeliveryWithdrawReason[];
  text: (c: DeliveryWithdrawReason) => string;
  onSend: (r: DeliveryWithdrawReason) => void;
}) {
  const t = useTranslations('deliveryAdmin');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeliveryWithdrawReason | ''>('');
  const [problem, setProblem] = useState(false);
  const id = `withdraw-${jobId}`;
  if (!open)
    return (
      <button
        type="button"
        data-disclosure-trigger={id}
        onClick={() => {
          setOpen(true);
        }}
        className={`${portalQuiet} mt-3`}
      >
        {t('withdraw')}
      </button>
    );
  return (
    <form
      noValidate
      className="mt-3 grid gap-2 rounded-button border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason === '') {
          setProblem(true);
          return;
        }
        onSend(reason);
        setOpen(false);
      }}
    >
      <ReasonSelect
        id={`${id}-reason`}
        label={t('withdrawWhy')}
        codes={reasons}
        text={text}
        value={reason}
        onChange={setReason}
      />
      {problem ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('reasonRequired')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={portalPrimary}>
          {t('withdraw')}
        </button>
        <button
          type="button"
          data-panel-cancel={id}
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function OverrideForm({
  kind,
  onSend,
}: {
  kind: 'pickup' | 'delivery' | 'return';
  onSend: (kind: 'pickup' | 'delivery' | 'return', reason: string) => void;
}) {
  const t = useTranslations('deliveryAdmin');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(false);
  return (
    <form
      noValidate
      className="mt-3 grid gap-2 rounded-button border border-line p-3"
      onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (reason.trim().length < 5) {
          setProblem(true);
          return;
        }
        setProblem(false);
        onSend(kind, reason.trim());
      }}
    >
      <h4 className="text-sm font-bold text-ink">{t('overrideTitle')}</h4>
      <label htmlFor={`override-${kind}`} className="text-sm text-ink">
        {t('overrideReason')}
      </label>
      <input
        id={`override-${kind}`}
        value={reason}
        maxLength={300}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `override-${kind}-error` : undefined}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        className={portalField}
      />
      {problem ? (
        <p id={`override-${kind}-error`} className="text-sm font-bold text-error">
          {t('overrideReasonError')}
        </p>
      ) : null}
      <button type="submit" className={`${portalPrimary} w-fit`}>
        {t(`override_${kind}`)}
      </button>
    </form>
  );
}

const EVENT_KINDS = [
  'ready_for_pickup',
  'offered',
  'accepted',
  'declined',
  'offer_expired',
  'withdrawn',
  'given_up',
  'picked_up',
  'delivered',
  'failed',
  'retry_same_agent',
  'retry_other_agent',
  'return_to_shop',
  'returned',
  'retry_opened',
  'switched_to_shop',
  'pickup_override',
  'delivery_override',
] as const;
const ACTORS = ['delivery_agent', 'shop', 'admin', 'system'] as const;

/** The job's append-only events, offers and photos, oldest first (also on Admin → Orders → order detail). */
export function JobTimeline({ job }: { job: AdminJobDetailView }) {
  const t = useTranslations('deliveryAdmin');
  const os = useTranslations('delivery.offerStatus');
  const locale = useLocale();
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));
  return (
    <div className="mt-4 grid gap-3 tab:grid-cols-2">
      <div>
        <h4 className="text-sm font-bold text-ink">{t('timeline')}</h4>
        <ol className="mt-1 grid gap-1 border-l-2 border-line pl-3 text-sm">
          {job.events.map((e, i) => {
            const kind = EVENT_KINDS.find((k) => k === e.kind);
            const actor = ACTORS.find((a) => a === e.actorType);
            return (
              <li key={`${e.at}-${String(i)}`} className="text-ink">
                <span className="font-bold">{kind ? t(`ev_${kind}`) : t('ev_other')}</span>
                {actor ? ` · ${t(`actor_${actor}`)}` : ''}
                <span className="block text-xs text-muted">{when(e.at)}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="grid content-start gap-3">
        {job.offers.length > 0 ? (
          <div>
            <h4 className="text-sm font-bold text-ink">{t('offersTitle')}</h4>
            <ul className="mt-1 grid gap-1 text-sm">
              {job.offers.map((o) => (
                <li key={o.id} className="text-ink">
                  <span data-user-content>{o.agentName}</span> · {os(o.status)}
                  <span className="block text-xs text-muted">{when(o.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {job.photos.length > 0 ? (
          <div>
            <h4 className="text-sm font-bold text-ink">{t('photos')}</h4>
            <ul className="mt-1 grid gap-1 text-sm">
              {job.photos.map((p) => (
                <li key={`${p.purpose}-${p.at}`} className="text-ink">
                  {t(`photo_${p.purpose}`)} · {when(p.at)}{' '}
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                      {t('open')}
                    </a>
                  ) : (
                    <span className="text-xs text-muted">{t('photoNotStored')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Admin → Orders → one order: the delivery jobs of that sub-order and their timelines (spec 24). */
export function OrderDeliveryTimeline({ orderCode }: { orderCode: string }) {
  const t = useTranslations('deliveryAdmin');
  const client = useAdminDeliveryClient();
  const [jobs, setJobs] = useState<AdminJobDetailView[] | null>(null);
  const reload = useCallback(() => {
    if (!client) return;
    void client.jobsForOrder(orderCode).then((r) => {
      if (r.ok) setJobs(r.data);
    });
  }, [client, orderCode]);
  useLiveReload(client, reload, 30_000);
  if (!jobs || jobs.length === 0) return null;
  return (
    <section aria-label={t('timeline')} className="mt-3 rounded-button border border-line p-3">
      {jobs.map((j) => (
        <div key={j.jobId}>
          <p className="text-sm font-bold text-ink">{t('attempt', { n: j.attempt })}</p>
          <JobTimeline job={j} />
        </div>
      ))}
    </section>
  );
}

// ── applications + invites ───────────────────────────────────────────────────────────────────────────────────────

function ApplicationsTab({ client }: { client: AdminDeliveryClient }) {
  const t = useTranslations('deliveryAdmin');
  const p = useTranslations('portal');
  const v = useTranslations('delivery.vehicle');
  const locale = useLocale();
  const err = useErr();
  const { say, line } = useStatusLine();
  const [link, setLink] = useState<{ url: string; until: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof APPLICATION_REJECT_REASONS)[number] | ''>('');
  const loadApps = useCallback(() => client.applications(null), [client]);
  const loadInvites = useCallback(() => client.invites(null), [client]);
  const apps = useList<AgentApplicationView>(client, loadApps);
  const invites = useList<AgentInviteRowView>(client, loadInvites);

  function showLink(token: string, expiresAt: string) {
    const prefix = locale === 'hi' ? '/hi' : '';
    setLink({
      url: `${window.location.origin}${prefix}/partners/delivery-invite/${token}`,
      until: formatDate(expiresAt, locale),
    });
  }

  async function invite(code: string) {
    const res = await client.invite({ applicationCode: code });
    track('click', {
      id: res.ok ? 'admin_delivery_invited' : 'admin_delivery_invite_failed',
      path: window.location.pathname,
    });
    if (res.ok) showLink(res.data.token, res.data.expiresAt);
    else say(err(res.code), 'error');
    apps.reload();
    invites.reload();
  }
  async function reject(code: string) {
    if (reason === '') {
      say(t('reasonRequired'), 'error');
      return;
    }
    const res = await client.rejectApplication(code, reason);
    track('click', { id: 'admin_delivery_application_rejected', path: window.location.pathname });
    if (res.ok) {
      say(t('rejected'));
      setRejecting(null);
    } else say(err(res.code), 'error');
    apps.reload();
  }

  const pending = (apps.items ?? []).filter((a) => a.status === 'new' || a.status === 'in_review');
  return (
    <div className="space-y-4">
      {line}
      {link ? (
        <div role="status" className={`${adminCard} border-success`}>
          <p className="text-sm text-ink">{t('inviteSent', { date: link.until })}</p>
          <p className="mt-1 break-all text-sm font-bold text-ink" lang="en">
            {link.url}
          </p>
          <button
            type="button"
            className={`${portalQuiet} mt-2`}
            onClick={() => {
              void navigator.clipboard.writeText(link.url).then(() => {
                say(t('copied'));
              });
            }}
          >
            {t('copyLink')}
          </button>
        </div>
      ) : null}
      <section aria-labelledby="da-apps" className="space-y-2">
        <h3 id="da-apps" className="font-heading text-lg font-extrabold text-ink">
          {t('appsTitle')}
        </h3>
        <ListState
          failed={apps.failed && !apps.items}
          loading={!apps.items && !apps.failed}
          onRetry={apps.reload}
        />
        {apps.items && pending.length === 0 ? <EmptyState title={t('appsEmpty')} /> : null}
        <ul className="grid gap-2">
          {pending.map((a) => (
            <li key={a.code} className={adminCard}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-ink" data-user-content>
                    {a.name}
                  </p>
                  <p className="text-sm text-muted">
                    {a.code}
                    {a.vehicleType ? ` · ${v(a.vehicleType)}` : ''} · {formatDate(a.createdAt, locale)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={portalPrimary} onClick={() => void invite(a.code)}>
                    {t('invite')}
                  </button>
                  <button
                    type="button"
                    data-disclosure-trigger={`reject-${a.code}`}
                    className={portalQuiet}
                    onClick={() => {
                      setRejecting(a.code);
                      setReason('');
                    }}
                  >
                    {t('reject')}
                  </button>
                </div>
              </div>
              {rejecting === a.code ? (
                <div className="mt-3 grid gap-2">
                  <ReasonSelect
                    id={`reject-${a.code}`}
                    label={t('rejectWhy')}
                    codes={APPLICATION_REJECT_REASONS}
                    text={(c) => p(`appReject_${c}`)}
                    value={reason}
                    onChange={setReason}
                  />
                  <div className="flex gap-2">
                    <button type="button" className={portalPrimary} onClick={() => void reject(a.code)}>
                      {t('reject')}
                    </button>
                    <button
                      type="button"
                      data-panel-cancel={`reject-${a.code}`}
                      className={portalQuiet}
                      onClick={() => {
                        setRejecting(null);
                      }}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <InviteNew
        onInvite={async (input) => {
          const res = await client.invite(input);
          track('click', {
            id: res.ok ? 'admin_delivery_invited_direct' : 'admin_delivery_invite_failed',
            path: window.location.pathname,
          });
          if (res.ok) showLink(res.data.token, res.data.expiresAt);
          else say(err(res.code), 'error');
          invites.reload();
          return res.ok;
        }}
      />
      <section aria-labelledby="da-invites" className="space-y-2">
        <h3 id="da-invites" className="font-heading text-lg font-extrabold text-ink">
          {t('invitesTitle')}
        </h3>
        {invites.items?.length === 0 ? <EmptyState title={t('invitesEmpty')} /> : null}
        <ul className="grid gap-2">
          {(invites.items ?? []).map((i) => (
            <li key={i.id} className={`${adminCard} flex flex-wrap items-center justify-between gap-2`}>
              <span>
                <span className="block font-bold text-ink" data-user-content>
                  {i.name}
                </span>
                <span className="block text-sm text-muted">
                  {t('inviteMeta', { last4: i.phoneLast4, date: formatDate(i.expiresAt, locale) })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge code={i.status}>{t(`inviteStatus_${i.status}`)}</StatusBadge>
                {i.status === 'sent' ? (
                  <button
                    type="button"
                    className={portalQuiet}
                    onClick={() =>
                      void client.revokeInvite(i.id).then((r) => {
                        track('click', {
                          id: 'admin_delivery_invite_revoked',
                          path: window.location.pathname,
                        });
                        say(r.ok ? t('revoked') : err(r.code), r.ok ? 'ok' : 'error');
                        invites.reload();
                      })
                    }
                  >
                    {t('revoke')}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function InviteNew({
  onInvite,
}: {
  onInvite: (input: {
    name: string;
    phone: string;
    email?: string;
    cityCode: string;
    vehicleType: AgentVehicleType;
  }) => Promise<boolean>;
}) {
  const t = useTranslations('deliveryAdmin');
  const a = useTranslations('deliveryApply');
  const v = useTranslations('delivery.vehicle');
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!open)
    return (
      <button
        type="button"
        data-disclosure-trigger="invite-new"
        className={portalQuiet}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('inviteNewOpen')}
      </button>
    );
  return (
    <form
      noValidate
      className={`${adminCard} grid gap-3 tab:grid-cols-2`}
      aria-labelledby="invite-new-title"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const get = (k: string) => {
          const x = d.get(k);
          return typeof x === 'string' ? x.trim() : '';
        };
        const phone = get('phone')
          .replace(/\D/g, '')
          .replace(/^91(?=\d{10}$)/, '');
        const vehicle = AGENT_VEHICLE_TYPES.find((x) => x === get('vehicle'));
        if (get('name').length < 2) {
          setProblem(a('errName'));
          return;
        }
        if (!/^[6-9]\d{9}$/.test(phone)) {
          setProblem(a('errPhone'));
          return;
        }
        if (!vehicle) {
          setProblem(a('errVehicle'));
          return;
        }
        setProblem(null);
        void onInvite({
          name: get('name'),
          phone,
          ...(get('email') ? { email: get('email') } : {}),
          cityCode: get('city') || 'RPR',
          vehicleType: vehicle,
        }).then((done) => {
          if (done) setOpen(false);
        });
      }}
    >
      <h3 id="invite-new-title" className="font-heading text-lg font-extrabold text-ink tab:col-span-2">
        {t('inviteNewTitle')}
      </h3>
      <Field id="inv-name" label={t('fieldName')}>
        <input id="inv-name" name="name" maxLength={80} autoComplete="off" className={portalField} />
      </Field>
      <Field id="inv-phone" label={t('fieldPhone')}>
        <input
          id="inv-phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          maxLength={14}
          className={portalField}
        />
      </Field>
      <Field id="inv-email" label={t('fieldEmail')}>
        <input id="inv-email" name="email" type="email" maxLength={120} className={portalField} />
      </Field>
      <Field id="inv-city" label={t('fieldCity')}>
        <select id="inv-city" name="city" className={`${portalField} block`} defaultValue="RPR">
          <option value="RPR">{a('city_RPR')}</option>
        </select>
      </Field>
      <Field id="inv-vehicle" label={t('fieldVehicle')}>
        <select id="inv-vehicle" name="vehicle" className={`${portalField} block`} defaultValue="">
          <option value="">{t('reasonChoose')}</option>
          {AGENT_VEHICLE_TYPES.map((x) => (
            <option key={x} value={x}>
              {v(x)}
            </option>
          ))}
        </select>
      </Field>
      {problem ? (
        <p role="alert" className="text-sm font-bold text-error tab:col-span-2">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2 tab:col-span-2">
        <button type="submit" className={portalPrimary}>
          {t('sendInvite')}
        </button>
        <button
          type="button"
          data-panel-cancel="invite-new"
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

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── agents ───────────────────────────────────────────────────────────────────────────────────────────────────────

function AgentsTab({ client }: { client: AdminDeliveryClient }) {
  const t = useTranslations('deliveryAdmin');
  const st = useTranslations('delivery.agentStatus');
  const v = useTranslations('delivery.vehicle');
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => client.agents(null), [client]);
  const { items, failed, reload } = useList<AdminAgentRowView>(client, load);
  const shown = (items ?? []).filter((a) => filter === 'all' || a.status === filter);
  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <label htmlFor="agent-filter" className="text-sm font-bold text-ink">
          {t('filterStatus')}
        </label>
        <select
          id="agent-filter"
          value={filter}
          onChange={(e) => {
            setFilter(AGENT_STATUSES.find((s) => s === e.target.value) ?? 'all');
          }}
          className={`${portalField} block`}
        >
          <option value="all">{t('filterAll')}</option>
          {AGENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {st(s)}
            </option>
          ))}
        </select>
      </div>
      <ListState failed={failed && !items} loading={!items && !failed} onRetry={reload} />
      {items && shown.length === 0 ? <EmptyState title={t('agentsEmpty')} /> : null}
      {shown.length > 0 ? (
        <AdminTable label={t('agentsTitle')}>
          <table className={adminTableClass}>
            <caption className="sr-only">{t('agentsTitle')}</caption>
            <thead>
              <tr>
                {(
                  [
                    'col_name',
                    'col_phone',
                    'col_vehicle',
                    'col_status',
                    'col_online',
                    'col_jobs',
                    'col_docs',
                    'col_rating',
                  ] as const
                ).map((c) => (
                  <th key={c} scope="col" className={adminTh}>
                    {t(c)}
                  </th>
                ))}
                <th scope="col" className={adminTh}>
                  <span className="sr-only">{t('open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className={`${adminTd} font-bold`} data-user-content>
                    {a.name}
                  </th>
                  <td className={`${adminTd} tabular-nums`}>{a.phoneMasked}</td>
                  <td className={adminTd}>{v(a.vehicleType)}</td>
                  <td className={adminTd}>
                    <StatusBadge code={a.status}>{st(a.status)}</StatusBadge>
                  </td>
                  <td className={adminTd}>{a.online ? t('online') : t('offline')}</td>
                  <td className={`${adminTd} tabular-nums`}>{a.activeJobs}</td>
                  <td className={adminTd}>{t('docsCount', { n: a.documentsVerified })}</td>
                  <td className={adminTd}>
                    <RatingText avg={a.ratingAvg ?? null} count={a.ratingCount ?? 0} />
                  </td>
                  <td className={adminTd}>
                    <button
                      type="button"
                      aria-expanded={open === a.id}
                      aria-controls={`agent-${a.id}`}
                      className={portalQuiet}
                      onClick={() => {
                        setOpen(open === a.id ? null : a.id);
                      }}
                    >
                      {open === a.id ? t('close') : t('open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTable>
      ) : null}
      {open ? <AgentDetail key={open} client={client} id={open} onChanged={reload} /> : null}
    </div>
  );
}

function RatingText({ avg, count }: { avg: number | null; count: number }) {
  const t = useTranslations('deliveryAdmin');
  if (avg === null || count === 0) return <span className="text-muted">{t('noRating')}</span>;
  return (
    <span aria-label={t('ratingLabel', { avg: avg.toFixed(1), count })}>
      <span aria-hidden="true">★ </span>
      {t('rating', { avg: avg.toFixed(1), count })}
    </span>
  );
}

function AgentDetail({
  client,
  id,
  onChanged,
}: {
  client: AdminDeliveryClient;
  id: string;
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryAdmin');
  const st = useTranslations('delivery.agentStatus');
  const sr = useTranslations('delivery.agentStatusReason');
  const v = useTranslations('delivery.vehicle');
  const locale = useLocale();
  const err = useErr();
  const { say, line } = useStatusLine();
  const [agent, setAgent] = useState<AdminAgentDetailView | null>(null);
  const [to, setTo] = useState<AgentStatus | ''>('');
  const [reason, setReason] = useState<AgentStatusReason | ''>('');
  const [note, setNote] = useState('');
  const [vehicle, setVehicle] = useState<AgentVehicleType | ''>('');
  const reload = useCallback(() => {
    void client.agent(id).then((r) => {
      if (r.ok) setAgent(r.data);
    });
  }, [client, id]);
  useLiveReload(client, reload, POLL_MS);
  if (!agent) return <div className="skeleton h-48 rounded-card" aria-hidden="true" />;
  const a = agent;
  // The picker starts on the stored vehicle until staff choose another one.
  const shownVehicle = vehicle === '' ? a.vehicleType : vehicle;
  const nextStatuses = AGENT_STATUSES.filter((s) => agentStatusMachine.can(a.status, s));

  async function changeStatus(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (to === '') {
      say(t('reasonRequired'), 'error');
      return;
    }
    if (to !== 'active' && reason === '') {
      say(t('reasonRequired'), 'error');
      return;
    }
    const res = await client.setStatus(id, to, a.version, reason || undefined, note.trim() || undefined);
    track('click', {
      id: res.ok ? `admin_agent_status_${to}` : 'admin_agent_status_failed',
      path: window.location.pathname,
    });
    if (res.ok) {
      say(t('statusSaved'));
      setTo('');
      setReason('');
      setNote('');
    } else say(res.code === 'DOCUMENTS_NOT_VERIFIED' ? t('statusDocsNeeded') : err(res.code), 'error');
    reload();
    onChanged();
  }

  return (
    <section id={`agent-${id}`} aria-labelledby={`agent-${id}-title`} className={adminCard}>
      <h3 id={`agent-${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        <span data-user-content>{t('agentTitle', { name: a.name })}</span>
      </h3>
      <p className="text-sm text-muted">
        {st(a.status)}
        {a.statusReason ? ` · ${sr(a.statusReason)}` : ''} ·{' '}
        <RatingText avg={a.ratingAvg ?? null} count={a.ratingCount ?? 0} />
      </p>
      <div className="mt-2">{line}</div>

      <dl className="mt-3 grid grid-cols-2 gap-2 tab:grid-cols-4">
        {(
          [
            ['kpi_offers', a.kpis.offers30d],
            ['kpi_accepted', a.kpis.accepted30d],
            ['kpi_delivered', a.kpis.delivered30d],
            ['kpi_failed', a.kpis.failed30d],
          ] as const
        ).map(([k, n]) => (
          <div key={k} className="rounded-button bg-pill p-2">
            <dt className="text-xs text-muted">{t(k)}</dt>
            <dd className="font-heading text-xl font-extrabold text-ink tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-muted">{t('kpis')}</p>

      <h4 className="mt-4 text-sm font-bold text-ink">{t('documents')}</h4>
      <ul className="mt-1 grid gap-2">
        {(['pan', 'driving_licence', 'vehicle_rc'] as const).map((kind) => (
          <li key={kind}>
            <DocumentReview
              client={client}
              agentId={id}
              kind={kind}
              doc={a.documents.find((d) => d.kind === kind) ?? null}
              onChanged={reload}
            />
          </li>
        ))}
      </ul>

      <form
        noValidate
        onSubmit={(e) => void changeStatus(e)}
        className="mt-4 grid gap-2 rounded-button border border-line p-3 tab:grid-cols-3"
      >
        <h4 className="text-sm font-bold text-ink tab:col-span-3">{t('statusTitle')}</h4>
        <div>
          <label htmlFor={`to-${id}`} className="text-sm font-bold text-ink">
            {t('statusTo')}
          </label>
          <select
            id={`to-${id}`}
            value={to}
            onChange={(e) => {
              setTo(nextStatuses.find((s) => s === e.target.value) ?? '');
            }}
            className={`${portalField} block`}
          >
            <option value="">{t('reasonChoose')}</option>
            {nextStatuses.map((s) => (
              <option key={s} value={s}>
                {st(s)}
              </option>
            ))}
          </select>
        </div>
        {to !== '' && to !== 'active' ? (
          <ReasonSelect
            id={`why-${id}`}
            label={t('statusWhy')}
            codes={AGENT_STATUS_REASONS}
            text={(c) => sr(c)}
            value={reason}
            onChange={setReason}
          />
        ) : null}
        <div>
          <label htmlFor={`note-${id}`} className="text-sm font-bold text-ink">
            {t('statusNote')}
          </label>
          <input
            id={`note-${id}`}
            value={note}
            maxLength={300}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            className={portalField}
          />
        </div>
        <button type="submit" className={`${portalPrimary} w-fit tab:col-span-3`}>
          {t('statusSave')}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`veh-${id}`} className="text-sm font-bold text-ink">
            {t('vehicleTitle')}
          </label>
          <select
            id={`veh-${id}`}
            value={shownVehicle}
            onChange={(e) => {
              setVehicle(AGENT_VEHICLE_TYPES.find((x) => x === e.target.value) ?? '');
            }}
            className={`${portalField} block`}
          >
            {AGENT_VEHICLE_TYPES.map((x) => (
              <option key={x} value={x}>
                {v(x)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={portalQuiet}
          onClick={() => {
            if (shownVehicle === a.vehicleType) return;
            void client.editVehicle(id, shownVehicle, a.version).then((r) => {
              track('click', { id: 'admin_agent_vehicle_saved', path: window.location.pathname });
              say(r.ok ? t('vehicleSaved') : err(r.code), r.ok ? 'ok' : 'error');
              reload();
            });
          }}
        >
          {t('vehicleSave')}
        </button>
      </div>

      <h4 className="mt-4 text-sm font-bold text-ink">{t('history')}</h4>
      <ol className="mt-1 grid gap-1 text-sm">
        {a.history.map((h, i) => (
          <li key={`${h.at}-${String(i)}`} className="text-ink">
            {t('historyRow', { from: h.fromStatus ? st(h.fromStatus) : '—', to: st(h.toStatus) })}
            {h.reasonCode ? ` · ${sr(h.reasonCode)}` : ''} · {formatDate(h.at, locale)}
            {h.note ? (
              <span className="block text-xs text-muted" data-user-content>
                {h.note}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DocumentReview({
  client,
  agentId,
  kind,
  doc,
  onChanged,
}: {
  client: AdminDeliveryClient;
  agentId: string;
  kind: AgentDocumentKind;
  doc: AdminAgentDetailView['documents'][number] | null;
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryAdmin');
  const k = useTranslations('delivery.document.kind');
  const ds = useTranslations('delivery.document.status');
  const rr = useTranslations('delivery.document.rejectReason');
  const err = useErr();
  const { say, line } = useStatusLine();
  const [view, setView] = useState<{ number: string; photoUrl: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<AgentDocumentRejectReason | ''>('');

  async function open() {
    // Audited read: the API logs every staff view of a document.
    const r = await client.document(agentId, kind);
    track('click', { id: `admin_agent_document_viewed_${kind}`, path: window.location.pathname });
    if (r.ok) setView({ number: r.data.number, photoUrl: r.data.photoUrl });
    else say(err(r.code), 'error');
  }
  async function decide(verify: boolean) {
    if (!verify && reason === '') {
      say(t('reasonRequired'), 'error');
      return;
    }
    const r = await client.decideDocument(agentId, kind, verify, verify ? undefined : reason || undefined);
    track('click', {
      id: verify ? `admin_agent_document_verified_${kind}` : `admin_agent_document_rejected_${kind}`,
      path: window.location.pathname,
    });
    say(r.ok ? t('docDone') : err(r.code), r.ok ? 'ok' : 'error');
    setRejecting(false);
    onChanged();
  }

  return (
    <div className="rounded-button border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="block font-bold text-ink">{k(kind)}</span>
          <span className="block text-sm text-muted">
            {doc ? (
              <>
                {doc.status === 'rejected' && doc.rejectReason
                  ? `${ds(doc.status)} · ${rr(doc.rejectReason)}`
                  : ds(doc.status)}{' '}
                <span className="tabular-nums">{doc.numberMasked}</span>
              </>
            ) : (
              t('docMissing')
            )}
          </span>
        </span>
        {doc ? (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={portalQuiet} onClick={() => void open()}>
              {t('docView')}
            </button>
            {doc.status !== 'verified' ? (
              <button type="button" className={portalPrimary} onClick={() => void decide(true)}>
                {t('docVerify')}
              </button>
            ) : null}
            {doc.status !== 'rejected' ? (
              <button
                type="button"
                data-disclosure-trigger={`docrej-${agentId}-${kind}`}
                className={portalQuiet}
                onClick={() => {
                  setRejecting(true);
                }}
              >
                {t('docReject')}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {view ? (
        <div className="mt-2 text-sm text-ink">
          <p className="tabular-nums" lang="en">
            {t('docNumber', { number: view.number })}
          </p>
          {view.photoUrl ? (
            <a href={view.photoUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
              {t('open')}
            </a>
          ) : (
            <p className="text-xs text-muted">{t('docNoPhoto')}</p>
          )}
        </div>
      ) : null}
      {rejecting ? (
        <div className="mt-2 grid gap-2">
          <ReasonSelect
            id={`docrej-${agentId}-${kind}`}
            label={t('docRejectWhy')}
            codes={AGENT_DOCUMENT_REJECT_REASONS}
            text={(c) => rr(c)}
            value={reason}
            onChange={setReason}
          />
          <div className="flex gap-2">
            <button type="button" className={portalPrimary} onClick={() => void decide(false)}>
              {t('docReject')}
            </button>
            <button
              type="button"
              data-panel-cancel={`docrej-${agentId}-${kind}`}
              className={portalQuiet}
              onClick={() => {
                setRejecting(false);
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {line}
    </div>
  );
}

/** Payouts need the agent list (filter, record form). */
function PayoutsHost({ client }: { client: AdminDeliveryClient }) {
  const load = useCallback(() => client.agents(null), [client]);
  const { items, failed, reload } = useList<AdminAgentRowView>(client, load);
  if (!items) return <ListState failed={failed} loading={!failed} onRetry={reload} />;
  return <PayoutsTab client={client} agents={items} />;
}

// ── shop requests ────────────────────────────────────────────────────────────────────────────────────────────────

function RequestsTab({ client }: { client: AdminDeliveryClient }) {
  const t = useTranslations('deliveryAdmin');
  const m = useTranslations('delivery.shopMode');
  const rr = useTranslations('delivery.shopModeRequestReason');
  const rj = useTranslations('delivery.shopModeRejectReason');
  const locale = useLocale();
  const err = useErr();
  const { say, line } = useStatusLine();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<ShopModeRejectReason | ''>('');
  const load = useCallback(() => client.modeRequests('pending'), [client]);
  const { items, failed, reload } = useList<AdminShopModeRequestView>(client, load);

  async function decide(r: AdminShopModeRequestView, approve: boolean) {
    if (!approve && reason === '') {
      say(t('reasonRequired'), 'error');
      return;
    }
    const res = await client.decideMode(r.id, approve, r.version, approve ? undefined : reason || undefined);
    track('click', {
      id: approve ? 'admin_shop_mode_approved' : 'admin_shop_mode_rejected',
      path: window.location.pathname,
    });
    say(res.ok ? (approve ? t('approved') : t('requestRejected')) : err(res.code), res.ok ? 'ok' : 'error');
    setRejecting(null);
    reload();
  }

  return (
    <section aria-labelledby="da-requests" className="space-y-2">
      <h3 id="da-requests" className="font-heading text-lg font-extrabold text-ink">
        {t('requestsTitle')}
      </h3>
      {line}
      <ListState failed={failed && !items} loading={!items && !failed} onRetry={reload} />
      {items?.length === 0 ? <EmptyState title={t('requestsEmpty')} /> : null}
      <ul className="grid gap-2">
        {(items ?? []).map((r) => (
          <li key={r.id} className={adminCard}>
            <p className="font-bold text-ink">{r.shopName}</p>
            <p className="text-sm text-ink">
              {t('requestMeta', { current: m(r.currentMode), requested: m(r.requestedMode) })}
            </p>
            <p className="text-sm text-muted">
              {rr(r.reasonCode)} · {formatDate(r.createdAt, locale)}
            </p>
            {r.note ? (
              <p className="text-sm text-muted" data-user-content>
                {r.note}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={portalPrimary} onClick={() => void decide(r, true)}>
                {t('approve')}
              </button>
              <button
                type="button"
                data-disclosure-trigger={`modrej-${r.id}`}
                className={portalQuiet}
                onClick={() => {
                  setRejecting(r.id);
                  setReason('');
                }}
              >
                {t('reject')}
              </button>
            </div>
            {rejecting === r.id ? (
              <div className="mt-2 grid gap-2">
                <ReasonSelect
                  id={`modrej-${r.id}`}
                  label={t('rejectRequestWhy')}
                  codes={SHOP_MODE_REJECT_REASONS}
                  text={(c) => rj(c)}
                  value={reason}
                  onChange={setReason}
                />
                <div className="flex gap-2">
                  <button type="button" className={portalPrimary} onClick={() => void decide(r, false)}>
                    {t('reject')}
                  </button>
                  <button
                    type="button"
                    data-panel-cancel={`modrej-${r.id}`}
                    className={portalQuiet}
                    onClick={() => {
                      setRejecting(null);
                    }}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── settings ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Per-city delivery settings. Real builds edit the `delivery.*` operational settings on Admin → Settings → Partners
 * (per city, audited, decision 2026-11-26 contract); the browser demo edits its sample values here.
 */
function SettingsTab() {
  const t = useTranslations('deliveryAdmin');
  const client = useAdminDeliveryClient();
  return (
    <section aria-labelledby="da-settings" className={adminCard}>
      <h3 id="da-settings" className="font-heading text-lg font-extrabold text-ink">
        {t('settingsTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('settingsNote')}</p>
      {client?.sample ? (
        <DemoSettingsForm />
      ) : (
        <LocalLink href="/admin/settings" className={`${portalPrimary} mt-3`}>
          {t('settingsOpen')}
        </LocalLink>
      )}
    </section>
  );
}

function DemoSettingsForm() {
  const DemoForm = useDemoSettingsForm();
  return DemoForm ? <DemoForm /> : <div className="skeleton mt-3 h-40 rounded-card" aria-hidden="true" />;
}

function useDemoSettingsForm() {
  const [C, setC] = useState<(() => ReactNode) | null>(null);
  useEffect(() => {
    let live = true;
    void import('./admin-delivery-demo-settings').then((m) => {
      if (live) setC(() => m.DemoDeliverySettings);
    });
    return () => {
      live = false;
    };
  }, []);
  return C;
}
