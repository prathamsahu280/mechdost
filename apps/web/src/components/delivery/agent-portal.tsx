'use client';

import { DELIVERY_DECLINE_REASONS, type DeliveryDeclineReason } from '@mechdost/shared/delivery/codes';
import { Bike, Phone, Power } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { PortalGuard } from '@/components/portal/portal-guard';
import { useNow } from '@/components/portal/use-now';
import { Switch } from '@/components/ui/switch';
import { LocalLink } from '@/components/ui/local-link';
import {
  OfferTimer,
  OrderSoundButton,
  PartnerFrame,
  UpdatedAgo,
  useNewWorkAlert,
} from '@/components/partner';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { groupByIstDay } from '@/lib/delivery/agent-stats-view';
import { useRiderTabs } from './rider-tabs';
import { site } from '@/lib/site';
import { useAgentClient, useLiveReload } from '@/lib/delivery/use-delivery-client';
import type { AgentClient, AgentJobCardView, AgentJobsView, AgentProfileView } from '@/lib/delivery/types';
import { countdown, kmText, telNumber } from '@/lib/delivery/view';
import { useDeliveryErrorText } from './error-text';
import { LoadGate, ReasonFields, bigPrimary, bigQuiet, reasonProblem, useStatusLine } from './parts';

const POLL_MS = 20_000;
/** The offer window (founder ruling: 15 min by default) for the timer bar; a longer offer just starts full. */
const OFFER_WINDOW_MS = 15 * 60_000;
const card = 'rounded-card border border-line-card bg-surface p-4 shadow-card';

interface AgentCtx {
  client: AgentClient;
  profile: AgentProfileView;
  reloadProfile: () => void;
  errorText: (code: string) => string;
}
const Ctx = createContext<AgentCtx | null>(null);
export function useAgent(): AgentCtx | null {
  return useContext(Ctx);
}

export { useDeliveryErrorText } from './error-text';

/**
 * Delivery agent portal frame (spec 24, `/partner/delivery`): the guard, the navy status strip (online switch, help
 * call) and the tab bar stay mounted in the layout while the tabs change (no reload feel, decision 2026-11-16).
 * Mobile first: one column, 48 px targets, the state always in words.
 */
export function AgentFrame({ children }: { children: ReactNode }) {
  return (
    <PortalGuard role="delivery_agent" path="/partner/delivery" demoNote={false}>
      {() => <AgentProvider>{children}</AgentProvider>}
    </PortalGuard>
  );
}

function AgentProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('deliveryAgent');
  const client = useAgentClient();
  const errorText = useDeliveryErrorText();
  const [profile, setProfile] = useState<AgentProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reloadProfile = useCallback(() => {
    if (!client) return;
    void client.me().then((r) => {
      if (r.ok) {
        setProfile(r.data);
        setError(null);
      } else setError(r.status === 404 ? t('noJob') : t('loadError'));
    });
  }, [client, t]);
  useLiveReload(client, reloadProfile, POLL_MS);

  return (
    <LoadGate
      loading={!client || (!profile && !error)}
      error={profile ? null : error}
      onRetry={reloadProfile}
    >
      {client && profile ? (
        <Ctx.Provider value={{ client, profile, reloadProfile, errorText }}>
          <RiderFrame>
            {client.sample ? <p className="text-xs text-muted">{t('sample')}</p> : null}
            {children}
          </RiderFrame>
        </Ctx.Provider>
      ) : null}
    </LoadGate>
  );
}

