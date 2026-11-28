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
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { StepRail } from '@/components/partner';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { useLiveReload } from '@/lib/delivery/use-delivery-client';
import type { AgentJobDetailView } from '@/lib/delivery/types';
import { agentStep, mapsHref, telNumber } from '@/lib/delivery/view';
import { useAgent } from './agent-portal';
import {
  BigCode,
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

/** "I'm at the shop / customer" is the agent's own tap: kept on this device (local storage, per job and status). */
function useArrived(jobId: string, status: string): [boolean, (v: boolean) => void] {
  const key = `mechdost-agent-arrived-${jobId}-${status}`;
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    try {
      setArrived(window.localStorage.getItem(key) === '1');
    } catch {
      setArrived(false);
    }
  }, [key]);
  const set = (v: boolean) => {
    setArrived(v);
    try {
      window.localStorage.setItem(key, v ? '1' : '0');
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

function JobBody({ job, onChanged: reload }: { job: AgentJobDetailView; onChanged: () => void }) {
  const t = useTranslations('deliveryAgent');
  const [arrived, setArrivedRaw] = useArrived(job.jobId, job.status);
  const step = agentStep(job.status, arrived);
  const heading = useRef<HTMLHeadingElement>(null);
  // The step heading takes focus after the rider's own action, or on arrival from Accept (`?accepted=1`); a change
  // that came from a background refresh is announced instead and leaves focus where the rider is typing (2.4.3).
  const ownAction = useRef(false);
  const { say, line } = useStatusLine();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const key = `${String(step)}|${job.status}`;
    const before = shown.current;
    shown.current = key;
    if (before === null) {
      if (new URLSearchParams(window.location.search).get('accepted') === '1') heading.current?.focus();
      return;
    }
    if (before === key) return;
    if (ownAction.current) {
      ownAction.current = false;
      heading.current?.focus();
    } else say(t('jobChanged', { status: heading.current?.textContent ?? '' }));
    // Runs again when `say`/`t` change identity too; the key comparison above makes that a no-op.
  }, [step, job.status, say, t]);
  const onChanged = () => {
    ownAction.current = true;
    reload();
  };
  const setArrived = (v: boolean) => {
    ownAction.current = true;
    setArrivedRaw(v);
  };

  return (
    <article aria-labelledby="job-step-title" className="grid gap-4">
      {line}
      <div>
        <p className="text-sm font-bold text-muted">{t('jobTitle', { code: job.orderCode })}</p>
        {step ? (
          <>
            <JobStepRail step={step} />
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
            track('delivery_job_step', { step: 'at_shop', ok: true });
          }}
        >
          {t('atShop')}
        </button>
      ) : null}
      {step === 2 ? <PickupStep job={job} onChanged={onChanged} /> : null}
      {step === 1 || step === 2 ? <GiveUp job={job} onChanged={onChanged} onSay={say} /> : null}

      {step === 3 ? (
        <button
          type="button"
          className={`${bigPrimary} w-full`}
          onClick={() => {
            setArrived(true);
            track('delivery_job_step', { step: 'at_customer', ok: true });
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
          <BigCode code={job.returnCode} />
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

/**
 * The four steps of a job as the shared rail (design 2026-11-27 § 7): Go to the shop, Pick up, Go to the customer,
 * Hand over. The step follows the job's real state (`accepted` → `picked_up`) and the rider's own "I'm there" tap
 * (`agentStep`); the rail says "Step n of 4: name" in words and marks the current step `aria-current="step"`.
 */
function JobStepRail({ step }: { step: 1 | 2 | 3 | 4 }) {
  const t = useTranslations('deliveryAgent');
  const names = [t('step_shop'), t('step_pickup'), t('step_customer'), t('step_deliver')];
  return (
    <div className="mt-2">
      <StepRail label={t('stepsLabel')} steps={names} current={step - 1} />
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
          href={`tel:${telNumber(shop.phone)}`}
          className={linkBtn}
          onClick={() => {
            track('delivery_contact_tapped', { target: 'shop', action: 'call' });
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
            track('delivery_contact_tapped', { target: 'shop', action: 'maps' });
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
                href={`tel:${telNumber(c.phone)}`}
                className={linkBtn}
                onClick={() => {
                  track('delivery_contact_tapped', { target: 'customer', action: 'call' });
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
                track('delivery_contact_tapped', { target: 'customer', action: 'maps' });
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

/**
 * One code step (pickup: the shop's code + a parcel photo; delivery: the customer's code + a handover photo). The photo
 * comes first and a required one holds the code until it is taken; a locked code keeps the screen with the message
 * and a call-support link (a11y review 2026-11-27).
 */
function CodeStep({
  job,
  kind,
  onChanged,
}: {
  job: AgentJobDetailView;
  kind: 'pickup' | 'delivery';
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryAgent');
  const e = useTranslations('delivery.errors');
  const ctx = useAgent();
  const [photo, setPhoto] = useState<string | null>(null);
  if (!ctx) return null;
  const { client, errorText } = ctx;
  const pickup = kind === 'pickup';
  const photoId = `${kind}-photo-${job.jobId}`;
  const locked = pickup ? job.pickupLocked : job.deliveryLocked;
  return (
    <div className={card}>
      <CodeEntry
        id={`${kind}-code-${job.jobId}`}
        label={pickup ? t('pickupCodeLabel') : t('deliveryCodeLabel')}
        hint={pickup ? t('pickupCodeHint') : t('deliveryCodeHint')}
        submitLabel={pickup ? t('confirmPickup') : t('confirmDelivery')}
        ready={!job.photosRequired || photo !== null}
        notReadyText={e('PHOTO_REQUIRED')}
        notReadyFocus={photoId}
        locked={locked ? e('CODE_LOCKED') : null}
        onCode={async (code) => {
          const res = pickup
            ? await client.pickup(job.jobId, code, photo ?? undefined, job.version)
            : await client.deliver(job.jobId, code, photo ?? undefined, job.version);
          if (!res.ok) return errorText(res.code);
          onChanged();
          track('delivery_job_step', { step: pickup ? 'pickup' : 'deliver', ok: res.data.ok });
          if (res.data.ok) return null;
          return res.data.locked ? e('CODE_LOCKED') : t('wrongCode', { left: res.data.attemptsLeft });
        }}
        before={
          <PhotoCapture
            id={photoId}
            label={job.photosRequired ? (pickup ? t('photoPickup') : t('photoDelivery')) : t('photoOptional')}
            hint={pickup ? t('photoPickupHint') : t('photoFirst')}
            purpose={kind}
            upload={(file, purpose) => client.uploadPhoto(file, purpose, job.jobId)}
            onMedia={setPhoto}
          />
        }
      />
    </div>
  );
}

function PickupStep({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  return <CodeStep job={job} kind="pickup" onChanged={onChanged} />;
}

function DeliverStep({ job, onChanged }: { job: AgentJobDetailView; onChanged: () => void }) {
  return <CodeStep job={job} kind="delivery" onChanged={onChanged} />;
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
  useDisclosureFocus(open ? `fail-${job.jobId}` : null);
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
    track('delivery_job_step', { step: 'fail', ok: res.ok, reasonCode: reason });
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
          upload={(file, purpose) => client.uploadPhoto(file, purpose, job.jobId)}
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

function GiveUp({
  job,
  onChanged,
  onSay,
}: {
  job: AgentJobDetailView;
  onChanged: () => void;
  /** The job screen's status line (this form leaves the screen once the job is given up). */
  onSay: (text: string) => void;
}) {
  const t = useTranslations('deliveryAgent');
  const gr = useTranslations('delivery.giveUpReason');
  const ctx = useAgent();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeliveryGiveUpReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<'reason' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  useDisclosureFocus(open ? `giveup-${job.jobId}` : null);
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
    track('delivery_job_step', { step: 'give_up', ok: res.ok });
    if (!res.ok) {
      say(errorText(res.code), 'error');
      return;
    }
    onSay(t('gaveUp'));
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
    <div className={card} aria-busy={busy || undefined}>
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
    </div>
  );
}
