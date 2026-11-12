import { syncRbacCatalogue } from '@mechdost/db/repo';
import { createTestDb, type TestDb } from '@mechdost/db/testing';
import type { Keyring } from '@mechdost/db/crypto';
import { createApp } from '../src/app';
import type { AssistantProvider } from '../src/assistant/provider';
import type { PasswordAuthority } from '../src/auth/password-authority';
import type { TurnstileVerifier } from '../src/auth/turnstile';
import { TokenError, type TokenVerifier, type VerifiedToken } from '../src/auth/token-verifier';
import { loadConfig } from '../src/config';
import type { RazorpayGateway } from '../src/payments/razorpay';
import { setLogSink } from '../src/logger';
import { MemoryRateLimiter, type RateLimiter } from '../src/rate-limit/limiter';

export const ALLOWED_ORIGIN = 'http://localhost:3000';

/** Fake Firebase: tokens are registered per test; anything else is invalid. Records revocation checks. */
export class FakeVerifier implements TokenVerifier {
  readonly tokens = new Map<string, VerifiedToken | TokenError>();
  readonly calls: { checkRevoked: boolean }[] = [];

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
}

/** Fake Turnstile: only the listed tokens are human. */
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
    razorpay?: RazorpayGateway | null;
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
    razorpay: opts.razorpay ?? null,
  });
  return { app, db, verifier };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface ErrorJson {
  error: { code: string; message: string; requestId: string; details?: unknown };
}
