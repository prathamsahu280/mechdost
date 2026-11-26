'use client';

import { DELIVERY_DECLINE_REASONS, type DeliveryDeclineReason } from '@mechdost/shared/delivery/codes';
import { Bike, Phone } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { PortalGuard } from '@/components/portal/portal-guard';
import { useNow } from '@/components/portal/use-now';
import { Switch } from '@/components/ui/switch';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { site } from '@/lib/site';
import { useAgentClient, useLiveReload } from '@/lib/delivery/use-delivery-client';
import type { AgentClient, AgentJobCardView, AgentJobsView, AgentProfileView } from '@/lib/delivery/types';
import { countdown, kmText, telNumber } from '@/lib/delivery/view';
import { useDeliveryErrorText } from './error-text';
import { LoadGate, ReasonFields, bigPrimary, bigQuiet, reasonProblem, useStatusLine } from './parts';

const POLL_MS = 20_000;
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
          <div className="mx-auto grid max-w-xl gap-5">
            <StatusStrip />
            <AgentTabs />
            {client.sample ? <p className="text-xs text-muted">{t('sample')}</p> : null}
            {children}
          </div>
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
    track('click', { id: online ? 'agent_go_online' : 'agent_go_offline', path: window.location.pathname });
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
          aria-label={t('helpLabel')}
          onClick={() => {
            track('click', { id: 'agent_help_call', path: window.location.pathname });
          }}
          className="press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-button bg-white px-4 text-sm font-extrabold text-navy focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Phone aria-hidden="true" className="size-4" />
          {t('help')}
        </a>
      </div>
      {active ? (
        <div className="mt-4 rounded-button bg-white px-4 py-2 text-ink">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="agent-online" className="text-base font-extrabold">
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
            className={`text-sm font-bold ${profile.online ? 'text-success' : 'text-muted'}`}
          >
            {profile.online ? t('onlineOn') : t('onlineOff')}
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-button bg-white px-4 py-3 text-sm font-bold text-ink">
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

const TABS = [
  { id: 'offers', href: '/partner/delivery' },
  { id: 'jobs', href: '/partner/delivery/jobs' },
  { id: 'history', href: '/partner/delivery/history' },
  { id: 'profile', href: '/partner/delivery/profile' },
] as const;

function AgentTabs() {
  const t = useTranslations('deliveryAgent');
  const locale = useLocale();
  const pathname = usePathname();
  const current = (href: string) => {
    const full = localePath(href, locale);
    return href === '/partner/delivery' ? pathname === full : pathname.startsWith(full);
  };
  return (
    <nav aria-label={t('navLabel')}>
      <ul className="grid grid-cols-4 gap-1 rounded-button border border-line-card bg-surface p-1">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <LocalLink
              href={tab.href}
              aria-current={current(tab.href) ? 'page' : undefined}
              className="press flex min-h-12 items-center justify-center rounded-button px-1 text-center text-sm font-bold text-ink hover:bg-pill aria-[current=page]:bg-navy aria-[current=page]:text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t(`tab_${tab.id}`)}
            </LocalLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One list of the agent's jobs, reloaded on demo changes or polled on the API. */
function useAgentJobs(view: AgentJobsView) {
  const ctx = useAgent();
  const t = useTranslations('deliveryAgent');
  const [items, setItems] = useState<AgentJobCardView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = ctx?.client ?? null;
  const reload = useCallback(() => {
    if (!client) return;
    void client.jobs(view, null).then((r) => {
      if (r.ok) {
        setItems(r.data.items);
        setError(null);
      } else setError(t('loadError'));
    });
  }, [client, view, t]);
  useLiveReload(client, reload, view === 'offers' ? 10_000 : POLL_MS);
  return { items, error, reload };
}

function useScreenView(screen: string) {
  useEffect(() => {
    track('click', { id: `agent_screen_${screen}`, path: window.location.pathname });
  }, [screen]);
}

export function AgentOffers() {
  const t = useTranslations('deliveryAgent');
  const ctx = useAgent();
  const { items, error, reload } = useAgentJobs('offers');
  const now = useNow(1000);
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
  const l = useTranslations('delivery.loadClass');
  return (
    <dl className="grid gap-1 text-[15px] text-ink">
      <div>
        <dt className="sr-only">{t('shopTitle')}</dt>
        <dd className="font-bold">
          {job.shopArea ? t('pickupIn', { area: job.shopArea }) : t('pickupInUnknown')}
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
  if (!ctx || !offer.offerId) return null;
  const { client, errorText } = ctx;
  const offerId = offer.offerId;
  const formId = `decline-${offerId}`;

  async function accept() {
    if (busy) return;
    setBusy(true);
    const res = await client.accept(offerId);
    setBusy(false);
    track('click', {
      id: res.ok ? 'agent_offer_accepted' : 'agent_offer_accept_failed',
      path: window.location.pathname,
    });
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
    track('click', { id: 'agent_offer_declined', path: window.location.pathname });
    if (res.ok) {
      say(t('declined'));
      onChanged();
    } else say(errorText(res.code), 'error');
  }

  const ended = left !== null && left.seconds === 0;
  const endsAt = offer.offerExpiresAt
    ? new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(offer.offerExpiresAt))
    : null;
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
        {left ? (
          <p
            className={`rounded-pill px-3 py-1 text-sm font-extrabold tabular-nums ${left.urgent ? 'bg-warning-bg text-warning' : 'bg-pill text-ink'}`}
          >
            {/* The ticking time is for the eye; screen readers get the end time once (no per-second chatter). */}
            <span aria-hidden="true">
              {left.urgent ? `${t('hurry')} · ` : ''}
              {t('timeLeftShort', { time: left.text })}
            </span>
            {endsAt ? <span className="sr-only">{t('endsAt', { time: endsAt })}</span> : null}
          </p>
        ) : null}
      </div>
      <div className="mt-2">
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
  const { items, error, reload } = useAgentJobs('done');
  useScreenView('history');
  return (
    <section aria-labelledby="agent-history-title" className="grid gap-3">
      <h2 id="agent-history-title" className="font-heading text-xl font-extrabold text-ink">
        {t('historyTitle')}
      </h2>
      <LoadGate loading={items === null} error={items ? null : error} onRetry={reload}>
        {items?.length === 0 ? (
          <p className={`${card} text-sm text-muted`}>{t('historyEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line-card bg-surface">
            {(items ?? []).map((j) => (
              <li key={j.jobId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="block font-bold text-ink">{j.orderCode}</span>
                  <span className="block text-sm text-muted">
                    {new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
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
        )}
      </LoadGate>
    </section>
  );
}
