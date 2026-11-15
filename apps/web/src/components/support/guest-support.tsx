'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { GUEST_BODY_MAX, GUEST_TICKET_KINDS } from '@mechdost/shared/support-guest';
import type { SupportTicketDto } from '@mechdost/shared/support-api';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { threadFromApi } from '@/lib/support-view';
import { TicketThread, useTicketLabels } from './ticket-thread';

type Thread = SupportTicketDto;
const TURNSTILE_ID = 'guest-support-turnstile';
const KNOWN = [
  'GUEST_DAILY_LIMIT',
  'GUEST_PHONE_INVALID',
  'TURNSTILE_FAILED',
  'NOT_FOUND',
  'TICKET_CLOSED',
  'REPLY_LIMIT',
  'RATE_LIMITED',
  'VALIDATION',
] as const;
const errorKey = (code: string) => KNOWN.find((k) => k === code) ?? 'GENERIC';

/** A form field as text (files and missing fields read as the fallback). */
function formText(data: FormData, name: string, fallback = ''): string {
  const v = data.get(name);
  return typeof v === 'string' ? v : fallback;
}

const field =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
const primary =
  'press min-h-11 rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
const quiet =
  'press min-h-11 rounded-button border border-line-card bg-surface px-5 text-sm font-bold text-ink';

/**
 * Support without an account (design 2026-11-15 item 6; spec 09): a short form (name, mobile number, topic, message,
 * Turnstile) that returns a reference and a private key shown once, and a "check a request" form that opens the
 * conversation with the reference and key only. Nothing is sent to the number typed: the key is the way back. Real
 * sign-in builds only (the API does the checks); the demo build shows a note.
 */
