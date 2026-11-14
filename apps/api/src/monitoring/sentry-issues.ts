/**
 * Admin → Errors (decision 2026-11-14, spec 08): the latest unresolved Sentry issues of the website and API
 * projects, read server-side with a read-only token (`SENTRY_API_TOKEN`: `event:read`, `project:read`, `org:read`)
 * from the org's data region (EU: de.sentry.io). The token never reaches the browser. Only whitelisted fields come
 * back — counts, never user emails, IPs or event payloads — and titles are scrubbed again. Cached 60 s per instance
 * (15 s when Sentry failed), one request in flight at a time; a failing Sentry never throws to the route.
 */
import { z } from 'zod';
import type { AdminErrorIssueDto, AdminErrorsDto, ErrorProject } from '@mechdost/shared/admin-errors-api';
import { ERROR_LEVELS } from '@mechdost/shared/admin-errors-api';
import { scrubErrorText } from '@mechdost/shared/error-scrub';

export interface SentryIssuesSettings {
  token: string;
  org: string;
  projects: Record<ErrorProject, string | null>;
  baseUrl: string;
  environment: string;
}

export interface SentryIssuesClient {
  list(): Promise<AdminErrorsDto>;
}

const MAX_ISSUES = 25;
const TTL_OK_MS = 60_000;
const TTL_FAILED_MS = 15_000;

/** What we read from Sentry's issue list (everything else in the answer is ignored, never forwarded). */
const SentryIssue = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  shortId: z.string().max(64).catch(''),
  title: z.string().catch(''),
  level: z.string().catch('error'),
  count: z.union([z.string(), z.number()]).catch('0'),
  userCount: z.number().catch(0),
  firstSeen: z.string().catch(''),
  lastSeen: z.string().catch(''),
  permalink: z.string().catch(''),
  stats: z
    .object({ '24h': z.array(z.tuple([z.number(), z.number()])).catch([]) })
    .partial()
    .catch({}),
});

const isLevel = (v: string): v is AdminErrorIssueDto['level'] =>
  (ERROR_LEVELS as readonly string[]).includes(v);
const int = (v: string | number) => {
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** A Sentry link only when it points at sentry.io over https; otherwise the issue page built from its id. */
function issueLink(permalink: string, id: string, s: SentryIssuesSettings): string {
  try {
    const u = new URL(permalink);
    if (u.protocol === 'https:' && (u.hostname === 'sentry.io' || u.hostname.endsWith('.sentry.io')))
      return u.origin + u.pathname;
  } catch {
    // fall through
  }
  return `${s.baseUrl}/organizations/${s.org}/issues/${id}/`;
}

/** Sentry's issue → our DTO (whitelisted fields, scrubbed title). Exported for tests. */
export function toIssue(raw: unknown, s: SentryIssuesSettings): AdminErrorIssueDto | null {
  const p = SentryIssue.safeParse(raw);
  if (!p.success) return null;
  const i = p.data;
  return {
    id: i.id,
    shortId: i.shortId.replace(/[^A-Za-z0-9-]/gu, ''),
    title: scrubErrorText(i.title) || i.shortId,
    level: isLevel(i.level) ? i.level : 'error',
    count24h: (i.stats['24h'] ?? []).reduce((sum, [, n]) => sum + int(n), 0),
    countTotal: int(i.count),
    usersAffected: int(i.userCount),
    firstSeen: i.firstSeen,
    lastSeen: i.lastSeen,
    link: issueLink(i.permalink, i.id, s),
  };
}

export function createSentryIssuesClient(
  settings: SentryIssuesSettings,
  opts: { fetchImpl?: typeof fetch; now?: () => number } = {},
): SentryIssuesClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { at: number; ttl: number; value: AdminErrorsDto } | null = null;
  let inFlight: Promise<AdminErrorsDto> | null = null;

  async function project(name: ErrorProject, slug: string) {
    const query = new URLSearchParams({
      query: `is:unresolved environment:${settings.environment}`,
      statsPeriod: '24h',
    });
    const url = `${settings.baseUrl}/api/0/projects/${encodeURIComponent(settings.org)}/${encodeURIComponent(slug)}/issues/?${query.toString()}`;
    try {
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { project: name, ok: false, issues: [] };
      const body: unknown = await res.json();
      const list = Array.isArray(body) ? body : [];
      const issues = list
        .slice(0, MAX_ISSUES)
        .map((raw) => toIssue(raw, settings))
        .filter((i): i is AdminErrorIssueDto => i !== null);
      return { project: name, ok: true, issues };
    } catch {
      return { project: name, ok: false, issues: [] };
    }
  }

  async function load(): Promise<AdminErrorsDto> {
    const entries = (Object.entries(settings.projects) as [ErrorProject, string | null][]).filter(
      (e): e is [ErrorProject, string] => e[1] !== null,
    );
    const projects = await Promise.all(entries.map(([name, slug]) => project(name, slug)));
    const value: AdminErrorsDto = {
      connected: true,
      environment: settings.environment,
      fetchedAt: new Date(now()).toISOString(),
      projects,
    };
    cached = { at: now(), ttl: projects.every((p) => p.ok) ? TTL_OK_MS : TTL_FAILED_MS, value };
    return value;
  }

  return {
    list() {
      if (cached && now() - cached.at < cached.ttl) return Promise.resolve(cached.value);
      inFlight ??= load().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

/** The answer while no read token is configured. */
export const NOT_CONNECTED: AdminErrorsDto = {
  connected: false,
  environment: null,
  fetchedAt: null,
  projects: [],
};
