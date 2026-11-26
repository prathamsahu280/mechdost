import { syncRbacCatalogue } from '@mechdost/db/repo';
import { createTestDb, type TestDb } from '@mechdost/db/testing';
import type { Keyring } from '@mechdost/db/crypto';
import { createApp } from '../src/app';
import type { AssistantProvider } from '../src/assistant/provider';
import type { EmailActionLinks } from '../src/auth/email-actions';
import type { PasswordAuthority } from '../src/auth/password-authority';
import type { TurnstileVerifier } from '../src/auth/turnstile';
import { TokenError, type TokenVerifier, type VerifiedToken } from '../src/auth/token-verifier';
import { loadConfig } from '../src/config';
import type { PreviewDeps } from '../src/ustaad/link-preview';
import type { PhotoByteCache } from '../src/photos/byte-cache';
import type { PhotoStorage } from '../src/photos/storage';
import type { RazorpayGateway } from '../src/payments/razorpay';
import type { SentryIssuesClient } from '../src/monitoring/sentry-issues';
import { setLogSink } from '../src/logger';
import type { Revalidator } from '../src/revalidate';
import { MemoryRateLimiter, type RateLimiter } from '../src/rate-limit/limiter';
import type { SmartCorrectionEngine } from '../src/ustaad/correction/engine';
import type { MediaHost } from '../src/ustaad/media/host';

export const ALLOWED_ORIGIN = 'http://localhost:3000';

/** Fake Firebase: tokens are registered per test; anything else is invalid. Records revocation checks. */
export class FakeVerifier implements TokenVerifier {
  readonly tokens = new Map<string, VerifiedToken | TokenError>();
  readonly calls: { checkRevoked: boolean }[] = [];
  /** Tokens Firebase would report revoked or disabled — only when the caller asks it to check (as the real one). */
  readonly revoked = new Map<string, 'TOKEN_REVOKED' | 'USER_DISABLED'>();

  add(token: string, identity: Partial<VerifiedToken> & { firebaseUid: string }) {
    this.tokens.set(token, {
      phone: null,
      email: null,
      emailVerified: false,
      authTime: Math.floor(Date.now() / 1000),
      signInProvider: 'phone',
      // Most tests act as a fully signed-in staff member; staff-session tests set this to false explicitly.
      staff2fa: true,
      ...identity,
    });
    return token;
  }

  verify(token: string, opts: { checkRevoked: boolean }): Promise<VerifiedToken> {
    this.calls.push(opts);
    const t = this.tokens.get(token);
    if (!t) return Promise.reject(new TokenError('TOKEN_INVALID'));
    if (t instanceof TokenError) return Promise.reject(t);
    const revoked = this.revoked.get(token);
    if (opts.checkRevoked && revoked) return Promise.reject(new TokenError(revoked));
    return Promise.resolve(t);
  }
}

/** Fake Firebase password store: email (case-insensitive) → uid + password. Records every check. */
export class FakePasswordAuthority implements PasswordAuthority {
  private readonly accounts = new Map<string, { uid: string; password: string }>();
  private readonly emails = new Map<string, string>();
  readonly checks: string[] = [];
  failNext = false;

  add(email: string, uid: string, password: string) {
    this.accounts.set(email.toLowerCase(), { uid, password });
    this.emails.set(uid, email);
  }

  emailOf(uid: string): Promise<string | null> {
    return Promise.resolve(this.emails.get(uid) ?? null);
  }

  check(email: string, password: string): Promise<string | null> {
    this.checks.push(email);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('firebase down'));
    }
    const a = this.accounts.get(email.toLowerCase());
    return Promise.resolve(a?.password === password ? a.uid : null);
  }

  customToken(uid: string, claims?: Record<string, boolean>): Promise<string> {
    return Promise.resolve(`ct:${uid}:${JSON.stringify(claims ?? {})}`);
  }

  readonly revoked: string[] = [];
  revokeSessions(uid: string): Promise<void> {
    this.revoked.push(uid);
    return Promise.resolve();
  }
}

