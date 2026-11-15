'use client';

import { ShopInviteSaved, ShopTeam, ShopTeamOk, type ShopTeamDto } from '@mechdost/shared/shop-team';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { isValidIndianMobile, isValidStaffName, tier1ErrorKey } from '@/lib/shop-tier1';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { FlashNote, useFlash } from './shop-flash';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; team: ShopTeamDto };

/**
 * "Your team" (design 2026-11-15, spec 07/13), owner only: who works for the shop, invites still waiting, add a person
 * by phone and name, cancel an invite, remove a member (inline confirm, no modal). The API refuses everyone but the
 * owner; the owner's shop id comes from the profile, never from the address bar. Real API mode only; own module.
 */
export function ShopTeamApi({ shopId }: { shopId: string }) {
  const t = useTranslations('shopTier1');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { flash, show } = useFlash();
  const id = `shop-team-${shopId}`;

  const reload = useCallback(async () => {
    const res = await adminApi(locale, `/shop/team/${shopId}`, ShopTeam);
    setLoad(res.ok ? { kind: 'ok', team: res.data } : { kind: 'error', code: res.code });
  }, [locale, shopId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(path: string, method: 'DELETE', done: string, clickId: string) {
    setWorking(true);
    setError(null);
    const res = await adminApi(locale, path, ShopTeamOk, { method });
    setWorking(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: clickId, path: window.location.pathname });
    setRemoving(null);
    show({ tone: 'ok', text: done });
    await reload();
  }

  const team = load.kind === 'ok' ? load.team : null;
  const used = team ? team.members.length + team.invites.length : 0;
  const full = team ? used >= team.max : false;

  return (
    <section aria-labelledby={`${id}-title`} id="shop-team" className={portalCard}>
      <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('teamTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('teamLead')}</p>
      {load.kind === 'loading' ? <p className="mt-3 text-sm text-muted">{t('teamLoading')}</p> : null}
      {load.kind === 'error' ? (
        <p role="alert" className="mt-3 text-sm font-bold text-error">
          {t(tier1ErrorKey(load.code))}
        </p>
      ) : null}
      {team ? (
        <>
          <p className="mt-3 text-xs font-bold text-muted tabular-nums">
            {t('teamCount', { count: used, max: team.max })}
          </p>
          <ul className="mt-2 divide-y divide-line text-sm">
            {team.members.map((m) => {
              const name = m.name ?? t('teamUnnamed');
              return (
                <li key={m.userId} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 text-ink">
                      <span data-user-content className="font-bold">
                        {name}
                      </span>
                      {m.isYou ? <span className="text-muted"> ({t('teamYou')})</span> : null}
                      {m.phoneLast4 ? (
                        <span className="block text-xs text-muted">
                          {t('teamPhoneEnd', { last4: m.phoneLast4 })}
                        </span>
                      ) : null}
                    </p>
                    <span className="rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
                      {m.role === 'owner' ? t('teamOwner') : t('teamStaff')}
                    </span>
                  </div>
                  {m.role === 'staff' ? (
                    removing === m.userId ? (
                      <div className="mt-2 rounded-lg bg-pill p-3">
                        <p className="text-sm text-ink">{t('teamRemoveAsk', { name })}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={working}
                            onClick={() =>
                              void act(
                                `/shop/team/${shopId}/members/${m.userId}`,
                                'DELETE',
                                t('teamRemoved'),
                                'shop_team_member_removed',
                              )
                            }
                            className={portalPrimary}
                          >
                            {t('teamRemoveYes')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRemoving(null);
                            }}
                            className={portalQuiet}
                          >
                            {t('teamRemoveKeep')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setRemoving(m.userId);
                          setError(null);
                        }}
                        className={`${portalQuiet} mt-2`}
                      >
                        {t('teamRemove')}
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
            {team.invites.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-ink">
                    <span data-user-content className="font-bold">
                      {i.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('teamPhoneEnd', { last4: i.phoneLast4 })} ·{' '}
                      {t('teamPendingUntil', { date: formatDate(i.expiresAt, locale) })}
                    </span>
                  </p>
                  <span className="rounded-pill bg-warning-bg px-3 py-1 text-xs font-extrabold text-warning">
                    {t('teamPending')}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void act(
                      `/shop/team/${shopId}/invites/${i.id}`,
                      'DELETE',
                      t('teamCancelled'),
                      'shop_team_invite_cancelled',
                    )
                  }
                  className={`${portalQuiet} mt-2`}
                >
                  {t('teamCancel')}
                </button>
              </li>
            ))}
          </ul>
          {team.members.length + team.invites.length <= 1 ? (
            <p className="mt-2 text-sm text-muted">{t('teamOnlyYou')}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm font-bold text-error">
              {t(tier1ErrorKey(error))}
            </p>
          ) : null}
          {full ? (
            <p className="mt-3 text-sm text-muted">{t('teamFull', { max: team.max })}</p>
          ) : adding ? (
            <InviteForm
              shopId={shopId}
              onDone={async (name) => {
                setAdding(false);
                show({ tone: 'ok', text: t('teamInvited', { name }) });
                await reload();
              }}
              onCancel={() => {
                setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setError(null);
              }}
              className={`${portalPrimary} mt-3`}
            >
              {t('teamAdd')}
            </button>
          )}
        </>
      ) : null}
      <div className="mt-3">
        <FlashNote flash={flash} />
      </div>
    </section>
  );
}

function InviteForm({
  shopId,
  onDone,
  onCancel,
}: {
  shopId: string;
  onDone: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('shopTier1');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bad, setBad] = useState<{ name?: boolean; phone?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const id = `invite-${shopId}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = { name: !isValidStaffName(name), phone: !isValidIndianMobile(phone) };
    if (next.name || next.phone) {
      setBad(next);
      document.getElementById(next.name ? `${id}-name` : `${id}-phone`)?.focus();
      return;
    }
    setWorking(true);
    const res = await adminApi(locale, `/shop/team/${shopId}/invites`, ShopInviteSaved, {
      method: 'POST',
      body: { name: name.trim(), phone: phone.trim() },
    });
    setWorking(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: 'shop_team_invited', path: window.location.pathname });
    await onDone(name.trim());
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={working || undefined}
      className="mt-3 space-y-3"
    >
      <div>
        <label htmlFor={`${id}-name`} className="text-sm font-bold text-ink">
          {t('teamName')}
        </label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={60}
          autoComplete="off"
          aria-invalid={bad.name ? true : undefined}
          aria-describedby={bad.name ? `${id}-name-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setBad((b) => ({ ...b, name: false }));
          }}
          className={portalField}
        />
        {bad.name ? (
          <p id={`${id}-name-error`} className="mt-1 text-xs font-bold text-error">
            {t('teamNameRequired')}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor={`${id}-phone`} className="text-sm font-bold text-ink">
          {t('teamPhone')}
        </label>
        <input
          id={`${id}-phone`}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={phone}
          aria-invalid={bad.phone ? true : undefined}
          aria-describedby={bad.phone ? `${id}-phone-error` : `${id}-phone-hint`}
          onChange={(e) => {
            setPhone(e.target.value);
            setBad((b) => ({ ...b, phone: false }));
          }}
          className={portalField}
        />
        <p id={`${id}-phone-hint`} className="mt-1 text-xs text-muted">
          {t('teamPhoneHint')}
        </p>
        {bad.phone ? (
          <p id={`${id}-phone-error`} className="mt-1 text-xs font-bold text-error">
            {t('teamPhoneInvalid')}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(tier1ErrorKey(error))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={working} className={portalPrimary}>
          {t('teamSend')}
        </button>
        <button type="button" onClick={onCancel} className={portalQuiet}>
          {t('teamFormCancel')}
        </button>
      </div>
    </form>
  );
}
