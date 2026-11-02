'use client';

import { useSyncExternalStore } from 'react';
import {
  WHATSAPP_TEMPLATES,
  placeholderProblem,
  utilityTemplateProblem,
  type WhatsAppTemplateKey,
} from '@mechdost/shared/whatsapp';

/**
 * Admin → Notifications (demo store; production = `/v1/admin/notifications/*`, same rules). Hard rule 8 and the
 * user (2026-11-02): "all these options need to be with the admin too". Per WhatsApp event: on/off, English and
 * Hindi text (validated exactly like the API: no offer wording, exact {{n}} placeholders), one version per event
 * (compare-and-set) and a change history. Plus the monthly WhatsApp budget alert. Self-contained (no import of
 * store.ts), synced across tabs through `storage` events.
 */
export const NOTIFY_KEY = 'mechdost-demo-notifications';
export type NotifyLocale = 'en' | 'hi';
export const WHATSAPP_EVENTS = Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[];

export interface EventSetting {
  enabled: boolean;
  /** Text per language; missing = the default copy from the locale files. */
  body: Partial<Record<NotifyLocale, string>>;
  version: number;
}

export interface NotifyHistory {
  at: string;
  actor: string;
  /** Event key, or `budget`. */
  target: string;
  change: 'saved' | 'enabled' | 'disabled' | 'budget';
}

export interface NotifyConfig {
  events: Partial<Record<WhatsAppTemplateKey, EventSetting>>;
  budgetPaise: number;
  budgetVersion: number;
  history: NotifyHistory[];
}

export const DEFAULT_BUDGET_PAISE = 500_000; // ₹5,000 a month (Q55 default)
export const BUDGET_LIMITS = [0, 100_000_000] as const;
const MAX_HISTORY = 30;
const EMPTY: NotifyConfig = { events: {}, budgetPaise: DEFAULT_BUDGET_PAISE, budgetVersion: 0, history: [] };

export type TemplateProblem = 'empty' | 'promo_wording' | 'too_long' | 'missing' | 'unknown';

/** Same checks as the API (`templateProblem` in packages/db), so the demo never accepts what production refuses. */
export function bodyProblem(event: WhatsAppTemplateKey, body: string): TemplateProblem | null {
  const text = body.trim();
  if (text.length === 0) return 'empty';
  const utility = utilityTemplateProblem(text);
  if (utility) return utility;
  return placeholderProblem(text, WHATSAPP_TEMPLATES[event].params.length);
}

/** Fills {{1}}…{{n}} with sample values for the preview. */
export function preview(body: string, samples: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, n: string) => samples[Number(n) - 1] ?? whole);
}

function read(): NotifyConfig {
  try {
    const raw = window.localStorage.getItem(NOTIFY_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<NotifyConfig>;
    return {
      events: typeof parsed.events === 'object' ? parsed.events : {},
      budgetPaise: typeof parsed.budgetPaise === 'number' ? parsed.budgetPaise : DEFAULT_BUDGET_PAISE,
      budgetVersion: typeof parsed.budgetVersion === 'number' ? parsed.budgetVersion : 0,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return EMPTY;
  }
}

let cached: { raw: string | null; value: NotifyConfig } | null = null;

function snapshot(): NotifyConfig {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(NOTIFY_KEY);
  } catch {
    raw = null;
  }
  if (cached?.raw === raw) return cached.value;
  cached = { raw, value: read() };
  return cached.value;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === NOTIFY_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function write(next: NotifyConfig) {
  try {
    window.localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  for (const cb of listeners) cb();
  return true;
}

export function useNotifyConfig(): NotifyConfig {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** Server snapshot helper for code paths that send (demo): is WhatsApp on for this event? */
export function whatsAppEnabled(event: WhatsAppTemplateKey): boolean {
  return snapshot().events[event]?.enabled ?? false;
}

function withHistory(c: NotifyConfig, entry: NotifyHistory): NotifyHistory[] {
  return [entry, ...c.history].slice(0, MAX_HISTORY);
}

/**
 * Saves one event (compare-and-set on its version). Refuses invalid text in any language and refuses to switch
 * WhatsApp on while a language has no valid text. Returns the problem per language, or 'stale'.
 */
export function saveEvent(
  event: WhatsAppTemplateKey,
  expectedVersion: number,
  actor: string,
  next: { enabled: boolean; body: Record<NotifyLocale, string> },
):
  | { ok: true }
  | { ok: false; reason: 'stale' }
  | { ok: false; reason: 'invalid'; problems: Partial<Record<NotifyLocale, TemplateProblem>> } {
  const c = read();
  const current = c.events[event];
  if ((current?.version ?? 0) !== expectedVersion) return { ok: false, reason: 'stale' };
  const problems: Partial<Record<NotifyLocale, TemplateProblem>> = {};
  for (const locale of ['en', 'hi'] as const) {
    const problem = bodyProblem(event, next.body[locale]);
    if (problem) problems[locale] = problem;
  }
  if (Object.keys(problems).length > 0) return { ok: false, reason: 'invalid', problems };
  const change: NotifyHistory['change'] =
    current?.enabled === next.enabled ? 'saved' : next.enabled ? 'enabled' : 'disabled';
  write({
    ...c,
    events: {
      ...c.events,
      [event]: {
        enabled: next.enabled,
        body: { en: next.body.en.trim(), hi: next.body.hi.trim() },
        version: expectedVersion + 1,
      },
    },
    history: withHistory(c, { at: new Date().toISOString(), actor, target: event, change }),
  });
  return { ok: true };
}

export function saveBudget(
  expectedVersion: number,
  actor: string,
  budgetPaise: number,
): 'ok' | 'stale' | 'invalid' {
  const c = read();
  if (c.budgetVersion !== expectedVersion) return 'stale';
  if (
    !Number.isSafeInteger(budgetPaise) ||
    budgetPaise < BUDGET_LIMITS[0] ||
    budgetPaise > BUDGET_LIMITS[1]
  ) {
    return 'invalid';
  }
  write({
    ...c,
    budgetPaise,
    budgetVersion: expectedVersion + 1,
    history: withHistory(c, { at: new Date().toISOString(), actor, target: 'budget', change: 'budget' }),
  });
  return 'ok';
}