function StatusStrip() {
  const t = useTranslations('deliveryAgent');
  const v = useTranslations('delivery.vehicle');
  const r = useTranslations('delivery.agentStatusReason');
  const ctx = useAgent();
  const { say, line } = useStatusLine();
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;
  const { profile, client, reloadProfile, errorText } = ctx;
  const active = profile.status === 'active';
  const reason = profile.statusReason ? r(profile.statusReason) : '';

  async function toggle(online: boolean) {
    if (busy) return;
    setBusy(true);
    const res = await client.setOnline(online, profile.version);
    setBusy(false);
    if (res.ok) track('delivery_online_toggled', { online });
    if (res.ok) say(online ? t('onlineSaved') : t('offlineSaved'));
    else say(errorText(res.code), 'error');
    reloadProfile();
  }

  return (
    <section aria-labelledby="agent-hello" className="blueprint rounded-card p-5 text-white shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="agent-hello" className="font-heading text-2xl font-extrabold break-words" data-user-content>
            {t('hello', { name: profile.firstName })}
          </h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-white/85">
            <Bike aria-hidden="true" className="size-4" />
            {v(profile.vehicleType)}
          </p>
        </div>
        <a
          href={`tel:${telNumber(site.supportPhone)}`}
          title={t('helpLabel')}
          onClick={() => {
            track('delivery_contact_tapped', { target: 'support', action: 'call' });
          }}
          className="press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-button bg-white px-4 text-sm font-extrabold text-navy focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Phone aria-hidden="true" className="size-4" />
          {t('help')}
        </a>
      </div>
      {active ? (
        <div
          data-online-card
          className={`mt-4 rounded-card px-4 py-4 text-ink shadow-card ring-2 transition-colors motion-reduce:transition-none ${
            profile.online ? 'bg-success-bg ring-success' : 'bg-surface ring-white/80'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="agent-online" className="flex min-w-0 items-center gap-3 text-lg font-extrabold">
              <span
                aria-hidden="true"
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                  profile.online ? 'bg-success text-surface' : 'bg-pill text-ink'
                }`}
              >
                <Power className="size-5" />
              </span>
              {t('onlineLabel')}
            </label>
            <Switch
              id="agent-online"
              checked={profile.online}
              onChange={(on) => void toggle(on)}
              onText={t('on')}
              offText={t('off')}
              describedBy="agent-online-state"
            />
          </div>
          <p
            id="agent-online-state"
            className={`mt-2 text-[15px] font-bold ${profile.online ? 'text-success' : 'text-ink'}`}
          >
            {profile.online ? t('onlineOn') : t('onlineOff')}
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-button bg-surface px-4 py-3 text-sm font-bold text-ink">
          {profile.status === 'onboarding'
            ? t('notActive')
            : profile.status === 'paused'
              ? t('paused', { reason })
              : profile.status === 'suspended'
                ? t('suspended', { reason })
                : t('offboarded')}
        </p>
      )}
      {active && !profile.canReceiveOffers && profile.online ? (
        <p className="mt-2 text-sm text-white/85">{t('agentsOff')}</p>
      ) : null}
      <div className="mt-2 text-white">{line}</div>
    </section>
  );
}

/**
 * The partner frame (design 2026-11-27 § 7): the status strip on top, the tabs in a bottom bar on a phone and a side
 * rail on a computer; one centred phone-width column for the work.
 */
function RiderFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('deliveryAgent');
  const tabs = useRiderTabs();
  return (
    <PartnerFrame
      portal="rider"
      navLabel={t('navLabel')}
      railTitle={t('title')}
      tabs={tabs}
      strip={<StatusStrip />}
      narrow
      heading={false}
    >
      {children}
    </PartnerFrame>
  );
}

/** One list of the agent's jobs, reloaded on demo changes or polled on the API. */
function useAgentJobs(view: AgentJobsView) {
  const ctx = useAgent();
  const t = useTranslations('deliveryAgent');
  const [items, setItems] = useState<AgentJobCardView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const client = ctx?.client ?? null;
  const reload = useCallback(() => {
    if (!client) return;
    void client.jobs(view, null).then((r) => {
      if (r.ok) {
        setItems(r.data.items);
        setLoadedAt(Date.now());
        setError(null);
      } else setError(t('loadError'));
    });
  }, [client, view, t]);
  useLiveReload(client, reload, view === 'offers' ? 10_000 : POLL_MS);
  return { items, error, reload, loadedAt };
}

