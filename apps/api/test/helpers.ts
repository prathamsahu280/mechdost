import { syncRbacCatalogue } from '@mechdost/db/repo';
import { createTestDb, type TestDb } from '@mechdost/db/testing';
import type { Keyring } from '@mechdost/db/crypto';
import { createApp } from '../src/app';
import type { AssistantProvider } from '../src/assistant/provider';
import { TokenError, type TokenVerifier, type VerifiedToken } from '../src/auth/token-verifier';
import { loadConfig } from '../src/config';
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
  });
  return { app, db, verifier };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface ErrorJson {
  error: { code: string; message: string; requestId: string; details?: unknown };
}
