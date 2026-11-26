'use client';

import {
  DELIVERY_FAIL_REASONS,
  DELIVERY_GIVE_UP_REASONS,
  type DeliveryFailReason,
  type DeliveryGiveUpReason,
} from '@mechdost/shared/delivery/codes';
import { MapPin, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { useLiveReload } from '@/lib/delivery/use-delivery-client';
import type { AgentJobDetailView } from '@/lib/delivery/types';
import { agentStep, mapsHref, telHref } from '@/lib/delivery/view';
import { useAgent } from './agent-portal';
import {
  CodeEntry,
  LoadGate,
  PhotoCapture,
  ReasonFields,
  bigPrimary,
  bigQuiet,
  reasonProblem,
  useStatusLine,
} from './parts';

const card = 'rounded-card border border-line-card bg-surface p-4 shadow-card';
const linkBtn =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button border border-input-border px-4 text-base font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** "I'm at the shop / customer" is the agent's own tap: kept on this device for the job only. */
function useArrived(jobId: string, status: string): [boolean, (v: boolean) => void] {
  const key = `mechdost-agent-arrived-${jobId}-${status}`;
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    try {
      setArrived(window.sessionStorage.getItem(key) === '1');
    } catch {
      setArrived(false);
    }
  }, [key]);
  const set = (v: boolean) => {
    setArrived(v);
    try {
      window.sessionStorage.setItem(key, v ? '1' : '0');
    } catch {
      // Storage blocked: the step still moves on this screen.
    }
  };
  return [arrived, set];
}

/**
 * One delivery job in four steps (spec 24): go to the shop → the shop's pickup code + a parcel photo → the customer's
 * details appear → the customer's delivery code + a photo. "Couldn't deliver" reports a reason and a photo. Contacts
 * come from the API by stage (Lead's call 6); this screen never holds more than it was given.
 */
export function AgentJob({ jobId }: { jobId: string }) {
  const t = useTranslations('deliveryAgent');
  const ctx = useAgent();
  const [job, setJob] = useState<AgentJobDetailView | null>(null);
  const [error, setError] = useState<{ code: string; status: number } | null>(null);
  const client = ctx?.client ?? null;
  const reload = useCallback(() => {
    if (!client) return;
    void client.job(jobId).then((r) => {
      if (r.ok) {
        setJob(r.data);
        setError(null);
      } else setError({ code: r.code, status: r.status });
    });
  }, [client, jobId]);
  useLiveReload(client, reload, 20_000);
  useEffect(() => {
    track('click', { id: 'agent_screen_job', path: window.location.pathname });
  }, []);

  if (error?.status === 404) {
    return (
      <div className={card}>
        <p className="text-[15px] text-ink">{t('noJob')}</p>
        <LocalLink href="/partner/delivery/jobs" className={`${bigQuiet} mt-3`}>
          {t('backToJobs')}
        </LocalLink>
      </div>
    );
  }
  return (
    <LoadGate loading={!job} error={job ? null : error ? t('loadError') : null} onRetry={reload}>
      {job ? <JobBody job={job} onChanged={reload} /> : null}
    </LoadGate>
  );
}

