/**
 * TEMPORARY — Turnstile QA bypass (founder ruling R3, 2026-11-27; plan docs/qa/ustaad-simulation-plan-2026-11-27.md
 * § 2.2; spec 13; decision 2026-11-27 "QA Turnstile bypass (time-boxed)"). Lets the ten QA test accounts skip the
 * "are you human" check for one night while Playwright drives them. Everyone else, and these accounts outside the
 * window, get exactly the old behaviour.
 *
 * Controls:
 * - Off unless all three env variables are set: `QA_TURNSTILE_BYPASS_IDS` (comma-separated keyed hashes, at most 30),
 *   `QA_TURNSTILE_BYPASS_KEY` (≥ 32 characters) and `QA_TURNSTILE_BYPASS_UNTIL` (ISO-8601 UTC instant with `Z`).
 * - The API refuses to start when the instant is malformed or more than 12 h ahead; an instant already past means off
 *   (a restart after the run must not take the API down). Every call checks the window again.
 * - The allowlist holds only HMAC-SHA256(key, "user:<uuid>" | "phone:+91…" | "email:<lower-case>") — never a raw
 *   phone, email or id. The subject is always worked out by the server (verified session → user id; the typed sign-in
 *   identifier, normalised), never taken from a client flag.
 * - Every bypassed check writes one audit row (`security.turnstile_bypassed`); if that write fails, no bypass.
 * - Applies only where a route calls `verifyFor` with a subject: password sign-in and Ustaad join. Rate limits,
 *   lockouts, passwords, the staff two-step and permissions are untouched.
 *
 * Removal: delete this file, unwrap the verifier in `server.ts` (one call), drop the three env names from
 * `.env.example` and the deploy runbook.
 */
import { createHmac } from 'node:crypto';
import { recordSecurityAudit } from '@mechdost/db/repo';
import type { Tx } from '@mechdost/db/repo';
import type { SignInIdentifier } from '@mechdost/shared/auth';
import { log } from '../logger';
import type { TurnstileSubject, TurnstileVerifier, VerifyForInput } from './turnstile';

export interface QaTurnstileBypass {
  key: string;
  /** Epoch ms; the bypass applies only while now < until. */
  until: number;
  hashes: ReadonlySet<string>;
}

export interface QaBypassAuditRow {
  route: string;
  subjectKind: 'user' | 'identifier';
  userId: string | null;
  /** First 8 hex characters of the identifier hash (never the identifier). */
  hmacPrefix: string | null;
  requestId: string | null;
}
export type QaBypassAudit = (row: QaBypassAuditRow) => Promise<void>;

const MAX_WINDOW_MS = 12 * 3600_000;
const MAX_ENTRIES = 30;
const HASH = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

const subjectText = (s: TurnstileSubject): string =>
  s.kind === 'user' ? `user:${s.userId}` : identText(s.ident);
const identText = (i: SignInIdentifier): string => `${i.kind}:${i.value}`;

/** The allowlist entry for a subject (the runbook's one-liner calls this). */
export function qaBypassHash(key: string, subject: TurnstileSubject): string {
  return createHmac('sha256', key).update(subjectText(subject)).digest('hex');
}

/**
 * Reads the three variables at start-up. `null` = off. Throws (the API refuses to start) on a malformed or too-long
 * window, a short key, a raw value in the list or too many entries.
 */
