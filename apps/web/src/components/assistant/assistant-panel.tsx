'use client';

import { ArrowUpRight, Bot, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { AssistantCopy } from '@/assistant/copy';
import type { Intent } from '@/assistant/intents';
import { staticTransport, type ChatMessage } from '@/assistant/transport';
import { track } from '@/lib/analytics';

interface Entry extends ChatMessage {
  id: number;
  intent?: Intent;
}

const MAX_INPUT = 500;

/**
 * Assistant chat panel (spec 18). Non-modal dialog: the page stays usable, Esc closes and focus returns to the
 * launcher. Messages are announced politely. Answers come from the transport (static today, API later).
 */
export default function AssistantPanel({
  copy,
  open,
  onClose,
}: {
  copy: AssistantCopy;
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, role: 'assistant', text: copy.greeting }]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [entries, typing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  async function ask(text: string) {
    const clean = text.trim().slice(0, MAX_INPUT);
    if (!clean || typing) return;
    const user: Entry = { id: nextId.current++, role: 'user', text: clean };
    const history = [...entries, user];
    setEntries(history);
    setDraft('');
    setTyping(true);
    const [reply] = await Promise.all([
      staticTransport.reply(history),
      new Promise((resolve) => setTimeout(resolve, 550)), // brief typing beat so answers do not feel abrupt
    ]);
    track('assistant_message', { intent: reply.intent, length: clean.length });
    setEntries((prev) => [
      ...prev,
      {
        id: nextId.current++,
        role: 'assistant',
        text: copy.answers[reply.intent].text,
        intent: reply.intent,
      },
    ]);
    setTyping(false);
  }

  function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    void ask(draft);
  }

  return (
    <section
      id="assistant-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-title"
      hidden={!open}
      className="animate-page-in fixed right-4 z-50 flex h-[min(560px,calc(100dvh-200px))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-dialog border border-line-card bg-surface shadow-dialog bottom-[calc(84px+env(safe-area-inset-bottom))] nav:right-6 nav:bottom-6"
    >
      <header className="flex items-start gap-3 bg-navy px-4 py-3 text-white">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10">
          <Bot aria-hidden="true" className="size-5 text-accent-light" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="assistant-title" className="font-heading text-base font-extrabold">
            {copy.title}
          </h2>
          <p className="text-xs text-hero-copy">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.close}
          className="press inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </header>

      <ol ref={listRef} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {entries.map((m) => {
          const action = m.role === 'assistant' && m.intent ? copy.answers[m.intent].action : undefined;
          return (
            <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`animate-page-in max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-br-md bg-accent-button text-white'
                    : 'rounded-bl-md bg-pill text-ink'
                }`}
              >
                <span className="sr-only">{m.role === 'user' ? copy.you : copy.bot}: </span>
                {m.text}
                {action ? (
                  action.external ? (
                    <a
                      href={action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-1 font-bold text-accent-soft-text underline-offset-4 hover:underline"
                    >
                      {action.label}
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </a>
                  ) : (
                    <Link
                      href={action.href}
                      onClick={onClose}
                      className="mt-2 flex items-center gap-1 font-bold text-accent-soft-text underline-offset-4 hover:underline"
                    >
                      {action.label}
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </Link>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
        {typing ? (
          <li className="flex justify-start" aria-hidden="true">
            <span className="flex gap-1 rounded-2xl rounded-bl-md bg-pill px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-2 animate-bounce rounded-full bg-muted"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          </li>
        ) : null}
      </ol>

      <div className="border-t border-line px-3 pt-2">
        <ul aria-label={copy.suggestionsLabel} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {copy.suggestions.map((s) => (
            <li key={s.intent}>
              <button
                type="button"
                onClick={() => {
                  void ask(s.label);
                }}
                className="press inline-flex min-h-9 items-center rounded-pill border border-line-card px-3 text-xs font-bold whitespace-nowrap text-ink hover:bg-pill"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={onSubmit} className="flex items-center gap-2 pb-2">
          <label htmlFor="assistant-input" className="sr-only">
            {copy.placeholder}
          </label>
          <input
            ref={inputRef}
            id="assistant-input"
            value={draft}
            maxLength={MAX_INPUT}
            autoComplete="off"
            placeholder={copy.placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            className="min-h-11 min-w-0 flex-1 rounded-input border border-input-border bg-surface px-3 text-sm text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label={copy.send}
            disabled={!draft.trim() || typing}
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-input bg-accent-button text-white hover:bg-accent-button-hover disabled:opacity-50"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </form>
        <p className="pb-2 text-center text-[11px] text-muted">{copy.note}</p>
      </div>
    </section>
  );
}
