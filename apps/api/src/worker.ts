/**
 * Worker entry (Cloud Run service with min 1 instance and CPU always allocated, or a VM): background loops that
 * must not live in request handlers. Today: the live relay (decision 2026-11-01). pg-boss timers join here.
 */
import { createDb, createListener } from '@mechdost/db';
import { loadKeyring, type Keyring } from '@mechdost/db/crypto';
import {
  bridgeInboundWhatsApp,
  ensureEventPartitions,
  expireDueAssignments,
  releaseExpiredReservations,
} from '@mechdost/db/repo';
import { ConfigError, loadConfig } from './config';
import { pollingPublisher, type LivePublisher } from './live/publisher';
import { startDispatcher, type ChannelAdapter } from './notify/dispatcher';
import { createWhatsAppAdapter } from './notify/whatsapp';
import { startRelay } from './live/relay';
import { createRtdbPublisher } from './live/rtdb';
import { log, safeError } from './logger';

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
    ? createRtdbPublisher({
        projectId: config.firebaseProjectId,
        databaseUrl: config.live.databaseUrl,
        keyFile: config.firebaseKeyFile,
      })
    : pollingPublisher;
const relay = startRelay({ db, publisher });
const adapters: ChannelAdapter[] = config.whatsapp ? [createWhatsAppAdapter(config.whatsapp)] : [];
// Encrypted payload fields (delivery codes) need the data keyring; WhatsApp without it must not start.
let keyring: Keyring | null = null;
if (config.whatsapp) {
  try {
    keyring = loadKeyring(process.env);
  } catch (err) {
    log('error', 'worker_keyring_missing', safeError(err));
    process.exit(1);
  }
}
const dispatcher = startDispatcher({ db, adapters, keyring });

// Inbound WhatsApp → support tickets (spec 09). Only while WhatsApp is on; one event per transaction.
let bridging = false;
const bridgeTimer = config.whatsapp
  ? setInterval(() => {
      if (bridging) return;
      bridging = true;
      void bridgeInboundWhatsApp(db, { cityCode: config.defaultCityCode })
        .then((r) => {
          if (r.processed > 0) log('info', 'whatsapp_bridge', { ...r });
        })
        .catch((err: unknown) => {
          log('error', 'whatsapp_bridge_failed', safeError(err));
        })
        .finally(() => {
          bridging = false;
        });
    }, 5000)
  : null;
bridgeTimer?.unref();

// Shop accept timers (spec 04): offers past their DB-clock deadline go back to admin for rerouting. Every 30 s;
// each expiry is its own compare-and-set transaction, so several workers may run this safely.
let expiring = false;
const expiryTimer = setInterval(() => {
  if (expiring) return;
  expiring = true;
  void expireDueAssignments(db)
    .then(({ expired, failed }) => {
      if (expired > 0) log('info', 'assignments_expired', { count: expired });
      for (const f of failed)
        log('error', 'assignment_expiry_failed', { assignmentId: f.assignmentId, ...safeError(f.error) });
    })
    .catch((err: unknown) => {
      log('error', 'assignment_expiry_failed', safeError(err));
    })
    .finally(() => {
      expiring = false;
    });
}, 30_000);
expiryTimer.unref();

// Stock hold expiry (spec 04): holds past `checkout.cod_reservation_minutes` go back on sale. Every 60 s; one
// transaction per hold (order row locked first), so several workers may run this safely.
let releasing = false;
const holdTimer = setInterval(() => {
  if (releasing) return;
  releasing = true;
  void releaseExpiredReservations(db)
    .then(({ released, failed }) => {
      if (released > 0) log('info', 'reservations_expired', { count: released });
      for (const f of failed)
        log('error', 'reservation_expiry_failed', { reservationId: f.reservationId, ...safeError(f.error) });
    })
    .catch((err: unknown) => {
      log('error', 'reservation_expiry_failed', safeError(err));
    })
    .finally(() => {
      releasing = false;
    });
}, 60_000);
holdTimer.unref();

// Event store partitions (spec 12): this month + 3 ahead, checked at start and every 12 h (idempotent).
const partitions = () => {
  void ensureEventPartitions(db)
    .then((n) => {
      if (n > 0) log('info', 'event_partitions_created', { count: n });
    })
    .catch((err: unknown) => {
      log('error', 'event_partitions_failed', safeError(err));
    });
};
partitions();
const partitionTimer = setInterval(partitions, 12 * 3_600_000);
partitionTimer.unref();
log('info', 'worker_started', {
  live: publisher.name,
  listen: Boolean(config.live.listenUrl),
  channels: adapters.map((a) => a.channel),
});

// LISTEN needs a session connection (not the transaction pooler); without it the 1 s sweep still delivers.
const listener = config.live.listenUrl
  ? createListener(config.live.listenUrl, 'live_outbox', () => {
      relay.wake();
    })
  : null;
listener?.ready.catch((err: unknown) => {
  log('warn', 'live_listen_failed', safeError(err));
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutdown', { signal });
  if (bridgeTimer) clearInterval(bridgeTimer);
  clearInterval(expiryTimer);
  clearInterval(holdTimer);
  clearInterval(partitionTimer);
  void Promise.all([relay.stop(), dispatcher.stop()])
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
