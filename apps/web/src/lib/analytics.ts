/**
 * First-party event tracking (docs/specs/12-analytics-events.md, hard rule 9).
 * Events are validated against this typed catalogue and queued. Transport (`POST /v1/events` via sendBeacon +
 * PostHog) and the consent gate are wired when the events endpoint ships (Phase 1); until then every event is
 * also dispatched as a `mechdost:track` DOM event so tests and dev tools can observe it.
 * No PII in props: ids, paths and lengths only — never phone numbers, emails or names.
 */
export interface ClientEvents {
  page_view: { path: string; locale: string };
  click: { id: string; path: string };
  search: { query: string; source: string };
  add_to_cart: { slug: string; qty: number };
  remove_from_cart: { slug: string };
  begin_checkout: { items: number; valuePaise: number };
  purchase: { code: string; valuePaise: number; demo: boolean };
  booking_started: { workshop: string };
  booking_confirmed: { code: string; workshop: string; demo: boolean };
  assistant_opened: { path: string };
  assistant_message: { intent: string; length: number };
}

export type ClientEventName = keyof ClientEvents;

export interface TrackedEvent<E extends ClientEventName = ClientEventName> {
  event: E;
  props: ClientEvents[E];
  occurredAt: string;
}

const MAX_QUEUE = 200;
const queue: TrackedEvent[] = [];

export function track<E extends ClientEventName>(event: E, props: ClientEvents[E]): void {
  if (typeof window === 'undefined') return;
  const entry: TrackedEvent = { event, props, occurredAt: new Date().toISOString() };
  queue.push(entry);
  if (queue.length > MAX_QUEUE) queue.shift();
  window.dispatchEvent(new CustomEvent<TrackedEvent>('mechdost:track', { detail: entry }));
}

/** Events not yet delivered (read by the transport once it exists). */
export function pendingEvents(): readonly TrackedEvent[] {
  return queue;
}
