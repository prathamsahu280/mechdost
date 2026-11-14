/**
 * Process entry (Cloud Run asia-south1 / local `pnpm dev`). Wires real dependencies into `createApp`,
 * listens on PORT and shuts down gracefully on SIGTERM (Cloud Run gives 10 s).
 */
import { serve } from '@hono/node-server';
import { createDb } from '@mechdost/db';
import { loadKeyring, type Keyring } from '@mechdost/db/crypto';
import { createApp } from './app';
import { createAnthropicProvider } from './assistant/provider';
import { createFirebaseVerifier } from './auth/firebase-verifier';
import { createFirebasePasswordAuthority } from './auth/password-authority';
import { createTurnstileVerifier } from './auth/turnstile';
import { httpRazorpay } from './payments/razorpay';
import { ConfigError, loadConfig } from './config';
import { log, safeError } from './logger';
import { startSentry } from './monitoring/sentry';
import { createSentryIssuesClient } from './monitoring/sentry-issues';
import { supabaseStorage } from './photos/storage';
import { MemoryRateLimiter } from './rate-limit/limiter';
import { UpstashRateLimiter } from './rate-limit/upstash';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    log('error', 'config_invalid', { issues: err.issues });
    process.exit(1);
  }
  throw err;
}

// Error reports (decision 2026-11-14): no-op without SENTRY_DSN.
const sentry = await startSentry(config.sentry, 'api');

const { db, sql } = createDb(config.databaseUrl, { max: config.databasePoolMax, transactionPooler: true });
const rateLimiter = config.upstash ? new UpstashRateLimiter(config.upstash) : new MemoryRateLimiter();
if (!config.upstash) log('warn', 'rate_limit_memory', { note: 'in-memory limiter — development only' });

// Data keyring (spec 13): delivery codes are encrypted. Required in production; without it in development the
// delivery-code steps answer 503 and everything else works.
let keyring: Keyring | null = null;
try {
  keyring = loadKeyring(process.env);
} catch (err) {
  if (config.env === 'production') {
    log('error', 'keyring_missing', safeError(err));
    process.exit(1);
  }
  log('warn', 'keyring_missing', { note: 'DATA_ENCRYPTION_* not set — delivery codes unavailable' });
}

// Job photos (design 2026-11-15): a private Storage bucket, created if missing. A failure here is logged, not fatal:
// uploads then answer 503 until it is fixed (runbook photos.md).
const photoStorage = config.photoStorage ? supabaseStorage(config.photoStorage) : null;
if (photoStorage)
  void photoStorage.ensureBucket().catch((err: unknown) => {
    log('error', 'photo_bucket_failed', safeError(err));
  });
else
  log('warn', 'photos_disabled', {
    note: 'SUPABASE_URL / SUPABASE_SECRET_KEY not set — job photos unavailable',
  });

const app = createApp({
  keyring,
  config,
  db,
  verifier: createFirebaseVerifier(config.firebaseProjectId, config.firebaseKeyFile),
  rateLimiter,
  assistant: config.assistant ? createAnthropicProvider(config.assistant) : null,
  passwordAuth: config.firebaseApiKey
    ? createFirebasePasswordAuthority({
        projectId: config.firebaseProjectId,
        apiKey: config.firebaseApiKey,
        keyFile: config.firebaseKeyFile,
        ...(config.authEmulatorHost ? { emulatorHost: config.authEmulatorHost } : {}),
      })
    : null,
  turnstile: config.turnstileSecret ? createTurnstileVerifier(config.turnstileSecret) : null,
  razorpay: config.razorpay ? httpRazorpay(config.razorpay.keyId, config.razorpay.keySecret) : null,
  sentryIssues: config.sentryIssues ? createSentryIssuesClient(config.sentryIssues) : null,
  photoStorage,
});
if (!config.firebaseApiKey || !config.turnstileSecret)
  log('warn', 'password_sign_in_disabled', {
    note: 'FIREBASE_API_KEY or TURNSTILE_SECRET_KEY not set — /v1/auth/password returns 503',
  });
if (!config.assistant)
  log('warn', 'assistant_disabled', { note: 'ANTHROPIC_API_KEY not set — /v1/assistant returns 503' });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log('info', 'listening', { port: info.port, env: config.env, authEmulator: config.usingAuthEmulator });
  // RAZORPAY_ALLOW_TEST_KEYS (pre-launch testing): online payments are fake. Never with real customers.
  if (config.env === 'production' && config.razorpay?.testMode)
    log('warn', 'razorpay_test_keys_in_production', {
      note: 'online payments are test payments; switch to live keys before real customers',
    });
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutdown', { signal });
  server.close(() => {
    void Promise.all([sql.end({ timeout: 5 }), sentry.flush()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
