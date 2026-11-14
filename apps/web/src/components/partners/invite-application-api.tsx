'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { OpenInviteDto } from '@mechdost/shared/partner-api';
import { fetchInvite } from '@/lib/partner-public-api';
import { applyErrorView, maskedPhone, type ApplyFormError } from '@/lib/partner-onboarding-view';
import { SellerApplicationForm } from './seller-application-form';

/**
 * The invite link in real sign-in builds (`GET /v1/partner-invites/{token}`): an open invite shows the seller form
 * with name and email locked and the mobile number masked (the API keeps the full number); a used, expired,
 * withdrawn or unknown link says what to do next. Loaded only when AUTH_MODE is firebase (invite-application.tsx).
 */
export function InviteApplicationApi({ token }: { token: string }) {
  const t = useTranslations('apply');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'open'; invite: OpenInviteDto } | { kind: 'closed'; key: ApplyFormError }
  >({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void fetchInvite(token).then((res) => {
      if (!live) return;
      if (res.ok) setState({ kind: 'open', invite: res.invite });
      else setState({ kind: 'closed', key: applyErrorView(res.code).form ?? 'api_errGeneric' });
    });
    return () => {
      live = false;
    };
  }, [token]);

  if (state.kind === 'loading')
    return (
      <p role="status" className="text-sm text-muted">
        {t('api_loading')}
      </p>
    );
  if (state.kind === 'closed')
    return (
      <p role="status" className="text-sm text-ink">
        {t(state.key)}
      </p>
    );
  return (
    <SellerApplicationForm
      invite={{
        token,
        name: state.invite.name,
        email: state.invite.email,
        phone: maskedPhone(state.invite.phoneLast4),
        phoneMasked: true,
      }}
    />
  );
}
