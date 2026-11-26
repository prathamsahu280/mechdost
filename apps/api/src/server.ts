/**
 * Process entry (Cloud Run asia-south1 / local `pnpm dev`). Wires real dependencies into `createApp`,
 * listens on PORT and shuts down gracefully on SIGTERM (Cloud Run gives 10 s).
 */
import { serve } from '@hono/node-server';
import { createDb, keepPoolWarm } from '@mechdost/db';
import { addUsageCounts } from '@mechdost/db/repo';
import { loadKeyring, type Keyring } from '@mechdost/db/crypto';
import { createApp } from './app';
import { r2MediaHost } from './ustaad/media/r2';
import { supabaseMediaHost } from './ustaad/media/supabase';
import { countingMediaHost, createUsageCounter } from './usage/counter';
import { createAnthropicProvider } from './assistant/provider';
import { createAnthropicCorrection } from './ustaad/correction/anthropic';
import { memoryCorrectionCache, redisCorrectionCache } from './ustaad/correction/cache';
import { memoryFeedSnapshots, redisFeedSnapshots } from './ustaad/feed/snapshot';
import { defaultPreviewDeps } from './ustaad/link-preview';
import { createGeminiCorrection } from './ustaad/correction/gemini';
import { createFirebaseEmailActionLinks } from './auth/email-actions';
import { createFirebaseVerifier } from './auth/firebase-verifier';
import { createFirebasePasswordAuthority } from './auth/password-authority';
import { createTurnstileVerifier } from './auth/turnstile';
import { httpRazorpay } from './payments/razorpay';
import { ConfigError, loadConfig } from './config';
import { log, safeError } from './logger';
import { startSentry } from './monitoring/sentry';
import { createSentryIssuesClient } from './monitoring/sentry-issues';
import { supabaseStorage } from './photos/storage';
import { createPhotoByteCache } from './photos/byte-cache';
import { MemoryRateLimiter } from './rate-limit/limiter';
import { Redis } from '@upstash/redis';
import { RedisRestRateLimiter } from './rate-limit/redis-rest';

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
// Open connections at boot and keep two warm: the first request after a pause no longer pays a TLS + SCRAM handshake.
const stopWarm = keepPoolWarm(() => sql`select 1`, { connections: Math.min(2, config.databasePoolMax) });
// The server's own Redis behind SRH (or Upstash), spoken to with the Upstash REST client (decision 2026-11-24).
const redis = config.upstash ? new Redis({ url: config.upstash.url, token: config.upstash.token }) : null;
const rateLimiter = redis ? new RedisRestRateLimiter(redis) : new MemoryRateLimiter();
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

// Ustaad Network media (spec 23 § 10): R2 when its keys exist and MEDIA_HOST=r2, else Supabase Storage (Q-U1).
const um = config.ustaadMedia;
// Usage & limits (founder 2026-11-26): R2 calls are counted in memory (estimated Class A/B) and flushed every minute.
const usageCounter = createUsageCounter();
const mediaHost =
  um.host === 'r2' && um.r2
    ? countingMediaHost(r2MediaHost({ ...um.r2, buckets: um.buckets }), usageCounter)
    : um.supabase
      ? supabaseMediaHost({ ...um.supabase, buckets: um.buckets })
      : null;
if (um.host === 'r2' && !um.r2)
  log('warn', 'ustaad_media_r2_missing', { note: 'R2_* not set — using Supabase Storage' });
if (!mediaHost) log('warn', 'ustaad_media_disabled', { note: 'no media host — Ustaad uploads answer 503' });

const app = createApp({
  keyring,
  config,
  db,
  verifier: createFirebaseVerifier(config.firebaseProjectId, config.firebaseKeyFile),
  rateLimiter,
  assistant: config.assistant ? createAnthropicProvider(config.assistant) : null,
  // Ustaad smart correction (spec 23 § 11): an LLM only when SMART_CORRECTION_PROVIDER names one; else the word list.
  smartCorrection: !config.smartCorrection
    ? null
    : config.smartCorrection.provider === 'anthropic'
      ? createAnthropicCorrection(config.smartCorrection)
      : createGeminiCorrection(config.smartCorrection),
  correctionCache: redis ? redisCorrectionCache(redis) : memoryCorrectionCache(),
  feedSnapshots: redis ? redisFeedSnapshots(redis) : memoryFeedSnapshots(),
  linkPreview: defaultPreviewDeps(),
  passwordAuth: config.firebaseApiKey
    ? createFirebasePasswordAuthority({
        projectId: config.firebaseProjectId,
        apiKey: config.firebaseApiKey,
        keyFile: config.firebaseKeyFile,
        ...(config.authEmulatorHost ? { emulatorHost: config.authEmulatorHost } : {}),
      })
    : null,
  emailActions: createFirebaseEmailActionLinks({
    projectId: config.firebaseProjectId,
    keyFile: config.firebaseKeyFile,
  }),
  turnstile: config.turnstileSecret ? createTurnstileVerifier(config.turnstileSecret) : null,
  razorpay: config.razorpay ? httpRazorpay(config.razorpay.keyId, config.razorpay.keySecret) : null,
  sentryIssues: config.sentryIssues ? createSentryIssuesClient(config.sentryIssues) : null,
  photoStorage,
  mediaHost,
  photoCache: config.photoCacheBytes > 0 ? createPhotoByteCache(config.photoCacheBytes) : null,
});
if (!config.firebaseApiKey || !config.turnstileSecret)
  log('warn', 'password_sign_in_disabled', {
    note: 'FIREBASE_API_KEY or TURNSTILE_SECRET_KEY not set — /v1/auth/password returns 503',
  });
if (!config.assistant)
  log('warn', 'assistant_disabled', {
    note: 'assistant off (ASSISTANT_ENABLED is not true or ANTHROPIC_API_KEY is unset) — /v1/assistant returns 503',
  });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log('info', 'listening', { port: info.port, env: config.env, authEmulator: config.usingAuthEmulator });
  // RAZORPAY_ALLOW_TEST_KEYS (pre-launch testing): online payments are fake. Never with real customers.
  if (config.env === 'production' && config.razorpay?.testMode)
    log('warn', 'razorpay_test_keys_in_production', {
      note: 'online payments are test payments; switch to live keys before real customers',
    });
});

const flushUsage = () =>
  usageCounter
    .flush((period, deltas) => addUsageCounts(db, period, deltas))
    .catch((err: unknown) => {
      log('warn', 'usage_counts_flush_failed', safeError(err));
    });
const usageFlushTimer = setInterval(() => {
  void flushUsage();
}, 60_000);
usageFlushTimer.unref();

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutdown', { signal });
  stopWarm();
  clearInterval(usageFlushTimer);
  server.close(() => {
    void flushUsage()
      .then(() => Promise.all([sql.end({ timeout: 5 }), sentry.flush()]))
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