export function loadQaTurnstileBypass(
  env: Record<string, string | undefined>,
  now: number,
): QaTurnstileBypass | null {
  const ids = env.QA_TURNSTILE_BYPASS_IDS?.trim() ?? '';
  // Trimmed like the others: a stray `\r` from an edited env file must not silently break every hash (review).
  const key = env.QA_TURNSTILE_BYPASS_KEY?.trim() ?? '';
  const untilRaw = env.QA_TURNSTILE_BYPASS_UNTIL?.trim() ?? '';
  if (!ids || !key || !untilRaw) {
    if (ids || key || untilRaw)
      log('warn', 'qa_turnstile_bypass_incomplete', { note: 'set all three or none' });
    return null;
  }
  if (!ISO_UTC.test(untilRaw) || Number.isNaN(Date.parse(untilRaw)))
    throw new Error('QA_TURNSTILE_BYPASS_UNTIL must be an ISO-8601 UTC instant ending in Z');
  const until = Date.parse(untilRaw);
  if (until - now > MAX_WINDOW_MS)
    throw new Error('QA_TURNSTILE_BYPASS_UNTIL must be at most 12 h ahead of the start-up time');
  if (key.length < 32) throw new Error('QA_TURNSTILE_BYPASS_KEY must be at least 32 characters');
  const hashes = ids
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  if (hashes.length > MAX_ENTRIES) throw new Error('QA_TURNSTILE_BYPASS_IDS holds at most 30 entries');
  if (!hashes.every((h) => HASH.test(h)))
    throw new Error('QA_TURNSTILE_BYPASS_IDS must hold only 64-character hex hashes (never raw values)');
  if (until <= now) {
    // Distinct from "unset": the variables are still on the server and should be cleared (runbook § 7.1).
    log('warn', 'qa_turnstile_bypass_expired', { until: new Date(until).toISOString() });
    return null;
  }
  return { key, until, hashes: new Set(hashes) };
}

/** Start-up log line: on with the window and counts only, or off. */
export function logQaTurnstileBypass(cfg: QaTurnstileBypass | null): void {
  if (!cfg) {
    log('info', 'qa_turnstile_bypass_off', {});
    return;
  }
  log('warn', 'qa_turnstile_bypass_on', {
    until: new Date(cfg.until).toISOString(),
    entries: cfg.hashes.size,
  });
}

/** Wraps a verifier: `verify` is untouched; `verifyFor` skips Cloudflare only for an allowlisted subject in the window. */
export function withQaTurnstileBypass(
  base: TurnstileVerifier,
  cfg: QaTurnstileBypass | null,
  audit: QaBypassAudit,
  now: () => number = Date.now,
): TurnstileVerifier {
  if (!cfg) return base;
  return {
    verify: (token, ip) => base.verify(token, ip),
    async verifyFor(input: VerifyForInput): Promise<boolean> {
      const subject = input.subject;
      if (subject && now() < cfg.until) {
        const hash = qaBypassHash(cfg.key, subject);
        if (cfg.hashes.has(hash)) {
          const row: QaBypassAuditRow = {
            route: input.route,
            subjectKind: subject.kind,
            userId: subject.kind === 'user' ? subject.userId : null,
            hmacPrefix: subject.kind === 'identifier' ? hash.slice(0, 8) : null,
            requestId: input.requestId ?? null,
          };
          try {
            await audit(row);
            log('warn', 'qa_turnstile_bypass_used', {
              route: row.route,
              subjectKind: row.subjectKind,
              ...(row.hmacPrefix ? { hmacPrefix: row.hmacPrefix } : {}),
            });
            return true;
          } catch {
            // No audit row, no bypass: fall through to the ordinary check.
            log('error', 'qa_turnstile_bypass_audit_failed', { route: row.route });
          }
        }
      }
      return base.verifyFor(input);
    },
  };
}

/**
 * The one call in `server.ts`: reads and checks the env at start-up (throws = the API does not start), logs on/off,
 * and returns the wrapper that audits each use with one `audit_log` row.
 */
export function qaTurnstileBypassFromEnv(
  env: Record<string, string | undefined>,
  db: Tx,
): (base: TurnstileVerifier) => TurnstileVerifier {
  const cfg = loadQaTurnstileBypass(env, Date.now());
  logQaTurnstileBypass(cfg);
  return (base) =>
    withQaTurnstileBypass(base, cfg, (row) =>
      recordSecurityAudit(db, {
        action: 'security.turnstile_bypassed',
        userId: row.userId,
        entity: 'turnstile',
        entityId: row.route,
        after: {
          route: row.route,
          subject_kind: row.subjectKind,
          ...(row.hmacPrefix ? { identifier_hmac_prefix: row.hmacPrefix } : {}),
          request_id: row.requestId,
        },
      }),
    );
}
