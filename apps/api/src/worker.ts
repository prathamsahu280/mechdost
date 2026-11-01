/**
 * Worker entry (Cloud Run service with min 1 instance and CPU always allocated, or a VM): background loops that
 * must not live in request handlers. Today: the live relay (decision 2026-11-01). pg-boss timers join here.
 */
import { createDb, createListener } from '@mechdost/db';
import { ConfigError, loadConfig } from './config';
import { pollingPublisher, type LivePublisher } from './live/publisher';
import { startRelay } from './live/relay';
import { createRtdbPublisher } from './live/rtdb';
import { log } from './logger';

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

const { db, sql } = createDb(config.databaseUrl, { max: 2, transactionPooler: true });
const publisher: LivePublisher =
  config.live.transport === 'rtdb' && config.live.databaseUrl
    ? createRtdbPublisher({ projectId: config.firebaseProjectId, databaseUrl: config.live.databaseUrl })
    : pollingPublisher;
const relay = startRelay({ db, publisher });
log('info', 'worker_started', { live: publisher.name, listen: Boolean(config.live.listenUrl) });

// LISTEN needs a session connection (not the transaction pooler); without it the 1 s sweep still delivers.
const listener = config.live.listenUrl
  ? createListener(config.live.listenUrl, 'live_outbox', () => {
      relay.wake();
    })
  : null;
listener?.ready.catch((err: unknown) => {
  log('warn', 'live_listen_failed', { error: err instanceof Error ? err.message : String(err) });
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutdown', { signal });
  void relay
    .stop()
    .then(() => Promise.all([sql.end({ timeout: 5 }), listener?.end()]))
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
