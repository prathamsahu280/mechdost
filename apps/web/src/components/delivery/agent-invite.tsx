'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { useSession } from '@/demo/session-state';
import { useHydrated } from '@/demo/store';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { formatDate } from '@/lib/format';
import type { AgentInvitePreviewView } from '@/lib/delivery/types';
import { useDeliveryErrorText } from './error-text';

const REAL = AUTH_MODE === 'firebase';
const primary =
  'press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-5 text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const Accepted: ResponseSchema<{ agentId: string }> = {
  safeParse: (v) =>
    isRec(v) && typeof v.agentId === 'string'
      ? { success: true, data: { agentId: v.agentId } }
      : { success: false },
};

async function loadPreview(token: string): Promise<AgentInvitePreviewView | null> {
  if (!TOKEN.test(token)) return null;
  if (!REAL) {
    const { previewInvite } = await import('@/demo/delivery-store');
    return previewInvite(token);
  }
  const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  try {
    const res = await fetch(`${API}/v1/delivery-invites/${token}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isRec(body) && typeof body.name === 'string' && typeof body.phoneLast4 === 'string'
      ? (body as AgentInvitePreviewView)
      : null;
  } catch {
    return null;
  }
}

/**
 * Delivery-agent invite (spec 24, Lead's call 10): the link from the email opens this page (the WhatsApp invite has no link: the person signs in with the invited mobile number, spec 24 § 16 G1); the person signs
 * in with the invited mobile number (phone OTP) and accepts, which links their account to the agent record. They then
 * upload their documents in the agent portal.
 */
export function AgentInvite({ token }: { token: string }) {
  const t = useTranslations('deliveryInvite');
  const ta = useTranslations('deliveryApply');
  const v = useTranslations('delivery.vehicle');
  const locale = useLocale();
  const hydrated = useHydrated();
  const session = useSession();
  const errorText = useDeliveryErrorText();
  const [preview, setPreview] = useState<AgentInvitePreviewView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    void loadPreview(token).then((p) => {
      if (live) setPreview(p);
    });
    return () => {
      live = false;
    };
  }, [token]);
  // Once per page view, after the invite is known to be valid (no token in the event).
  const opened = useRef(false);
  const signedIn = session !== null;
  useEffect(() => {
    if (!hydrated || !preview || opened.current) return;
    opened.current = true;
    track('delivery_invite_opened', { signedIn });
  }, [hydrated, preview, signedIn]);

  async function accept() {
    if (busy || !session) return;
    setBusy(true);
    let res: { ok: true } | { ok: false; code: string };
    if (REAL) {
      const r = await adminApi(locale, '/me/delivery-invites/accept', Accepted, {
        method: 'POST',
        body: { token },
      });
      res = r.ok ? { ok: true } : { ok: false, code: r.code };
    } else {
      const { acceptInvite } = await import('@/demo/delivery-store');
      const r = acceptInvite(token, session);
      res = r.ok ? { ok: true } : { ok: false, code: r.code };
    }
    setBusy(false);
    if (res.ok) track('delivery_invite_accepted', { withToken: true });
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    setDone(true);
    requestAnimationFrame(() => doneRef.current?.focus());
  }

  if (!hydrated || preview === undefined)
    return <div className="skeleton h-48 rounded-card" aria-hidden="true" />;
  if (done) {
    return (
      <div className="space-y-3">
        <h2 ref={doneRef} tabIndex={-1} className="font-heading text-xl font-extrabold text-ink">
          {t('acceptedTitle')}
        </h2>
        <p className="text-[15px] text-ink">{t('acceptedBody')}</p>
        <LocalLink href="/partner/delivery/profile" className={primary}>
          {t('openPortal')}
        </LocalLink>
      </div>
    );
  }
  if (!preview) return <p className="text-[15px] text-ink">{t('invalid')}</p>;
  const city = preview.cityCode === 'RPR' ? ta('city_RPR') : preview.cityCode;
  const prefix = locale === 'hi' ? '/hi' : '';
  const here = `${prefix}/partners/delivery-invite/${token}`;
  const otherAccount = session && session.role !== 'customer' && session.role !== 'delivery_agent';
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink">
        {t('body', { name: preview.name, city, vehicle: v(preview.vehicleType) })}
      </p>
      <p className="text-sm text-muted">{t('phoneNote', { last4: preview.phoneLast4 })}</p>
      <p className="text-sm text-muted">{t('validUntil', { date: formatDate(preview.expiresAt, locale) })}</p>
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      {!session ? (
        <Link href={`${prefix}/login?next=${encodeURIComponent(here)}`} className={primary}>
          {t('signIn')}
        </Link>
      ) : otherAccount ? (
        <p className="text-sm text-ink">{t('otherAccount')}</p>
      ) : (
        <button
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => void accept()}
          className={primary}
        >
          {busy ? t('accepting') : t('accept')}
        </button>
      )}
    </div>
  );
}
