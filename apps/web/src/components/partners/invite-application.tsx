'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { findInvite, useInvites } from '@/demo/store';
import { SellerApplicationForm } from './seller-application-form';

const subscribe = () => () => undefined;

/**
 * The invite link (demo of `GET /v1/partner-invites/{token}`): an open invite shows the seller form with the
 * invited name, email and mobile number locked; a used, expired, withdrawn or unknown link says what to do next.
 */
export function InviteApplication({ token }: { token: string }) {
  const t = useTranslations('apply');
  useInvites(); // re-render when invites change
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!hydrated) return null;
  const invite = findInvite(token);
  if (invite === null)
    return (
      <p role="status" className="text-sm text-ink">
        {t('inviteNotFound')}
      </p>
    );
  if (invite === 'used')
    return (
      <p role="status" className="text-sm text-ink">
        {t('inviteUsed')}
      </p>
    );
  if (invite === 'expired')
    return (
      <p role="status" className="text-sm text-ink">
        {t('inviteExpired')}
      </p>
    );
  if (invite === 'revoked')
    return (
      <p role="status" className="text-sm text-ink">
        {t('inviteRevoked')}
      </p>
    );
  return (
    <SellerApplicationForm
      invite={{ token: invite.token, name: invite.name, email: invite.email, phone: invite.phone }}
    />
  );
}
