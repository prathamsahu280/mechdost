/**
 * First-party event tracking (docs/specs/12-analytics-events.md, hard rule 9).
 * Events are typed by the shared registry and queued; each is also dispatched as a `mechdost:track` DOM event
 * (tests, dev tools). After the visitor allows analytics (consent banner), `event-transport.ts` sends them to
 * `POST /v1/events` when the API is configured; the worker forwards consented events to PostHog EU (spec 12).
 * No PII in props: ids, paths and lengths only — never phone numbers, emails or names.
 */
import type { ClientEventName, ClientEvents } from '@mechdost/shared/analytics';
import { redactPath } from '@mechdost/shared/analytics-path';
import { forward } from './event-transport';
// The catalogue (names + prop shapes) lives in packages/shared so the API validates the same events
// (`CLIENT_EVENT_SCHEMAS`). Type-only import: no validator code reaches the browser bundle.

export type { ClientEventName, ClientEvents };

export interface TrackedEvent<E extends ClientEventName = ClientEventName> {
  event: E;
  props: ClientEvents[E];
  occurredAt: string;
}

const MAX_QUEUE = 200;
const queue: TrackedEvent[] = [];

export function track<E extends ClientEventName>(event: E, props: ClientEvents[E]): void {
  if (typeof window === 'undefined') return;
  // Secrets in a path segment (invite tokens) never leave this function (security review 2026-11-13).
  const safe =
    'path' in props && typeof props.path === 'string' ? { ...props, path: redactPath(props.path) } : props;
  const entry: TrackedEvent = { event, props: safe, occurredAt: new Date().toISOString() };
  queue.push(entry);
  if (queue.length > MAX_QUEUE) queue.shift();
  window.dispatchEvent(new CustomEvent<TrackedEvent>('mechdost:track', { detail: entry }));
  persistDemo(entry);
  forward(entry);
}

/**
 * Until the events endpoint ships, the demo keeps the last 500 events on this device so a bug report can be
 * replayed (user 2026-11-02: "u can surely check the api for the actions i did"). No PII by construction.
 */
export const DEMO_EVENTS_KEY = 'mechdost-demo-events';
export type StoredEvent = TrackedEvent & { path: string };
const DEMO_MAX = 500;

function persistDemo(entry: TrackedEvent) {
  try {
    const raw = window.localStorage.getItem(DEMO_EVENTS_KEY);
    const list = raw ? (JSON.parse(raw) as StoredEvent[]) : [];
    list.push({ ...entry, path: redactPath(window.location.pathname) });
    window.localStorage.setItem(DEMO_EVENTS_KEY, JSON.stringify(list.slice(-DEMO_MAX)));
  } catch {
    // Storage full or blocked: the in-memory queue still has the event.
  }
}

/** The demo event log (newest last), for the admin activity view and bug reports. */
export function demoEventLog(): StoredEvent[] {
  try {
    const raw = window.localStorage.getItem(DEMO_EVENTS_KEY);
    return raw ? (JSON.parse(raw) as StoredEvent[]) : [];
  } catch {
    return [];
  }
}

/** Events not yet delivered (read by the transport once it exists). */
export function pendingEvents(): readonly TrackedEvent[] {
  return queue;
}
