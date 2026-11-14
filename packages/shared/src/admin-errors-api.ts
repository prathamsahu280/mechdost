/**
 * Admin → Errors (decision 2026-11-14, spec 08): the latest unresolved Sentry issues of the website and the API, as
 * `GET /v1/admin/errors` returns them (`apps/api/src/routes/admin-errors.ts`). Counts only — no user emails, IPs or
 * event payloads ever reach the browser; titles are scrubbed again on the server. Loaded only by the real sign-in
 * admin screen (dynamic import).
 */
import { z } from 'zod';

export const ERROR_PROJECTS = ['web', 'api'] as const;
export type ErrorProject = (typeof ERROR_PROJECTS)[number];
export const ERROR_LEVELS = ['fatal', 'error', 'warning', 'info', 'debug'] as const;

export const AdminErrorIssue = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  shortId: z.string().max(64),
  title: z.string().max(500),
  level: z.enum(ERROR_LEVELS),
  count24h: z.number().int().min(0),
  countTotal: z.number().int().min(0),
  usersAffected: z.number().int().min(0),
  firstSeen: z.string(),
  lastSeen: z.string(),
  link: z.url(),
});
export type AdminErrorIssueDto = z.infer<typeof AdminErrorIssue>;

export const AdminErrorProject = z.object({
  project: z.enum(ERROR_PROJECTS),
  /** False when Sentry could not be reached for this project (the other one may still show). */
  ok: z.boolean(),
  issues: z.array(AdminErrorIssue),
});

export const AdminErrors = z.object({
  /** False until the read token, org and projects are set on the server (the panel shows "not connected"). */
  connected: z.boolean(),
  environment: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  projects: z.array(AdminErrorProject),
});
export type AdminErrorsDto = z.infer<typeof AdminErrors>;