export function GuestSupport() {
  const t = useTranslations('supportGuest');
  const locale = useLocale();
  const labels = useTicketLabels();
  const [challenge, setChallenge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; accessKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [thread, setThread] = useState<{ code: string; key: string; ticket: Thread } | null>(null);
  const [reply, setReply] = useState('');

  if (AUTH_MODE !== 'firebase')
    return (
      <p className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
        {t('demoNote')}
      </p>
    );

  const message = (code: string) => t(`err_${errorKey(code)}`);

  async function onCreate(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = formText(data, 'body').trim();
    const name = formText(data, 'name').trim();
    const phone = formText(data, 'phone').trim();
    if (!name || !phone || !text) {
      setError(message('VALIDATION'));
      return;
    }
    setBusy(true);
    setError(null);
    let token: string;
    try {
      const { turnstileToken } = await import('@/lib/auth/turnstile');
      token = await turnstileToken(TURNSTILE_ID, locale, setChallenge);
    } catch {
      setBusy(false);
      setError(message('TURNSTILE_FAILED'));
      return;
    }
    const { createGuestTicketCall } = await import('@/lib/support-guest-api');
    const res = await createGuestTicketCall({
      name,
      phone,
      kind: formText(data, 'kind', 'other'),
      body: text,
      turnstileToken: token,
    });
    setBusy(false);
    if (!res.ok) {
      setError(message(res.code));
      return;
    }
    track('support_ticket', {
      action: 'guest_created',
      kind: formText(data, 'kind', 'other'),
      channel: 'web',
    });
    setCreated(res.data);
  }

  async function open(code: string, key: string) {
    const { lookupGuestTicketCall } = await import('@/lib/support-guest-api');
    const res = await lookupGuestTicketCall(code, key);
    if (!res.ok) {
      setError(message(res.code));
      return false;
    }
    setError(null);
    setThread({ code, key, ticket: res.data });
    return true;
  }

  async function onLookup(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    const ok = await open(formText(data, 'code').trim().toUpperCase(), formText(data, 'key').trim());
    setBusy(false);
    if (ok) track('support_ticket', { action: 'guest_looked_up', channel: 'web' });
  }

  async function onReply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!thread || !reply.trim()) {
      setError(message('VALIDATION'));
      return;
    }
    setBusy(true);
    const { replyGuestTicketCall } = await import('@/lib/support-guest-api');
    const res = await replyGuestTicketCall(thread.code, thread.key, reply.trim());
    if (!res.ok) {
      setBusy(false);
      setError(message(res.code));
      return;
    }
    setReply('');
    track('support_ticket', { action: 'guest_reply', channel: 'web' });
    await open(thread.code, thread.key);
    setBusy(false);
  }

  return (
    <div className="space-y-10">
      {created ? (
        <section
          aria-labelledby="guest-done"
          className="space-y-3 rounded-card border border-line-card bg-surface p-5"
        >
          <h2 id="guest-done" className="font-heading text-lg font-extrabold text-ink">
            {t('createdTitle')}
          </h2>
          <p className="text-sm text-muted">{t('createdIntro')}</p>
          <dl className="grid gap-2 text-sm text-ink">
            <div>
              <dt className="text-xs font-bold text-muted">{t('referenceLabel')}</dt>
              <dd className="font-mono text-base font-bold">{created.code}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-muted">{t('keyLabel')}</dt>
              <dd className="font-mono text-base font-bold">{created.accessKey}</dd>
            </div>
          </dl>
          <p className="text-sm font-bold text-ink">{t('keyOnce')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={quiet}
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${created.code} ${created.accessKey}`)
                  .then(() => {
                    setCopied(true);
                  })
                  .catch(() => {
                    setCopied(false);
                  });
              }}
            >
              {t('copy')}
            </button>
            <button
              type="button"
              className={primary}
              onClick={() => {
                void open(created.code, created.accessKey);
                setCreated(null);
              }}
            >
              {t('openRequest')}
            </button>
          </div>
          <p role="status" className="text-sm text-muted">
            {copied ? t('copied') : ''}
          </p>
        </section>
      ) : thread ? (
        <section
          aria-labelledby="guest-thread"
          className="space-y-3 rounded-card border border-line-card bg-surface p-5"
        >
          <h2 id="guest-thread" className="font-heading text-lg font-extrabold text-ink">
            {labels.kind(thread.ticket.kind)} · {thread.code}
          </h2>
          <p className="text-sm text-muted">{labels.status(thread.ticket.status)}</p>
          <TicketThread ticket={threadFromApi(thread.ticket)} viewer="customer" />
          {thread.ticket.status === 'closed' ? (
            <p className="text-sm text-muted">{t('closedNote')}</p>
          ) : (
            <form noValidate onSubmit={(e) => void onReply(e)}>
              <label htmlFor="guest-reply" className="text-xs font-bold text-muted">
                {t('replyLabel')}
              </label>
              <textarea
                id="guest-reply"
                rows={3}
                maxLength={GUEST_BODY_MAX}
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                }}
                className={`${field} py-2`}
              />
              <button type="submit" disabled={busy} className={`${primary} mt-2`}>
                {t('sendReply')}
              </button>
            </form>
          )}
          <button
            type="button"
            className={quiet}
            onClick={() => {
              setThread(null);
            }}
          >
            {t('back')}
          </button>
        </section>
      ) : (
        <>
          <form
            noValidate
            onSubmit={(e) => void onCreate(e)}
            id="guest-new-form"
            aria-labelledby="guest-new"
            className="space-y-3 rounded-card border border-line-card bg-surface p-5"
          >
            <h2 id="guest-new" className="font-heading text-lg font-extrabold text-ink">
              {t('newTitle')}
            </h2>
            <p className="text-sm text-muted">{t('newIntro')}</p>
            <div>
              <label htmlFor="guest-name" className="text-sm font-bold text-ink">
                {t('nameLabel')}
              </label>
              <input id="guest-name" name="name" autoComplete="name" maxLength={60} className={field} />
            </div>
            <div>
              <label htmlFor="guest-phone" className="text-sm font-bold text-ink">
                {t('phoneLabel')}
              </label>
              <input
                id="guest-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                aria-describedby="guest-phone-help"
                className={field}
              />
              <p id="guest-phone-help" className="mt-1 text-xs text-muted">
                {t('phoneHelp')}
              </p>
            </div>
            <div>
              <label htmlFor="guest-kind" className="text-sm font-bold text-ink">
                {t('kindLabel')}
              </label>
              <select id="guest-kind" name="kind" defaultValue="other" className={field}>
                {GUEST_TICKET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {labels.kind(k)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="guest-body" className="text-sm font-bold text-ink">
                {t('messageLabel')}
              </label>
              <textarea
                id="guest-body"
                name="body"
                rows={4}
                maxLength={GUEST_BODY_MAX}
                className={`${field} py-2`}
              />
            </div>
            <div role="group" aria-labelledby={challenge ? 'guest-turnstile-label' : undefined}>
              <p id="guest-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
                {t('securityCheck')}
              </p>
              <div id={TURNSTILE_ID} />
            </div>
            {error ? (
              <p role="alert" className="text-sm font-bold text-error">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={busy} className={primary}>
              {t('send')}
            </button>
          </form>

          <form
            noValidate
            onSubmit={(e) => void onLookup(e)}
            aria-labelledby="guest-check"
            className="space-y-3 rounded-card border border-line-card bg-surface p-5"
          >
            <h2 id="guest-check" className="font-heading text-lg font-extrabold text-ink">
              {t('checkTitle')}
            </h2>
            <p className="text-sm text-muted">{t('checkIntro')}</p>
            <div>
              <label htmlFor="guest-code" className="text-sm font-bold text-ink">
                {t('referenceLabel')}
              </label>
              <input
                id="guest-code"
                name="code"
                autoCapitalize="characters"
                autoComplete="off"
                className={field}
              />
            </div>
            <div>
              <label htmlFor="guest-key" className="text-sm font-bold text-ink">
                {t('keyLabel')}
              </label>
              <input
                id="guest-key"
                name="key"
                autoCapitalize="characters"
                autoComplete="off"
                className={field}
              />
            </div>
            <button type="submit" disabled={busy} className={quiet}>
              {t('check')}
            </button>
          </form>
        </>
      )}
      {thread && error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
