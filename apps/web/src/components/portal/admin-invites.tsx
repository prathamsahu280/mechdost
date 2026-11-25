'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { InviteSchema } from '@mechdost/shared/partners';
import { type DemoInvite } from '@/demo/store';
import { createInvite, revokeInvite, useInvites } from '@/demo/partner-store';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { formatDate } from '@/lib/format';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

type Field = 'name' | 'email' | 'phone';
const FIELDS: Field[] = ['name', 'email', 'phone'];

/**
 * Invite a seller (user 2026-11-13, design § Invites): the admin enters name, email and mobile number and gets a
 * one-time link; the seller's contacts count as verified and the seller fills in GST, address and products.
 * Demo store until the admin console calls `POST /v1/admin/partner-invites` (data switch; the API also emails
 * the link from noreply@).
 */
export function AdminInvites() {
  return AUTH_MODE === 'firebase' ? <InvitesApi /> : <DemoAdminInvites />;
}

/** Real sign-in builds: `/v1/admin/partner-invites`, loaded only then. */
const InvitesApi = dynamic(() => import('./admin-onboarding-api').then((m) => m.InvitesApi), { ssr: false });

function DemoAdminInvites() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const invites = useInvites();
  const [errors, setErrors] = useState<Partial<Record<Field, true>>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const linkOf = (i: DemoInvite) => `${locale === 'hi' ? '/hi' : ''}/partners/invite/${i.token}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const value = (k: Field) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const parsed = InviteSchema.safeParse({
      name: value('name'),
      email: value('email'),
      phone: value('phone'),
    });
    if (!parsed.success) {
      const bad = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')));
      const next: Partial<Record<Field, true>> = {};
      for (const f of FIELDS) if (bad.has(f)) next[f] = true;
      setErrors(next);
      const first = FIELDS.find((f) => next[f]);
      if (first) document.getElementById(`invite-${first}`)?.focus();
      return;
    }
    setErrors({});
    createInvite({ ...parsed.data, phone: parsed.data.phone.replace(/^\+91/, '') });
    track('click', { id: 'admin_invite_created', path: window.location.pathname });
    form.reset();
  }

  async function copy(i: DemoInvite) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${linkOf(i)}`);
      setCopied(i.token);
    } catch {
      setCopied(null);
    }
  }

  const message: Record<Field, string> = {
    name: t('inviteErrName'),
    email: t('inviteErrEmail'),
    phone: t('inviteErrPhone'),
  };
  const label: Record<Field, string> = {
    name: t('inviteName'),
    email: t('inviteEmail'),
    phone: t('invitePhone'),
  };

  return (
    <section aria-labelledby="invites-title" className={adminCard}>
      <h3 id="invites-title" className="font-heading text-lg font-extrabold text-ink">
        {t('invitesTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('invitesLead')}</p>

      <form noValidate onSubmit={onSubmit} className="mt-4 grid gap-3 min-[600px]:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f}>
            <label htmlFor={`invite-${f}`} className="text-sm font-bold text-ink">
              {label[f]}
            </label>
            <input
              id={`invite-${f}`}
              name={f}
              type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
              inputMode={f === 'phone' ? 'numeric' : undefined}
              autoComplete="off"
              maxLength={f === 'email' ? 120 : f === 'phone' ? 14 : 80}
              aria-invalid={errors[f] ? true : undefined}
              aria-describedby={errors[f] ? `invite-${f}-error` : undefined}
              className={`${portalField} mt-1 w-full`}
            />
            {errors[f] ? (
              <p id={`invite-${f}-error`} className="mt-1 text-xs font-bold text-error">
                {message[f]}
              </p>
            ) : null}
          </div>
        ))}
        <div className="min-[600px]:col-span-3">
          <button type="submit" className={portalPrimary}>
            {t('inviteCreate')}
          </button>
        </div>
      </form>

      {invites.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t('invitesEmpty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line-card">
          {invites.map((i) => {
            const expired = i.status === 'sent' && Date.parse(i.expiresAt) <= Date.now();
            const status = expired ? 'expired' : i.status;
            return (
              <li key={i.token} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="text-sm">
                  <p data-user-content className="font-bold text-ink">
                    {i.name}
                  </p>
                  <p className="text-muted">
                    {t(`inviteStatus_${status}`)} ·{' '}
                    {t('inviteUntil', { date: formatDate(i.expiresAt, locale) })}
                  </p>
                </div>
                {status === 'sent' ? (
                  <div className="flex flex-wrap gap-2">
                    <Link href={linkOf(i)} className={portalQuiet}>
                      {t('inviteOpen')}
                    </Link>
                    <button type="button" onClick={() => void copy(i)} className={portalQuiet}>
                      {copied === i.token ? t('inviteCopied') : t('inviteCopy')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        revokeInvite(i.token);
                        track('click', { id: 'admin_invite_revoked', path: window.location.pathname });
                      }}
                      className={portalQuiet}
                    >
                      {t('inviteRevoke')}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