function useScreenView(screen: string) {
  useEffect(() => {
    track('click', { id: `agent_screen_${screen}`, path: window.location.pathname });
  }, [screen]);
}

export function AgentOffers() {
  const t = useTranslations('deliveryAgent');
  const ctx = useAgent();
  const { items, error, reload, loadedAt } = useAgentJobs('offers');
  const now = useNow(1000);
  // Sound + vibration on a new offer (design 2026-11-27 § 4; on by default, Q-PP-F3); the status line below says it too.
  const alert = useNewWorkAlert('rider', items ? items.map((o) => o.offerId ?? o.jobId) : null);
  // One list-level status line (stays mounted when a card leaves) announces new offers and the result of a decline.
  const { say, line } = useStatusLine();
  const seen = useRef<Set<string> | null>(null);
  useScreenView('offers');
  useEffect(() => {
    if (!items) return;
    const ids = new Set(items.map((o) => o.offerId ?? o.jobId));
    const before = seen.current;
    seen.current = ids;
    if (!before) return;
    const fresh = [...ids].filter((id) => !before.has(id)).length;
    if (fresh > 0) say(t('newOffers', { count: fresh }));
  }, [items]);
  if (!ctx) return null;
  const open = (items ?? []).filter((o) => (countdown(o.offerExpiresAt, now)?.seconds ?? 0) > 0);
  /** After a card leaves the list, focus the list heading instead of dropping to the page (2.4.3). */
  const afterRemoval = () => {
    document.getElementById('agent-offers-title')?.focus();
    reload();
  };
  return (
    <section aria-labelledby="agent-offers-title" className="grid gap-3">
      <h2 id="agent-offers-title" tabIndex={-1} className="font-heading text-xl font-extrabold text-ink">
        {t('offersTitle')} {items ? <span className="text-muted tabular-nums">({open.length})</span> : null}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <OrderSoundButton alert={alert} />
        <UpdatedAgo at={loadedAt} onRefresh={reload} />
      </div>
      {line}
      <LoadGate loading={items === null} error={items ? null : error} onRetry={reload}>
        {(items ?? []).length === 0 ? (
          <div className={card}>
            <p className="text-sm text-muted">
              {ctx.profile.online ? t('offersEmptyOnline') : t('offersEmptyOffline')}
            </p>
            {!ctx.profile.online && ctx.profile.status === 'active' ? (
              <a href="#agent-online" className={`${bigQuiet} mt-3`}>
                {t('goOnline')}
              </a>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-3">
            {/* An offer that ran out stays as "Offer ended" until the next refresh, so it never vanishes under the
                rider's finger (a11y review COG-001). */}
            {(items ?? []).map((o) => (
              <li key={o.offerId ?? o.jobId}>
                <OfferCard offer={o} now={now} onChanged={afterRemoval} onSay={say} />
              </li>
            ))}
          </ul>
        )}
      </LoadGate>
    </section>
  );
}

function JobFacts({ job }: { job: AgentJobCardView }) {
  const t = useTranslations('deliveryAgent');
  const locale = useLocale();
  const l = useTranslations('delivery.loadClass');
  return (
    <dl className="grid gap-1 text-[15px] text-ink">
      <div>
        <dt className="sr-only">{t('shopTitle')}</dt>
        <dd className="font-bold">
          {job.shopArea
            ? t('pickupIn', { area: locale === 'hi' && job.shopAreaHi ? job.shopAreaHi : job.shopArea })
            : t('pickupInUnknown')}
        </dd>
      </div>
      <div>
        <dt className="sr-only">{t('customerTitle')}</dt>
        <dd>{t('dropAt', { pin: job.customerPincode })}</dd>
      </div>
      <div className="text-sm text-muted">
        <dt className="sr-only">{t('itemsTitle')}</dt>
        <dd>
          {t('items', { count: job.itemCount })} · {l(job.loadClass)}
          {job.distanceM !== null ? ` · ${t('distance', { km: kmText(job.distanceM) })}` : ''}
          {job.attempt > 1 ? ` · ${t('attempt', { n: job.attempt })}` : ''}
        </dd>
      </div>
    </dl>
  );
}

function OfferCard({
  offer,
  now,
  onChanged,
  onSay,
}: {
  offer: AgentJobCardView;
  now: number;
  onChanged: () => void;
  /** The list's status line (this card may leave the list after the action). */
  onSay: (text: string, tone?: 'ok' | 'error') => void;
}) {
  const t = useTranslations('deliveryAgent');
  const dr = useTranslations('delivery.declineReason');
  const ctx = useAgent();
  const router = useRouter();
  const locale = useLocale();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeliveryDeclineReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<'reason' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const say = onSay;
  const left = countdown(offer.offerExpiresAt, now);
  const formIdEarly = `decline-${offer.offerId ?? offer.jobId}`;
  useDisclosureFocus(declining ? formIdEarly : null);
  // Once per offer shown (the list polls; the card keeps its key), never per tick.
  useEffect(() => {
    const secondsLeft = countdown(offer.offerExpiresAt, Date.now())?.seconds ?? 0;
    track('delivery_offer_viewed', { secondsLeft: Math.min(secondsLeft, 3_600) });
  }, [offer.offerId, offer.offerExpiresAt]);
  if (!ctx || !offer.offerId) return null;
  const { client, errorText } = ctx;
  const offerId = offer.offerId;
  const formId = `decline-${offerId}`;

  async function accept() {
    if (busy) return;
    setBusy(true);
    const res = await client.accept(offerId);
    setBusy(false);
    if (res.ok) track('delivery_offer_answered', { decision: 'accept' });
    if (!res.ok) {
      say(errorText(res.code), 'error');
      onChanged();
      return;
    }
    // `?accepted=1`: the job page focuses its step heading on arrival (the Accept button is gone).
    router.push(localePath(`/partner/delivery/jobs/${res.data.jobId}`, locale) + '?accepted=1');
  }

  async function decline() {
    const p = reasonProblem(formId, reason, note);
    setProblem(p);
    if (p || reason === '' || busy) return;
    setBusy(true);
    const res = await client.decline(offerId, reason, note.trim() || undefined);
    setBusy(false);
    if (res.ok) track('delivery_offer_answered', { decision: 'decline', reasonCode: reason });
    if (res.ok) {
      say(t('declined'));
      onChanged();
    } else say(errorText(res.code), 'error');
  }

  const ended = left !== null && left.seconds === 0;
  if (ended) {
    return (
      <article className={card}>
        <p className="font-heading text-lg font-extrabold text-ink">{offer.orderCode}</p>
        <p className="mt-1 text-[15px] font-bold text-muted">{t('expired')}</p>
      </article>
    );
  }

  return (
    <article className={`${card} border-accent-button/60`} aria-busy={busy || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading text-lg font-extrabold text-ink">{offer.orderCode}</p>
      </div>
      <div className="mt-3">
        <OfferTimer endsAt={offer.offerExpiresAt} now={now} windowMs={OFFER_WINDOW_MS} />
      </div>
      <div className="mt-3">
        <JobFacts job={offer} />
      </div>
      {declining ? (
        <div className="mt-4 grid gap-3">
          <ReasonFields
            id={formId}
            legend={t('declineWhy')}
            codes={DELIVERY_DECLINE_REASONS}
            label={(c) => dr(c)}
            value={reason}
            onChange={(c) => {
              setReason(c);
              setProblem(null);
            }}
            note={note}
            onNote={setNote}
            error={problem}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void decline()}
              className={bigPrimary}
            >
              {t('sendDecline')}
            </button>
            <button
              type="button"
              data-panel-cancel={formId}
              onClick={() => {
                setDeclining(false);
                setProblem(null);
              }}
              className={bigQuiet}
            >
              {t('back')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-[2fr_1fr] gap-2">
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => void accept()}
            className={bigPrimary}
          >
            {t('accept')}
          </button>
          <button
            type="button"
            data-disclosure-trigger={formId}
            onClick={() => {
              setDeclining(true);
            }}
            className={bigQuiet}
          >
            {t('decline')}
          </button>
        </div>
      )}
    </article>
  );
}

function JobLinkCard({ job }: { job: AgentJobCardView }) {
  const t = useTranslations('deliveryAgent');
  const s = useTranslations('delivery.jobStatus');
  return (
    <article className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading text-lg font-extrabold text-ink">{job.orderCode}</p>
        <p className="rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">{s(job.status)}</p>
      </div>
      <div className="mt-2">
        <JobFacts job={job} />
      </div>
      <LocalLink href={`/partner/delivery/jobs/${job.jobId}`} className={`${bigPrimary} mt-3 w-full`}>
        {t('openJob')}
        <span className="sr-only"> {job.orderCode}</span>
      </LocalLink>
    </article>
  );
}

export function AgentJobs() {
  const t = useTranslations('deliveryAgent');
  const { items, error, reload } = useAgentJobs('active');
  useScreenView('jobs');
  return (
    <section aria-labelledby="agent-jobs-title" className="grid gap-3">
      <h2 id="agent-jobs-title" className="font-heading text-xl font-extrabold text-ink">
        {t('jobsTitle')}
      </h2>
      <LoadGate loading={items === null} error={items ? null : error} onRetry={reload}>
        {items?.length === 0 ? (
          <div className={card}>
            <p className="text-sm text-muted">{t('jobsEmpty')}</p>
            <LocalLink href="/partner/delivery" className={`${bigQuiet} mt-3`}>
              {t('seeOffers')}
            </LocalLink>
          </div>
        ) : (
          <ul className="grid gap-3">
            {(items ?? []).map((j) => (
              <li key={j.jobId}>
                <JobLinkCard job={j} />
              </li>
            ))}
          </ul>
        )}
      </LoadGate>
    </section>
  );
}

export function AgentHistory() {
  const t = useTranslations('deliveryAgent');
  const s = useTranslations('delivery.jobStatus');
  const locale = useLocale();
  const p = useTranslations('partnerRider');
  const { items, error, reload } = useAgentJobs('done');
  useScreenView('history');
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(`${day}T12:00:00+05:30`));
  return (
    <section aria-labelledby="agent-history-title" className="grid gap-3">
      <h2 id="agent-history-title" className="font-heading text-xl font-extrabold text-ink">
        {t('historyTitle')}
      </h2>
      <LoadGate loading={items === null} error={items ? null : error} onRetry={reload}>
        {items?.length === 0 ? (
          <p className={`${card} text-sm text-muted`}>{t('historyEmpty')}</p>
        ) : (
          // Rows grouped by IST day with the day's delivered count (design 2026-11-27 § 7).
          <div className="grid gap-4">
            {groupByIstDay(items ?? []).map((g) => (
              <section key={g.day}>
                <h3 className="mb-2 text-sm font-extrabold text-ink">
                  {p('history_day', {
                    day: dayLabel(g.day),
                    count: g.items.filter((j) => j.status === 'delivered').length,
                  })}
                </h3>
                <ul className="divide-y divide-line rounded-card border border-line-card bg-surface">
                  {g.items.map((j) => (
                    <li key={j.jobId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <span>
                        <span className="block font-bold text-ink">{j.orderCode}</span>
                        <span className="block text-sm text-muted">
                          {new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                            timeStyle: 'short',
                            hour12: locale !== 'hi',
                            timeZone: 'Asia/Kolkata',
                          }).format(new Date(j.updatedAt))}
                        </span>
                      </span>
                      <span className="rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
                        {s(j.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </LoadGate>
    </section>
  );
}
