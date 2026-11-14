/**
 * PostHog EU forwarding (decision 2026-11-14; spec 12). The browser never talks to PostHog (no posthog-js, no page
 * weight): the worker reads the first-party event store and posts batches to PostHog's capture API with plain
 * `fetch` (no SDK dependency). Never on a request path; a failed batch is retried a bounded number of times and then
 * dropped with a count and a log line — the event store stays the source of truth.
 *
 * Privacy (DPDP, hard rule 16): web/app events only when the visitor allowed analytics under the notice that names
 * PostHog (`consentAllowsForwarding`); the distinct id is the random visitor id, events are personless (no person
 * profiles) and GeoIP is off. Server events (purchase, routing …) carry no user at all — consent is not known on the
 * server — so they use one fixed id with business codes only. Props pass `scrubProps` on top of the registry's own
 * validation: personal keys, free text, emails and phone-like numbers never leave; only server events keep ids the
 * phone mask would remove (client props could disguise a number as an id).
 */
import { consentAllowsForwarding, isPseudonymousId, maskPersonalData } from '@mechdost/shared/privacy';
import type { EventCursor, ForwardableEvent } from '@mechdost/db/repo';
import type { Severity } from '../logger';

export interface PosthogEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  uuid: string;
  properties: Record<string, unknown>;
}

export const SERVER_DISTINCT_ID = 'mechdost-server';
const MAX_STRING = 200;
const MAX_DEPTH = 3;
const MAX_ITEMS = 50;
// Personal or user-linking keys (exact, or as a suffix: contactPhone, shopName, customerId …), case-insensitive.
const PERSONAL_KEY =
  /(phone|mobile|email|name|address|street|landmark|line1|line2|pincode|gstin|note|message|text|comment|password|token|otp|secret|userid|customerid|^user|^customer|^lat|^lng|^lon|latitude|longitude|^ip)$/iu;

// Keys that hold ids: `id`, `ids`, `code`, `codes`, or camelCase names ending in Id/Ids/Code/Codes (shopId, orderCode,
// targetIds). User-linking ids are dropped earlier by PERSONAL_KEY.
const ID_KEY = /^(?:id|ids|code|codes)$|[a-z0-9](?:Id|Ids|Code|Codes)$/u;

/**
 * Who wrote the props: `server` = our own code with database-issued ids (server events); `client` = the browser
 * (web/app events), which could shape a phone number like a UUID (`98765432-10ab-7…`, security review 2026-11-14).
 */
export type PropsSource = 'server' | 'client';

function cleanValue(
  value: unknown,
  depth: number,
  exemptIds: boolean,
  source: PropsSource,
): { keep: boolean; value?: unknown } {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) return { keep: false };
    // UUIDs (v7: digit runs) and public codes (MD-RPR-2026-…) identify rows, not people — kept only when our server
    // wrote them and the key holds ids; client values and other keys go through the mask (reviews 2026-11-14).
    if (exemptIds && isPseudonymousId(value)) return { keep: true, value };
    if (maskPersonalData(value) !== value) return { keep: false };
    return { keep: true, value };
  }
  if (typeof value === 'number') return Number.isFinite(value) ? { keep: true, value } : { keep: false };
  if (typeof value === 'boolean' || value === null) return { keep: true, value };
  if (depth >= MAX_DEPTH || typeof value !== 'object') return { keep: false };
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map((v) => cleanValue(v, depth + 1, exemptIds, source))
      .filter((r) => r.keep)
      .map((r) => r.value);
    return { keep: true, value: items };
  }
  return { keep: true, value: scrubObject(value as Record<string, unknown>, depth + 1, source) };
}

function scrubObject(
  props: Record<string, unknown>,
  depth: number,
  source: PropsSource,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'query') {
      // Search text is free text even after scrubbing: only its length goes to PostHog.
      if (typeof value === 'string') out.query_length = value.length;
      continue;
    }
    if (PERSONAL_KEY.test(key)) continue;
    const r = cleanValue(value, depth, source === 'server' && ID_KEY.test(key), source);
    if (r.keep) out[key] = r.value;
  }
  return out;
}

/**
 * Event props without personal keys, free text, emails, phone-like numbers or long strings. `source` says who wrote
 * them; only `server` props keep ids that the phone mask would remove (client props: the mask applies to all).
 */
export function scrubProps(props: unknown, source: PropsSource = 'client'): Record<string, unknown> {
  if (props === null || typeof props !== 'object' || Array.isArray(props)) return {};
  return scrubObject(props as Record<string, unknown>, 0, source);
}

/** One stored event as a PostHog batch item, or null when it must not be forwarded. */
export function toPosthogEvent(row: ForwardableEvent, webBaseUrl: string): PosthogEvent | null {
  const server = row.source === 'server';
  if (!server) {
    if (!row.anonymousId || !consentAllowsForwarding(row.consentVersion)) return null;
  }
  const props = scrubProps(row.props, server ? 'server' : 'client');
  const pathProp = typeof props.path === 'string' ? props.path : null;
  const path = row.page ?? pathProp;
  const pageView = row.event === 'page_view';
  return {
    event: pageView ? '$pageview' : row.event,
    distinct_id: server ? SERVER_DISTINCT_ID : (row.anonymousId ?? SERVER_DISTINCT_ID),
    timestamp: row.occurredAt.toISOString(),
    uuid: row.id,
    properties: {
      ...props,
      ...(pageView ? { mechdost_event: 'page_view' } : {}),
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: 'mechdost-forwarder',
      source: row.source,
      ...(row.cityId ? { city_id: row.cityId } : {}),
      ...(!server && row.sessionId ? { session_id: row.sessionId } : {}),
      ...(!server && row.consentVersion ? { consent_version: row.consentVersion } : {}),
      ...(path ? { $pathname: path, $current_url: `${webBaseUrl.replace(/\/+$/u, '')}${path}` } : {}),
    },
  };
}

