'use client';

import { ArrowLeft, Info, Search, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { localePath } from '@/lib/locale-path';
import type { MemberCard } from '@/lib/ustaad/messages-api';
import { LoadFailed, LoadingBlock, SampleNote, btnPrimary, btnQuiet, card, fieldClass } from '../common';
import { Avatar, MemberLine, backLink, useAct, useDmErrorText, useMemberName, useSocial } from './shared';

/**
 * Start a conversation (`/ustaad/messages?to=<handle>`; spec 23 § 4 flow 7, SR-33): messages are request-only, so the
 * first message is one text-only request. The rules are shown before typing: one message until they accept, no links
 * or phone numbers, new accounts wait a few days. An existing conversation opens instead. API refusals come back as
 * words beside the field.
 */
export function NewThread({ handle }: { handle: string | null }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const errorText = useDmErrorText();
  const { loaded, reload, sample } = useSocial(
    async (c) => {
      if (!handle) return { ok: true as const, data: null };
      const found = await c.findByHandle(handle);
      if (!found.ok || !found.data) return found.ok ? { ok: true as const, data: null } : found;
      const rel = await c.relationship(found.data.id);
      if (!rel.ok) return rel;
      return { ok: true as const, data: { member: found.data, threadId: rel.data.threadId } };
    },
    `to-${handle ?? ''}`,
  );

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header className="grid gap-1">
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('newTitle')}
        </h1>
        <Link
          href={localePath('/ustaad/messages', locale)}
          className={backLink}
          data-track="ustaad_new_thread_back"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
          {t('backToMessages')}
        </Link>
      </header>
      <SampleNote show={sample} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && loaded.data === null ? (
        <div className={`${card} grid justify-items-center gap-3 text-center`}>
          <p className="text-[15px] leading-relaxed text-ink">{t('err_HANDLE_NOT_FOUND')}</p>
          <Link
            href={localePath('/ustaad/discover', locale)}
            className={btnPrimary}
            data-track="ustaad_new_thread_discover"
          >
            <Search aria-hidden="true" className="size-5" />
            {t('findPeople')}
          </Link>
        </div>
      ) : null}
      {loaded.state === 'ok' && loaded.data ? (
        loaded.data.threadId ? (
          <div className={`${card} grid gap-3`}>
            <MemberLine m={loaded.data.member} />
            <p className="text-[15px] text-ink">{t('alreadyTalking')}</p>
            <Link
              href={localePath(`/ustaad/messages/${loaded.data.threadId}`, locale)}
              className={`${btnPrimary} justify-self-start`}
              data-track="ustaad_new_thread_existing"
            >
              {t('openConversation')}
            </Link>
          </div>
        ) : (
          <RequestForm member={loaded.data.member} />
        )
      ) : null}
    </div>
  );
}

function RequestForm({ member }: { member: MemberCard }) {
  const t = useTranslations('ustaad.messages');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useDmErrorText();
  const name = useMemberName()(member);
  const fieldId = useId();
  const errId = useId();
  const rulesId = useId();
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const [empty, setEmpty] = useState(false);
  const { act, busy, error } = useAct();

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy) return;
    if (text.trim() === '') {
      setEmpty(true);
      field.current?.focus();
      return;
    }
    setEmpty(false);
    const r = await act('send', (c) => c.startThread(member.id, text.trim()));
    if (r) router.push(localePath(`/ustaad/messages/${r.threadId}`, locale));
  }

  const message = empty ? t('err_empty') : error ? errorText(error) : null;
  return (
    <form className={`${card} grid gap-4`} onSubmit={(e) => void submit(e)} noValidate>
      <div className="flex items-center gap-3">
        <Avatar name={name} size="lg" />
        <MemberLine m={member} />
      </div>
      <div
        id={rulesId}
        role="note"
        className="grid gap-2 rounded-xl bg-info-bg p-4 text-[15px] leading-relaxed text-ink"
      >
        <p className="flex items-center gap-2 font-bold">
          <Info aria-hidden="true" className="size-5 shrink-0 text-info" />
          {t('rulesTitle')}
        </p>
        <ul className="ml-1 grid list-inside list-disc gap-1">
          <li>{t('rule_one')}</li>
          <li>{t('rule_text')}</li>
          <li>{t('rule_noLinks')}</li>
          <li>{t('rule_newAccount')}</li>
        </ul>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={fieldId} className="text-[15px] font-bold text-ink">
          {t('firstMessage')}
        </label>
        <textarea
          ref={field}
          id={fieldId}
          aria-required="true"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          rows={4}
          maxLength={1000}
          placeholder={t('firstMessagePh')}
          aria-invalid={message ? true : undefined}
          aria-describedby={`${rulesId} ${errId}`}
          className={`${fieldClass} min-h-28`}
        />
        <p id={errId} role="alert" className="text-sm font-bold text-error empty:sr-only">
          {message ?? ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className={btnPrimary}
          aria-disabled={busy !== null}
          data-track="ustaad_thread_request_send"
        >
          <Send aria-hidden="true" className="size-5" />
          {busy ? t('working') : t('sendRequest')}
        </button>
        <Link
          href={localePath('/ustaad/messages', locale)}
          className={btnQuiet}
          data-track="ustaad_thread_request_cancel"
        >
          {t('cancel')}
        </Link>
      </div>
    </form>
  );
}
