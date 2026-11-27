'use client';

import {
  DELIVERY_SWITCH_DECLINE_REASONS,
  SHOP_MODE_REQUEST_REASONS,
  type DeliverySwitchDeclineReason,
  type ShopModeRequestReason,
} from '@mechdost/shared/delivery/codes';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { formatDate } from '@/lib/format';
import { track } from '@/lib/analytics';
import { useLiveReload, useShopDeliveryClient } from '@/lib/delivery/use-delivery-client';
import type { ShopDeliveryClient, ShopDeliveryModeViewT, ShopOrderDeliveryView } from '@/lib/delivery/types';
import { wrongCodeLeft } from '@/lib/delivery/view';
import { portalCard, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';
import { useDeliveryErrorText } from './error-text';
import { BigCode, CallSupport, CodeEntry, ReasonFields, reasonProblem } from './parts';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { useStatusLine } from './status-line';

/**
 * The agent part of one shop order card (spec 24, Lead's calls 3, 9): "Mark ready for pickup" (from packed), the pickup
 * code while an agent is on the way (with the agent's first name and vehicle), the return code entry when a parcel
 * comes back, and staff's request to deliver this order itself. Shown only for agent-mode sub-orders; a
 * self-delivering shop never sees it (its card is unchanged).
 */
export function ShopDeliveryPanel({
  orderCode,
  orderVersion,
  delivery,
  shopSlug,
  onChanged,
}: {
  orderCode: string;
  orderVersion: number;
  delivery: ShopOrderDeliveryView;
  /** Demo shop (the API scopes the shop from the person's grants). */
  shopSlug: string;
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryShop');
  const v = useTranslations('delivery.vehicle');
  const ta = useTranslations('deliveryAgent');
  const client = useShopDeliveryClient(shopSlug);
  const errorText = useDeliveryErrorText();
  const { say, line } = useStatusLine();
  const [busy, setBusy] = useState(false);
  if (!client) return <div className="skeleton mt-4 h-24 rounded-card" aria-hidden="true" />;
  const vehicle = delivery.vehicleType ? v(delivery.vehicleType) : '';

  async function markReady(c: ShopDeliveryClient) {
    if (busy) return;
    setBusy(true);
    const res = await c.markReady(orderCode, orderVersion);
    setBusy(false);
    if (res.ok) track('delivery_shop_ready_marked', {});
    if (res.ok) say(t('readyFlash'));
    else say(errorText(res.code), 'error');
    onChanged();
  }

  const status = delivery.jobStatus;
  return (
    <div className="mt-4 grid gap-3" aria-busy={busy || undefined}>
      {delivery.switchRequest ? (
        <SwitchCard
          orderCode={orderCode}
          request={delivery.switchRequest}
          client={client}
          onChanged={onChanged}
        />
      ) : null}
      {status === null ? (
        <>
          <p className="text-sm text-muted">{t('agentNote')}</p>
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => void markReady(client)}
            className={`${portalPrimary} min-h-12 w-full`}
          >
            {t('markReady')}
          </button>
        </>
      ) : null}
      {status === 'needs_agent' || status === 'offered' || status === 'accepted' ? (
        <div className="rounded-card border border-accent-button/50 bg-accent-soft p-4">
          <p role="status" className="text-base font-bold text-accent-soft-text">
            {status === 'accepted' && delivery.agentFirstName
              ? t.rich('agentComing', {
                  name: delivery.agentFirstName,
                  vehicle,
                  n: (c) => <span data-user-content>{c}</span>,
                })
              : t('waitingAgent')}
          </p>
          {delivery.pickupLocked ? (
            <>
              <p role="alert" className="mt-2 text-sm font-bold text-warning">
                {t('pickupLocked')}
              </p>
              <CallSupport label={ta('helpLabel')} />
            </>
          ) : delivery.pickupCode ? (
            <>
              <h4 className="mt-2 text-sm font-bold text-ink">{t('pickupCodeTitle')}</h4>
              <BigCode code={delivery.pickupCode} />
              <p className="text-sm text-ink">{t('pickupCodeHint')}</p>
            </>
          ) : null}
        </div>
      ) : null}
      {status === 'picked_up' || status === 'failed' ? (
        <p role="status" className="text-sm font-bold text-ink">
          {delivery.agentFirstName
            ? t.rich('pickedUp', {
                name: delivery.agentFirstName,
                vehicle,
                n: (c) => <span data-user-content>{c}</span>,
              })
            : t('outWithAgent')}
        </p>
      ) : null}
      {delivery.returning ? (
        <ReturnEntry orderCode={orderCode} client={client} onChanged={onChanged} />
      ) : null}
      {line}
    </div>
  );
}

function ReturnEntry({
  orderCode,
  client,
  onChanged,
}: {
  orderCode: string;
  client: ShopDeliveryClient;
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryShop');
  const [locked, setLocked] = useState<string | null>(null);
  const e = useTranslations('delivery.errors');
  const errorText = useDeliveryErrorText();
  return (
    <section
      aria-labelledby={`return-${orderCode}`}
      className="rounded-card border border-warning bg-warning-bg p-4"
    >
      <h4 id={`return-${orderCode}`} className="font-bold text-warning">
        {t('returningTitle')}
      </h4>
      <div className="mt-2">
        <CodeEntry
          id={`return-code-${orderCode}`}
          label={t('returnCodeLabel')}
          hint={t('returnCodeHint')}
          submitLabel={t('returnConfirm')}
          locked={locked}
          onCode={async (code) => {
            const res = await client.returnReceived(orderCode, code);
            track('delivery_shop_return_confirmed', { ok: res.ok });
            if (res.ok) {
              onChanged();
              return null;
            }
            const left = wrongCodeLeft(res.code);
            if (left === 0 || res.code === 'CODE_LOCKED') {
              setLocked(e('CODE_LOCKED'));
              return null;
            }
            if (left !== null) return t('returnWrong', { left });
            return errorText(res.code);
          }}
        />
      </div>
    </section>
  );
}

function SwitchCard({
  orderCode,
  request,
  client,
  onChanged,
}: {
  orderCode: string;
  request: NonNullable<ShopOrderDeliveryView['switchRequest']>;
  client: ShopDeliveryClient;
  onChanged: () => void;
}) {
  const t = useTranslations('deliveryShop');
  const sr = useTranslations('delivery.switchReason');
  const dr = useTranslations('delivery.switchDeclineReason');
  const errorText = useDeliveryErrorText();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeliverySwitchDeclineReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<'reason' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  const id = `switch-${request.id}`;
  useDisclosureFocus(declining ? id : null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const res = await client.confirmSwitch(orderCode, request.id, request.version);
    setBusy(false);
    if (res.ok) track('delivery_shop_switch_answered', { decision: 'confirmed' });
    if (res.ok) say(t('switchConfirmed'));
    else say(errorText(res.code), 'error');
    onChanged();
  }
  async function decline() {
    const p = reasonProblem(id, reason, note);
    setProblem(p);
    if (p || reason === '' || busy) return;
    setBusy(true);
    const res = await client.declineSwitch(
      orderCode,
      request.id,
      reason,
      note.trim() || undefined,
      request.version,
    );
    setBusy(false);
    if (res.ok) track('delivery_shop_switch_answered', { decision: 'declined' });
    if (res.ok) say(t('switchDeclined'));
    else say(errorText(res.code), 'error');
    onChanged();
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-card border border-accent-button bg-surface p-4"
    >
      <h4 id={`${id}-title`} className="font-heading text-base font-extrabold text-ink">
        {t('switchTitle')}
      </h4>
      <p className="mt-1 text-sm text-ink">{t('switchBody', { reason: sr(request.reasonCode) })}</p>
      {declining ? (
        <div className="mt-3 grid gap-3">
          <ReasonFields
            id={id}
            legend={t('switchDeclineWhy')}
            codes={DELIVERY_SWITCH_DECLINE_REASONS}
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void decline()}
              className={`${portalPrimary} min-h-12`}
            >
              {t('switchSendDecline')}
            </button>
            <button
              type="button"
              data-panel-cancel={id}
              onClick={() => {
                setDeclining(false);
              }}
              className={`${portalQuiet} min-h-12`}
            >
              {t('switchDecline')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => void confirm()}
            className={`${portalPrimary} min-h-12 flex-1`}
          >
            {t('switchConfirm')}
          </button>
          <button
            type="button"
            data-disclosure-trigger={id}
            onClick={() => {
              setDeclining(true);
            }}
            className={`${portalQuiet} min-h-12`}
          >
            {t('switchDecline')}
          </button>
        </div>
      )}
      <div className="mt-2">{line}</div>
    </section>
  );
}

/**
 * "Who delivers your orders" (spec 24, Lead's call 3): the shop's mode, its requests with their status and reason, and
 * one request at a time to change (owner only). Admin approves in Admin → Delivery → Shop requests.
 */
export function ShopDeliveryModeCard({ shopId, isOwner }: { shopId: string; isOwner: boolean }) {
  const t = useTranslations('deliveryShop');
  const sm = useTranslations('delivery.shopModeRequestStatus');
  const rr = useTranslations('delivery.shopModeRequestReason');
  const rj = useTranslations('delivery.shopModeRejectReason');
  const ta = useTranslations('deliveryAgent');
  const locale = useLocale();
  const client = useShopDeliveryClient(shopId);
  const errorText = useDeliveryErrorText();
  const [view, setView] = useState<ShopDeliveryModeViewT | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ShopModeRequestReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<'reason' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  const reload = useCallback(() => {
    if (!client) return;
    void client.modeView(shopId).then((r) => {
      if (r.ok) setView(r.data);
    });
  }, [client, shopId]);
  useLiveReload(client, reload, 60_000);
  useDisclosureFocus(open ? `shop-mode-${shopId}` : null);
  if (!client || !view) return null;
  const c = client;
  const pending = view.requests.find((r) => r.status === 'pending') ?? null;
  const target = view.mode === 'agents' ? 'self' : 'agents';
  const id = `shop-mode-${shopId}`;

  async function send() {
    const p = reasonProblem(id, reason, note);
    setProblem(p);
    if (p || reason === '' || busy) return;
    setBusy(true);
    const res = await c.requestMode(shopId, target, reason, note.trim() || undefined);
    setBusy(false);
    if (res.ok) track('delivery_shop_mode_requested', { mode: target });
    if (res.ok) {
      say(t('requestSent'));
      setOpen(false);
      setReason('');
      setNote('');
    } else say(errorText(res.code), 'error');
    reload();
  }
  async function withdraw(requestId: string) {
    if (busy) return;
    setBusy(true);
    const res = await c.withdrawMode(shopId, requestId);
    setBusy(false);
    track('click', { id: 'shop_mode_request_withdrawn', path: window.location.pathname });
    if (res.ok) say(t('withdrawn'));
    else say(errorText(res.code), 'error');
    reload();
  }

  return (
    <section aria-labelledby={`${id}-title`} className={portalCard} aria-busy={busy || undefined}>
      <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('modeTitle')}
      </h3>
      <p className="mt-1 text-sm text-ink">
        {!view.agentsEnabled ? t('modeAgentsOff') : view.mode === 'agents' ? t('modeAgents') : t('modeSelf')}
      </p>
      {pending ? (
        <div className="mt-3 rounded-button bg-pill p-3 text-sm text-ink">
          <p>{t('requestPending', { date: formatDate(pending.createdAt, locale) })}</p>
          {isOwner ? (
            <button type="button" onClick={() => void withdraw(pending.id)} className={`${portalQuiet} mt-2`}>
              {t('withdraw')}
            </button>
          ) : null}
        </div>
      ) : view.agentsEnabled && isOwner ? (
        open ? (
          <div className="mt-3 grid gap-3">
            <ReasonFields
              id={id}
              legend={t('requestWhy')}
              codes={SHOP_MODE_REQUEST_REASONS}
              label={(x) => rr(x)}
              value={reason}
              onChange={(x) => {
                setReason(x);
                setProblem(null);
              }}
              note={note}
              onNote={setNote}
              error={problem}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void send()} className={`${portalPrimary} min-h-12`}>
                {t('sendRequest')}
              </button>
              <button
                type="button"
                data-panel-cancel={id}
                onClick={() => {
                  setOpen(false);
                }}
                className={`${portalQuiet} min-h-12`}
              >
                {ta('back')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-disclosure-trigger={id}
            onClick={() => {
              setOpen(true);
            }}
            className={`${portalQuiet} mt-3 min-h-12`}
          >
            {target === 'self' ? t('requestSelf') : t('requestAgents')}
          </button>
        )
      ) : !isOwner ? (
        <p className="mt-2 text-xs text-muted">{t('ownerOnly')}</p>
      ) : null}
      {view.requests.some((r) => r.status !== 'pending') ? (
        <details className="mt-3 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-bold text-ink">{t('earlier')}</summary>
          <ul className="grid gap-1">
            {view.requests
              .filter((r) => r.status !== 'pending')
              .map((r) => (
                <li key={r.id} className="text-ink">
                  {t('requestRow', { date: formatDate(r.createdAt, locale), status: sm(r.status) })}
                  {r.status === 'rejected' && r.decisionReason
                    ? ` · ${t('requestRejected', { reason: rj(r.decisionReason) })}`
                    : ''}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-2">{line}</div>
    </section>
  );
}
