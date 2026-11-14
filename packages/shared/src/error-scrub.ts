import { redactPath } from './analytics-path';
import { maskPersonalDataKeepCodes } from './privacy';

/**
 * Error reports leave our servers (Sentry, decision 2026-11-14), so they are scrubbed in `beforeSend` on the web
 * and the API: no request bodies, headers, cookies or query strings, no user, no host name, and messages without
 * phone numbers, emails, tokens or the SQL + parameters that database errors embed (security review 2026-11-03:
 * our own logs never keep error messages for that reason). Dependency-free and structural, so neither the browser
 * chunk nor this package depends on the Sentry types.
 */
export interface ScrubbableEvent {
  message?: string | undefined;
  server_name?: string | undefined;
  user?: unknown;
  request?: { url?: string | undefined; method?: string | undefined } | undefined;
  exception?:
    | {
        values?:
          | { value?: string | undefined; stacktrace?: { frames?: Frame[] | undefined } | undefined }[]
          | undefined;
      }
    | undefined;
  breadcrumbs?: Breadcrumb[] | undefined;
  extra?: Record<string, unknown> | undefined;
  logentry?: { message?: string | undefined; params?: unknown[] | undefined } | undefined;
}

interface Frame {
  filename?: string | undefined;
  abs_path?: string | undefined;
}

interface Breadcrumb {
  category?: string | undefined;
  message?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

const MAX_TEXT = 500;
const FAILED_QUERY = /Failed query:[\s\S]*/u;
// Postgres echoes the rejected input: `invalid input syntax for type uuid: "<input>"`, `Key (email)=(<value>)`.
const PG_SYNTAX = /(syntax for type [^:"]{1,60}:)[\s\S]*/u;
const PG_KEY = /Key \(([^)]{0,200})\)=\((?:[^()]|\([^()]*\))*\)/gu;
// URLs inside messages (fetch errors): query strings and fragments go, as in `scrubUrl`.
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>()]+/giu;
const PATH_QUERY = /(\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*/gu;
const JWT = /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/gu;
// API keys, session ids, invite tokens: 32+ word characters in a row (uuids have dashes every ≤ 12, so they stay).
const LONG_TOKEN = /[A-Za-z0-9_]{32,}/gu;
// Keys whose values are personal or secret, wherever they appear in extra data (exact or as a suffix).
const PERSONAL_KEY =
  /(phone|mobile|email|name|address|line1|line2|landmark|pincode|gstin|note|message|text|comment|query|password|token|otp|secret|cookie|authorization|body)$/iu;
const URL_KEYS = new Set(['url', 'from', 'to']);

/** An error message without personal data or secrets (capped at 500 characters). */
export function scrubErrorText(text: string): string {
  return maskPersonalDataKeepCodes(
    text
      .slice(0, MAX_TEXT * 4)
      .replace(FAILED_QUERY, 'Failed query [redacted]')
      .replace(PG_SYNTAX, '$1 [redacted]')
      .replace(PG_KEY, 'Key ($1)=([redacted])')
      .replace(ABSOLUTE_URL, (url) => scrubUrl(url))
      .replace(PATH_QUERY, '$1')
      .replace(JWT, '[token]')
      .replace(LONG_TOKEN, '[token]'),
  ).slice(0, MAX_TEXT);
}

/** Origin and path only (no query, no fragment); secret path segments and long digit runs are masked. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/u);
  const base = cut === -1 ? url : url.slice(0, cut);
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)?(.*)$/iu.exec(base);
  const origin = m?.[1] ?? '';
  const path = m?.[2] ?? '';
  return origin + maskPersonalDataKeepCodes(redactPath(path)).replace(LONG_TOKEN, '[token]');
}

/**
 * A stack frame's file without query or fragment, secret path segments redacted. The path itself stays as is:
 * chunk names must still match the uploaded source maps.
 */
function scrubFramePath(url: string): string {
  const cut = url.search(/[?#]/u);
  return redactPath(cut === -1 ? url : url.slice(0, cut));
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubErrorText(value);
  if (depth >= 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = PERSONAL_KEY.test(key) ? '[redacted]' : scrubValue(v, depth + 1);
  }
  return out;
}

function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  // Console output can hold anything the code printed.
  if (b.category === 'console') return null;
  const out: Breadcrumb = { ...b };
  if (typeof b.message === 'string') out.message = scrubErrorText(b.message);
  if (b.data) {
    const data: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(b.data)) {
      if (URL_KEYS.has(key) && typeof v === 'string') data[key] = scrubUrl(v);
      else data[key] = PERSONAL_KEY.test(key) ? '[redacted]' : scrubValue(v, 1);
    }
    out.data = data;
  }
  return out;
}

/** Scrub an error event in place of Sentry's `beforeSend` (returns the same object, changed). */
export function scrubErrorEvent<E extends ScrubbableEvent>(original: E): E {
  // Mutate through the structural view (same object): a generic E's properties cannot be assigned directly.
  const event: ScrubbableEvent = original;
  delete event.user;
  delete event.server_name;
  if (typeof event.message === 'string') event.message = scrubErrorText(event.message);
  if (event.logentry) {
    if (typeof event.logentry.message === 'string')
      event.logentry.message = scrubErrorText(event.logentry.message);
    delete event.logentry.params;
  }
  if (event.request) {
    const { url, method } = event.request;
    event.request = {
      ...(typeof url === 'string' ? { url: scrubUrl(url) } : {}),
      ...(typeof method === 'string' ? { method } : {}),
    };
  }
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubErrorText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (typeof frame.filename === 'string') frame.filename = scrubFramePath(frame.filename);
      if (typeof frame.abs_path === 'string') frame.abs_path = scrubFramePath(frame.abs_path);
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  if (event.extra) event.extra = scrubValue(event.extra, 0) as Record<string, unknown>;
  return original;
}