export interface PosthogSender {
  /** True when PostHog accepted the batch; never throws. */
  send(batch: PosthogEvent[]): Promise<boolean>;
}

const sleepMs = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/** Posts to `{host}/batch/`: up to 3 attempts for network errors, 429 and 5xx (1 s, 4 s back-off); 4xx never. */
export function createPosthogSender(input: {
  host: string;
  key: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
}): PosthogSender {
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? sleepMs;
  const attempts = input.attempts ?? 3;
  const url = `${input.host.replace(/\/+$/u, '')}/batch/`;
  return {
    async send(batch) {
      const body = JSON.stringify({ api_key: input.key, batch });
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const res = await doFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
          });
          if (res.ok) return true;
          if (res.status !== 429 && res.status < 500) return false;
        } catch {
          // Network error or timeout: retried below.
        }
        if (attempt < attempts) await sleep(4 ** (attempt - 1) * 1000);
      }
      return false;
    },
  };
}

export interface ForwarderStats {
  forwarded: number;
  skipped: number;
  dropped: number;
}

/**
 * Worker loop: every `intervalMs` read up to `batchSize` rows after the in-memory cursor, send them in chunks of
 * `sendSize`, move the cursor past them whatever the outcome (drop on failure), and keep going while pages are
 * full (catch-up, at most 20 pages per tick). The cursor lives in memory: after a restart the read starts 10 minutes
 * back and PostHog drops re-sent events by uuid. One worker instance (deploy/compose.yml).
 */
export function startPosthogForwarder(input: {
  read: (after: EventCursor | null, limit: number) => Promise<ForwardableEvent[]>;
  sender: PosthogSender;
  webBaseUrl: string;
  intervalMs?: number;
  batchSize?: number;
  sendSize?: number;
  log: (severity: Severity, message: string, fields?: Record<string, unknown>) => void;
}) {
  const batchSize = input.batchSize ?? 500;
  const sendSize = input.sendSize ?? 100;
  const totals: ForwarderStats = { forwarded: 0, skipped: 0, dropped: 0 };
  let cursor: EventCursor | null = null;
  let running: Promise<ForwarderStats> | null = null;
  let stopped = false;

  async function runTick(): Promise<ForwarderStats> {
    const stats: ForwarderStats = { forwarded: 0, skipped: 0, dropped: 0 };
    for (let page = 0; page < 20 && !stopped; page += 1) {
      let rows: ForwardableEvent[];
      try {
        rows = await input.read(cursor, batchSize);
      } catch (err) {
        input.log('error', 'posthog_read_failed', {
          errorName: err instanceof Error ? err.name : typeof err,
        });
        break;
      }
      const last = rows.at(-1);
      if (!last) break;
      const out: PosthogEvent[] = [];
      for (const row of rows) {
        let e: PosthogEvent | null = null;
        try {
          e = toPosthogEvent(row, input.webBaseUrl);
        } catch (err) {
          // One malformed row must not stop the stream: skip it, the cursor still moves past it.
          input.log('warn', 'posthog_row_skipped', {
            errorName: err instanceof Error ? err.name : typeof err,
          });
        }
        if (e) out.push(e);
        else stats.skipped += 1;
      }
      for (let i = 0; i < out.length; i += sendSize) {
        const chunk = out.slice(i, i + sendSize);
        // A sender that throws (it should not) counts as a dropped batch.
        const sent = await input.sender.send(chunk).catch(() => false);
        if (sent) stats.forwarded += chunk.length;
        else {
          stats.dropped += chunk.length;
          input.log('warn', 'posthog_batch_dropped', { events: chunk.length });
        }
      }
      cursor = last.cursor;
      if (rows.length < batchSize) break;
    }
    totals.forwarded += stats.forwarded;
    totals.skipped += stats.skipped;
    totals.dropped += stats.dropped;
    if (stats.forwarded + stats.dropped > 0) input.log('info', 'posthog_forwarded', { ...stats });
    return stats;
  }

  const tick = (): Promise<ForwarderStats> => {
    if (running) return running;
    // Never rejects: an unhandled rejection from the interval would end the worker (Sentry `strict` mode exits).
    running = runTick()
      .catch((err: unknown) => {
        input.log('error', 'posthog_tick_failed', {
          errorName: err instanceof Error ? err.name : typeof err,
        });
        return { forwarded: 0, skipped: 0, dropped: 0 };
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const timer = input.intervalMs
    ? setInterval(() => {
        void tick();
      }, input.intervalMs)
    : null;
  timer?.unref();

  return {
    tick,
    totals: () => ({ ...totals }),
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await running;
    },
  };
}
