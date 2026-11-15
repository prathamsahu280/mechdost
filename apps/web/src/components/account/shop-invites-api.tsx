'use client';

import { MyShopInvites, ShopInviteAccepted, ShopTeamOk } from '@mechdost/shared/shop-team';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { tier1ErrorKey } from '@/lib/shop-tier1';
import { portalCard, portalPrimary, portalQuiet } from '../portal/portal-styles';
import { FlashNote, useFlash } from '../portal/shop-flash';

type Invite = ReturnType<(typeof MyShopInvites)['parse']>['invites'][number];

/**
 * "Join {shop} as staff?" (security review 2026-11-15): a shop owner's invite never grants anything on sign-in. The
 * person it names (by verified phone) reads it in their account and accepts or declines. Renders nothing when there is
 * no invite. Real sign-in only; own module, loaded lazily on the account overview.
 */
export function ShopInviteCard() {
  const t = useTranslations('shopTier1');
  const locale = useLocale();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { flash, show } = useFlash();

  const reload = useCallback(async () => {
    const res = await adminApi(locale, '/me/shop-invites', MyShopInvites);
    if (res.ok) setInvites(res.data.invites);
  }, [locale]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function answer(invite: Invite, accept: boolean) {
    setWorking(true);
    setError(null);
    const name = locale === 'hi' && invite.shopNameHi ? invite.shopNameHi : invite.shopName;
    const res = accept
      ? await adminApi(locale, `/me/shop-invites/${invite.id}/accept`, ShopInviteAccepted, { method: 'POST' })
      : await adminApi(locale, `/me/shop-invites/${invite.id}/decline`, ShopTeamOk, { method: 'POST' });
    setWorking(false);
    if (!res.ok) {
      setError(res.code);
      await reload();
      return;
    }
    track('click', {
      id: accept ? 'shop_team_invite_accepted' : 'shop_team_invite_declined',
      path: window.location.pathname,
    });
    show({ tone: 'ok', text: accept ? t('inviteAccepted', { shop: name }) : t('inviteDeclined') });
    await reload();
  }

  if (invites.length === 0 && !flash) return null;
  return (
    <section aria-label={t('inviteAccept')} className="space-y-3">
      {invites.map((i) => {
        const shop = locale === 'hi' && i.shopNameHi ? i.shopNameHi : i.shopName;
        return (
          <article key={i.id} className={portalCard} aria-busy={working || undefined}>
            <h2 className="font-heading text-lg font-extrabold text-ink">
              <span data-user-content>{t('inviteTitle', { shop })}</span>
            </h2>
            <p className="mt-1 text-sm text-ink">{t('inviteBody', { name: i.invitedAs })}</p>
            <p className="mt-1 text-xs text-muted">
              {t('inviteUntil', { date: formatDate(i.expiresAt, locale) })}
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm font-bold text-error">
                {t(tier1ErrorKey(error))}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={working}
                onClick={() => void answer(i, true)}
                className={portalPrimary}
              >
                {t('inviteAccept')}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => void answer(i, false)}
                className={portalQuiet}
              >
                {t('inviteDecline')}
              </button>
            </div>
          </article>
        );
      })}
      <FlashNote flash={flash} />
    </section>
  );
}
