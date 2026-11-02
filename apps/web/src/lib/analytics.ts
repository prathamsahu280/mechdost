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
  /** Workshop map interactions (bug 2026-11-02: map actions were untracked). Workshop = slug, never a name. */
  map_action: {
    action: 'show_on_map' | 'pin_select' | 'locate' | 'show_all' | 'mode_change';
    workshop?: string;
    mode?: 'map' | 'satellite';
  };
  /** "Use my location" result: whether a PIN code was found (the PIN itself is not sent: quasi-identifier). */
  location_detected: { source: 'finder' | 'map'; pincodeFound: boolean };
  /** Admin site customisation (spec 08 `admin_action`): which area changed and how many fields. */
  admin_site_change: {
    area: 'content' | 'layout' | 'categories' | 'settings';
    action: 'save' | 'reset';
    fields: number;
  };
  /** Admin → Notifications (spec 10, hard rule 8): which WhatsApp event changed and how; `budget` for the alert. */
  admin_notifications_change: {
    target: string;
    action: 'saved' | 'enabled' | 'disabled' | 'budget';
  };
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
  persistDemo(entry);
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
    list.push({ ...entry, path: window.location.pathname });
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
