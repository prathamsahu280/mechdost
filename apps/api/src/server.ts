/**
 * Process entry (Cloud Run asia-south1 / local `pnpm dev`). Wires real dependencies into `createApp`,
 * listens on PORT and shuts down gracefully on SIGTERM (Cloud Run gives 10 s).
 */
import { serve } from '@hono/node-server';
import { createDb } from '@mechdost/db';
import { createApp } from './app';
import { createFirebaseVerifier } from './auth/firebase-verifier';
import { ConfigError, loadConfig } from './config';
import { log } from './logger';
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

const { db, sql } = createDb(config.databaseUrl, { max: config.databasePoolMax, transactionPooler: true });
const rateLimiter = config.upstash ? new UpstashRateLimiter(config.upstash) : new MemoryRateLimiter();
if (!config.upstash) log('warn', 'rate_limit_memory', { note: 'in-memory limiter — development only' });

const app = createApp({
  config,
  db,
  verifier: createFirebaseVerifier(config.firebaseProjectId),
  rateLimiter,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log('info', 'listening', { port: info.port, env: config.env, authEmulator: config.usingAuthEmulator });
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutdown', { signal });
  server.close(() => {
    void sql.end({ timeout: 5 }).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
