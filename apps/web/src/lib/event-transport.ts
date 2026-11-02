import { analyticsAllowed, CONSENT_VERSION, onConsentChange } from './consent';

/**
 * Sends tracked events to `POST {NEXT_PUBLIC_API_URL}/v1/events` (spec 12) — only after the visitor allowed
 * analytics, and only when the API is configured (the local demo has none, so nothing leaves the browser).
 * Batches of up to 20 every 5 s, flushed when the page is hidden (`fetch` keepalive: works cross-origin with
 * CORS, unlike sendBeacon with JSON). The visitor id is created on the first allowed send and deleted when
 * consent is withdrawn. Failures are dropped silently: analytics never breaks the page.
 */
const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
const VISITOR_KEY = 'mechdost-visitor';
const BATCH = 20;
const DELAY_MS = 5000;

interface Outgoing {
  event: string;
  occurredAt: string;
  page: string;
  props: unknown;
}

const outbox: Outgoing[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let wired = false;

function visitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID().replace(/-/g, '');
    window.sessionStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return 'nosession';
  }
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!API || outbox.length === 0 || !analyticsAllowed()) return;
  const events = outbox.splice(0, 50);
  void fetch(`${API}/v1/events`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'web',
      anonymousId: visitorId(),
      sessionId: sessionId(),
      consent: { analytics: true, version: CONSENT_VERSION },
      events,
    }),
  }).catch(() => undefined);
}

function wire() {
  if (wired) return;
  wired = true;
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  onConsentChange((choice) => {
    if (choice.analytics) return;
    outbox.length = 0;
    try {
      window.localStorage.removeItem(VISITOR_KEY);
      window.sessionStorage.removeItem(VISITOR_KEY);
    } catch {
      // nothing stored
    }
  });
}

export function forward(entry: { event: string; occurredAt: string; props: unknown }): void {
  if (!API || !analyticsAllowed()) return;
  wire();
  outbox.push({ ...entry, page: window.location.pathname.slice(0, 200) });
  if (outbox.length >= BATCH) flush();
  else timer ??= setTimeout(flush, DELAY_MS);
}