/** Fake Turnstile: only the listed tokens are human. */
/** Fake Firebase Admin links: reset codes per email, verification per uid; records what was asked. */
export class FakeEmailActions implements EmailActionLinks {
  readonly resets = new Map<string, string>();
  readonly verifications = new Map<string, { email: string; code: string }>();
  /** The last password change Firebase knows of, per email (`email`: the address on the record, when it differs). */
  readonly changes = new Map<string, { uid: string; changedAt: Date; createdAt?: Date; email?: string }>();
  readonly asked: string[] = [];
  fail = false;

  passwordChangeFor(
    by: { email: string } | { uid: string },
  ): Promise<{ uid: string; email: string; changedAt: Date; createdAt: Date } | null> {
    this.asked.push('email' in by ? `changed:${by.email}` : `changed-uid:${by.uid}`);
    if (this.fail) return Promise.reject(new Error('firebase down'));
    const hit =
      'email' in by
        ? ([by.email, this.changes.get(by.email)] as const)
        : [...this.changes].find(([, v]) => v.uid === by.uid);
    const [key, v] = hit ?? [];
    if (!key || !v) return Promise.resolve(null);
    return Promise.resolve({
      uid: v.uid,
      email: v.email ?? key,
      changedAt: v.changedAt,
      createdAt: v.createdAt ?? new Date(Date.now() - 86_400_000),
    });
  }

  passwordResetCode(email: string): Promise<string | null> {
    this.asked.push(`reset:${email}`);
    if (this.fail) return Promise.reject(new Error('firebase down'));
    return Promise.resolve(this.resets.get(email) ?? null);
  }

  verificationFor(uid: string): Promise<{ email: string; code: string } | null> {
    this.asked.push(`verify:${uid}`);
    if (this.fail) return Promise.reject(new Error('firebase down'));
    return Promise.resolve(this.verifications.get(uid) ?? null);
  }
}

export class FakeTurnstile implements TurnstileVerifier {
  constructor(private readonly human: readonly string[]) {}
  verify(token: string): Promise<boolean> {
    return Promise.resolve(this.human.includes(token));
  }
}

let sharedDb: TestDb | undefined;

/** One migrated PGlite per test file (migrations take a few seconds); apps are cheap to rebuild. */
export async function testDb(): Promise<TestDb> {
  if (!sharedDb) {
    sharedDb = (await createTestDb()).db;
    await syncRbacCatalogue(sharedDb);
  }
  return sharedDb;
}

export async function buildApp(
  opts: {
    rateLimiter?: RateLimiter;
    env?: Record<string, string>;
    assistant?: AssistantProvider | null;
    keyring?: Keyring | null;
    passwordAuth?: PasswordAuthority | null;
    turnstile?: TurnstileVerifier | null;
    emailActions?: EmailActionLinks | null;
    razorpay?: RazorpayGateway | null;
    sentryIssues?: SentryIssuesClient | null;
    photoStorage?: PhotoStorage | null;
    photoCache?: PhotoByteCache | null;
    revalidate?: Revalidator;
    smartCorrection?: SmartCorrectionEngine | null;
    mediaHost?: MediaHost | null;
    linkPreview?: PreviewDeps | null;
  } = {},
) {
  setLogSink(() => undefined);
  const db = await testDb();
  const verifier = new FakeVerifier();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_POOL_URL: 'postgres://test',
    CORS_ORIGINS: ALLOWED_ORIGIN,
    ...opts.env,
  });
  const app = createApp({
    config,
    db,
    verifier,
    rateLimiter: opts.rateLimiter ?? new MemoryRateLimiter(),
    assistant: opts.assistant ?? null,
    keyring: opts.keyring ?? null,
    passwordAuth: opts.passwordAuth ?? null,
    turnstile: opts.turnstile ?? null,
    emailActions: opts.emailActions ?? null,
    razorpay: opts.razorpay ?? null,
    sentryIssues: opts.sentryIssues ?? null,
    photoStorage: opts.photoStorage ?? null,
    photoCache: opts.photoCache ?? null,
    ...(opts.revalidate ? { revalidate: opts.revalidate } : {}),
    smartCorrection: opts.smartCorrection ?? null,
    mediaHost: opts.mediaHost ?? null,
    linkPreview: opts.linkPreview ?? null,
  });
  return { app, db, verifier };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface ErrorJson {
  error: { code: string; message: string; requestId: string; details?: unknown };
}