function JobBody({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  const t = useTranslations('deliveryAgent');
  const [arrived, setArrived] = useArrived(job.jobId, job.status);
  const step = agentStep(job.status, arrived);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // The step heading takes focus when the step changes, so a screen reader hears the new step (not on first load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, job.status]);

  return (
    <article aria-labelledby="job-step-title" className="grid gap-4">
      <div>
        <p className="text-sm font-bold text-muted">{t('jobTitle', { code: job.orderCode })}</p>
        {step ? (
          <>
            <StepBar step={step} />
            <h2
              id="job-step-title"
              ref={heading}
              tabIndex={-1}
              className="mt-2 font-heading text-2xl font-extrabold text-ink"
            >
              {t(['step_shop', 'step_pickup', 'step_customer', 'step_deliver'][step - 1] as 'step_shop')}
            </h2>
          </>
        ) : (
          <h2
            id="job-step-title"
            ref={heading}
            tabIndex={-1}
            className="font-heading text-2xl font-extrabold text-ink"
          >
            {job.status === 'returning'
              ? t('returnTitle')
              : job.status === 'failed'
                ? t('cantDeliver')
                : job.status === 'delivered'
                  ? t('finished_delivered')
                  : job.status === 'returned'
                    ? t('finished_returned')
                    : job.status === 'cancelled'
                      ? t('finished_cancelled')
                      : t('offersTitle')}
          </h2>
        )}
      </div>

      {job.status === 'offered' ? (
        <div className={card}>
          <LocalLink href="/partner/delivery" className={`${bigPrimary} w-full`}>
            {t('seeOffers')}
          </LocalLink>
        </div>
      ) : null}

      {step === 1 || step === 2 || job.status === 'returning' ? <ShopCard job={job} /> : null}
      {step === 1 || step === 2 ? <ItemsCard job={job} /> : null}
      {step !== null || job.status === 'failed' ? <CustomerCard job={job} /> : null}

      {step === 1 ? (
        <button
          type="button"
          className={`${bigPrimary} w-full`}
          onClick={() => {
            setArrived(true);
            track('click', { id: 'agent_at_shop', path: window.location.pathname });
          }}
        >
          {t('atShop')}
        </button>
      ) : null}
      {step === 2 ? <PickupStep job={job} onChanged={onChanged} /> : null}
      {step === 1 || step === 2 ? <GiveUp job={job} onChanged={onChanged} /> : null}

      {step === 3 ? (
        <button
          type="button"
          className={`${bigPrimary} w-full`}
          onClick={() => {
            setArrived(true);
            track('click', { id: 'agent_at_customer', path: window.location.pathname });
          }}
        >
          {t('atCustomer')}
        </button>
      ) : null}
      {step === 4 ? <DeliverStep job={job} onChanged={onChanged} /> : null}
      {step === 3 || step === 4 ? <FailForm job={job} onChanged={onChanged} /> : null}

      {job.status === 'failed' ? <p className={`${card} text-[15px] text-ink`}>{t('failedWait')}</p> : null}
      {job.status === 'returning' && job.returnCode ? (
        <section aria-labelledby="return-code-title" className={`${card} border-accent-button/60`}>
          <p className="text-[15px] text-ink">{t('returnBody')}</p>
          <h3 id="return-code-title" className="mt-2 text-sm font-bold text-muted">
            {t('returnCodeLabel')}
          </h3>
          <p className="font-heading text-4xl font-extrabold tracking-[0.3em] text-ink tabular-nums">
            {job.returnCode}
          </p>
        </section>
      ) : null}
      {['delivered', 'returned', 'cancelled'].includes(job.status) || job.contact.stage === 'none' ? (
        <div className={card}>
          {job.status === 'delivered' ? (
            <p className="text-[15px] font-bold text-success">{t('delivered')}</p>
          ) : null}
          {!['delivered', 'returned', 'cancelled'].includes(job.status) ? (
            <p className="text-[15px] text-ink">{t('finished_other')}</p>
          ) : null}
          <LocalLink href="/partner/delivery/jobs" className={`${bigQuiet} mt-3`}>
            {t('backToJobs')}
          </LocalLink>
        </div>
      ) : null}
    </article>
  );
}

function StepBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  const t = useTranslations('deliveryAgent');
  const names = ['step_shop', 'step_pickup', 'step_customer', 'step_deliver'] as const;
  return (
    <div className="mt-2">
      <p className="text-sm font-bold text-ink">{t('stepOf', { n: step })}</p>
      <ol aria-label={t('stepsLabel')} className="mt-2 grid grid-cols-4 gap-1">
        {names.map((n, i) => (
          <li
            key={n}
            aria-current={i + 1 === step ? 'step' : undefined}
            className={`h-2 rounded-pill ${i + 1 <= step ? 'bg-accent-button' : 'bg-line'}`}
          >
            <span className="sr-only">{t(n)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ShopCard({ job }: { job: AgentJobDetailView }) {
  const t = useTranslations('deliveryAgent');
  const shop = job.contact.shop;
  if (!shop) return null;
  return (
    <section aria-labelledby="job-shop-title" className={card}>
      <h3 id="job-shop-title" className="text-sm font-bold text-muted">
        {t('shopTitle')}
      </h3>
      <p className="mt-1 font-heading text-lg font-extrabold text-ink">{shop.name}</p>
      <p className="text-[15px] text-ink">{t('areaPin', { area: shop.addressLine, pin: shop.pincode })}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={telHref(shop.phone)}
          className={linkBtn}
          onClick={() => {
            track('click', { id: 'agent_call_shop', path: window.location.pathname });
          }}
        >
          <Phone aria-hidden="true" className="size-4" />
          {t('callShop')}
        </a>
        <a
          href={
            shop.lat !== null && shop.lng !== null
              ? mapsHref({ lat: shop.lat, lng: shop.lng })
              : mapsHref({ address: `${shop.name}, ${shop.addressLine}, ${shop.pincode}` })
          }
          target="_blank"
          rel="noopener noreferrer"
          className={linkBtn}
          onClick={() => {
            track('click', { id: 'agent_map_shop', path: window.location.pathname });
          }}
        >
          <MapPin aria-hidden="true" className="size-4" />
          {t('openMaps')}
        </a>
      </div>
    </section>
  );
}

function ItemsCard({ job }: { job: AgentJobDetailView }) {
  const t = useTranslations('deliveryAgent');
  return (
    <section aria-labelledby="job-items-title" className={card}>
      <h3 id="job-items-title" className="text-sm font-bold text-muted">
        {t('itemsTitle')}
      </h3>
      <ul className="mt-1 divide-y divide-line text-[15px]">
        {job.items.map((i) => (
          <li key={i.name} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 text-ink">{i.name}</span>
            <span className="shrink-0 font-bold text-ink tabular-nums">× {i.quantity}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CustomerCard({ job }: { job: AgentJobDetailView }) {
  const t = useTranslations('deliveryAgent');
  const c = job.contact.customer;
  if (!c) return null;
  const full = c.name !== null && c.addressLine !== null;
  return (
    <section aria-labelledby="job-customer-title" className={card}>
      <h3 id="job-customer-title" className="text-sm font-bold text-muted">
        {t('customerTitle')}
      </h3>
      {full ? (
        <>
          <p className="mt-1 font-heading text-lg font-extrabold text-ink" data-user-content>
            {c.name}
          </p>
          <p className="text-[15px] text-ink" data-user-content>
            {c.addressLine}
          </p>
          {c.landmark ? (
            <p className="text-sm text-muted" data-user-content>
              {c.landmark}
            </p>
          ) : null}
          <p className="text-sm text-muted">{t('pinOnly', { pin: c.pincode })}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {c.phone ? (
              <a
                href={telHref(c.phone)}
                className={linkBtn}
                onClick={() => {
                  track('click', { id: 'agent_call_customer', path: window.location.pathname });
                }}
              >
                <Phone aria-hidden="true" className="size-4" />
                {t('callCustomer')}
              </a>
            ) : null}
            <a
              href={mapsHref({ address: `${c.addressLine ?? ''}, ${c.pincode}` })}
              target="_blank"
              rel="noopener noreferrer"
              className={linkBtn}
              onClick={() => {
                track('click', { id: 'agent_map_customer', path: window.location.pathname });
              }}
            >
              <MapPin aria-hidden="true" className="size-4" />
              {t('openMaps')}
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[15px] text-ink">
            {c.area ? t('areaPin', { area: c.area, pin: c.pincode }) : t('pinOnly', { pin: c.pincode })}
          </p>
          <p className="text-sm text-muted">{t('customerLater')}</p>
        </>
      )}
    </section>
  );
}

function PickupStep({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  const t = useTranslations('deliveryAgent');
  const e = useTranslations('delivery.errors');
  const ctx = useAgent();
  const [photo, setPhoto] = useState<string | null>(null);
  if (!ctx) return null;
  const { client, errorText } = ctx;
  if (job.pickupLocked) {
    return (
      <p role="alert" className={`${card} font-bold text-warning`}>
        {e('CODE_LOCKED')}
      </p>
    );
  }
  return (
    <section aria-label={t('step_pickup')} className={card}>
      <CodeEntry
        id={`pickup-code-${job.jobId}`}
        label={t('pickupCodeLabel')}
        hint={t('pickupCodeHint')}
        submitLabel={t('confirmPickup')}
        kind="agent_pickup_code"
        onCode={async (code) => {
          if (job.photosRequired && !photo) return e('PHOTO_REQUIRED');
          const res = await client.pickup(job.jobId, code, photo ?? undefined, job.version);
          if (!res.ok) return errorText(res.code);
          onChanged();
          if (res.data.ok) {
            track('click', { id: 'agent_picked_up', path: window.location.pathname });
            return null;
          }
          return res.data.locked
            ? e('CODE_LOCKED')
            : e('WRONG_CODE', { attemptsLeft: res.data.attemptsLeft });
        }}
      >
        <PhotoCapture
          id={`pickup-photo-${job.jobId}`}
          label={job.photosRequired ? t('photoPickup') : t('photoOptional')}
          hint={t('photoPickupHint')}
          purpose="pickup"
          upload={client.uploadPhoto}
          onMedia={setPhoto}
        />
      </CodeEntry>
    </section>
  );
}

function DeliverStep({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  const t = useTranslations('deliveryAgent');
  const e = useTranslations('delivery.errors');
  const ctx = useAgent();
  const [photo, setPhoto] = useState<string | null>(null);
  if (!ctx) return null;
  const { client, errorText } = ctx;
  if (job.deliveryLocked) {
    return (
      <p role="alert" className={`${card} font-bold text-warning`}>
        {e('CODE_LOCKED')}
      </p>
    );
  }
  return (
    <section aria-label={t('step_deliver')} className={card}>
      <CodeEntry
        id={`delivery-code-${job.jobId}`}
        label={t('deliveryCodeLabel')}
        hint={t('deliveryCodeHint')}
        submitLabel={t('confirmDelivery')}
        kind="agent_delivery_code"
        onCode={async (code) => {
          if (job.photosRequired && !photo) return e('PHOTO_REQUIRED');
          const res = await client.deliver(job.jobId, code, photo ?? undefined, job.version);
          if (!res.ok) return errorText(res.code);
          onChanged();
          if (res.data.ok) {
            track('click', { id: 'agent_delivered', path: window.location.pathname });
            return null;
          }
          return res.data.locked
            ? e('CODE_LOCKED')
            : e('WRONG_CODE', { attemptsLeft: res.data.attemptsLeft });
        }}
      >
        <PhotoCapture
          id={`delivery-photo-${job.jobId}`}
          label={job.photosRequired ? t('photoDelivery') : t('photoOptional')}
          purpose="delivery"
          upload={client.uploadPhoto}
          onMedia={setPhoto}
        />
      </CodeEntry>
    </section>
  );
}

function FailForm({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  const t = useTranslations('deliveryAgent');
  const fr = useTranslations('delivery.failReason');
  const e = useTranslations('delivery.errors');
  const ctx = useAgent();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeliveryFailReason | ''>('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [problem, setProblem] = useState<'reason' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  if (!ctx) return null;
  const { client, errorText } = ctx;
  const id = `fail-${job.jobId}`;

  async function send() {
    const p = reasonProblem(id, reason, note);
    setProblem(p);
    if (p || reason === '' || busy) return;
    if (job.photosRequired && !photo) {
      say(e('PHOTO_REQUIRED'), 'error');
      return;
    }
    setBusy(true);
    const res = await client.fail(
      job.jobId,
      reason,
      note.trim() || undefined,
      photo ?? undefined,
      job.version,
    );
    setBusy(false);
    track('click', { id: 'agent_delivery_failed', path: window.location.pathname });
    if (!res.ok) {
      say(errorText(res.code), 'error');
      return;
    }
    onChanged();
  }

  if (!open) {
    return (
      <button
        type="button"
        data-disclosure-trigger={id}
        onClick={() => {
          setOpen(true);
        }}
        className={`${bigQuiet} w-full`}
      >
        {t('cantDeliver')}
      </button>
    );
  }
  return (
    <section aria-labelledby={`${id}-title`} className={card} aria-busy={busy || undefined}>
      <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('failTitle')}
      </h3>
      <div className="mt-3 grid gap-3">
        <ReasonFields
          id={id}
          legend={t('failTitle')}
          codes={DELIVERY_FAIL_REASONS}
          label={(c) => fr(c)}
          value={reason}
          onChange={(c) => {
            setReason(c);
            setProblem(null);
          }}
          note={note}
          onNote={setNote}
          error={problem}
        />
        <PhotoCapture
          id={`${id}-photo`}
          label={job.photosRequired ? t('photoFailure') : t('photoOptional')}
          purpose="failure"
          upload={client.uploadPhoto}
          onMedia={setPhoto}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => void send()}
            className={bigPrimary}
          >
            {t('sendFail')}
          </button>
          <button
            type="button"
            data-panel-cancel={id}
            onClick={() => {
              setOpen(false);
              setProblem(null);
            }}
            className={bigQuiet}
          >
            {t('back')}
          </button>
        </div>
        {line}
      </div>
    </section>
  );
}

function GiveUp({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  const t = useTranslations('deliveryAgent');
  const gr = useTranslations('delivery.giveUpReason');
  const ctx = useAgent();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeliveryGiveUpReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<'reason' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  if (!ctx || job.status !== 'accepted') return null;
  const { client, errorText } = ctx;
  const id = `giveup-${job.jobId}`;

  async function send() {
    const p = reasonProblem(id, reason, note);
    setProblem(p);
    if (p || reason === '' || busy) return;
    setBusy(true);
    const res = await client.giveUp(job.jobId, reason, note.trim() || undefined, job.version);
    setBusy(false);
    track('click', { id: 'agent_job_given_up', path: window.location.pathname });
    if (!res.ok) {
      say(errorText(res.code), 'error');
      return;
    }
    say(t('gaveUp'));
    onChanged();
  }

  if (!open) {
    return (
      <button
        type="button"
        data-disclosure-trigger={id}
        onClick={() => {
          setOpen(true);
        }}
        className="min-h-12 text-sm font-bold text-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {t('giveUp')}
      </button>
    );
  }
  return (
    <section aria-label={t('giveUp')} className={card} aria-busy={busy || undefined}>
      <ReasonFields
        id={id}
        legend={t('giveUpWhy')}
        codes={DELIVERY_GIVE_UP_REASONS}
        label={(c) => gr(c)}
        value={reason}
        onChange={(c) => {
          setReason(c);
          setProblem(null);
        }}
        note={note}
        onNote={setNote}
        error={problem}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => void send()}
          className={bigPrimary}
        >
          {t('sendGiveUp')}
        </button>
        <button
          type="button"
          data-panel-cancel={id}
          onClick={() => {
            setOpen(false);
          }}
          className={bigQuiet}
        >
          {t('back')}
        </button>
      </div>
      <div className="mt-2">{line}</div>
    </section>
  );
}
