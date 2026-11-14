/**
 * Worker entry (Cloud Run service with min 1 instance and CPU always allocated, or a VM): background loops that
 * must not live in request handlers: the live relay (decision 2026-11-01), the outbox dispatcher, the order/stock
 * timers, and PostHog forwarding (decision 2026-11-14).
 */
import { createDb, createListener } from '@mechdost/db';
import { loadKeyring, type Keyring } from '@mechdost/db/crypto';
import {
  bridgeInboundWhatsApp,
  ensureEventPartitions,
  expireDueAssignments,
  releaseExpiredReservations,
  expireUnpaidOnlineOrders,
  expireDueCoins,
  releaseDueCoinRewards,
  expireQuotes,
  readForwardableEvents,
  resumeEndedPauses,
} from '@mechdost/db/repo';
import { createPosthogSender, startPosthogForwarder } from './analytics/posthog';
import { FailureBackoff } from './backoff';
import { ConfigError, loadConfig } from './config';
import { pollingPublisher, type LivePublisher } from './live/publisher';
import { startDispatcher, type ChannelAdapter } from './notify/dispatcher';
import { createEmailAdapter } from './notify/email';
import { createWhatsAppAdapter } from './notify/whatsapp';
import { startRelay } from './live/relay';
import { createRtdbPublisher } from './live/rtdb';
import { log, safeError } from './logger';
import { startSentry } from './monitoring/sentry';

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
const sentry = await startSentry(config.sentry, 'worker');

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
const adapters: ChannelAdapter[] = [
  ...(config.whatsapp ? [createWhatsAppAdapter(config.whatsapp)] : []),
  ...(config.email ? [createEmailAdapter(config.email)] : []),
];
// Encrypted payload fields (delivery codes, invite tokens) need the data keyring; a channel without it must not start.
let keyring: Keyring | null = null;
if (adapters.length > 0) {
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

// Pauses with an end date resume by themselves (Q28, user 2026-11-13). Every 60 s; each shop is its own
// compare-and-set, so several workers may run this safely.
let resuming = false;
const pauseTimer = setInterval(() => {
  if (resuming) return;
  resuming = true;
  void resumeEndedPauses(db)
    .then((count) => {
      if (count > 0) log('info', 'pauses_ended', { count });
    })
    .catch((err: unknown) => {
      log('error', 'pause_resume_failed', safeError(err));
    })
    .finally(() => {
      resuming = false;
    });
}, 60_000);
pauseTimer.unref();

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

// Unpaid online orders (Razorpay, plan 2026-11-12): after `checkout.online_payment_minutes` of the order's city the
// order is cancelled and its stock goes back on sale. Every 60 s; one transaction per group.
let expiringPayments = false;
const paymentTimer = setInterval(() => {
  if (expiringPayments) return;
  expiringPayments = true;
  void expireUnpaidOnlineOrders(db)
    .then(({ closed, failed }) => {
      if (closed > 0) log('info', 'unpaid_orders_expired', { count: closed });
      if (failed > 0) log('error', 'unpaid_orders_expiry_failed', { failedGroups: failed });
    })
    .catch((err: unknown) => {
      log('error', 'unpaid_orders_expiry_failed', safeError(err));
    })
    .finally(() => {
      expiringPayments = false;
    });
}, 60_000);
paymentTimer.unref();

// MechDost Coins (spec 20, Q24): rewards whose unlock days have passed become coins; unused coins past their expiry
// lapse. Every 10 minutes; one transaction per reward (row locked, skip locked) or per customer (account row
// locked), each idempotent by its ledger key, so several workers may run this safely.
let coinWork = false;
const coinTimer = setInterval(() => {
  if (coinWork) return;
  coinWork = true;
  void (async () => {
    const released = await releaseDueCoinRewards(db);
    if (released.credited > 0) log('info', 'coin_rewards_credited', { count: released.credited });
    for (const f of released.failed)
      log('error', 'coin_reward_failed', { rewardId: f.rewardId, ...safeError(f.error) });
    const expired = await expireDueCoins(db);
    if (expired.expired > 0) log('info', 'coins_expired', { customers: expired.expired });
    // Customer ids stay out of the log (pseudonymous analytics only); the count is enough to alert on.
    if (expired.failed.length > 0) log('error', 'coin_expiry_failed', { customers: expired.failed.length });
  })()
    .catch((err: unknown) => {
      log('error', 'coin_jobs_failed', safeError(err));
    })
    .finally(() => {
      coinWork = false;
    });
}, 600_000);
coinTimer.unref();

// Bulk quotes (spec 19): offers past `valid_until` and quotes nobody wrote on close as `expired`. Every 5 min; one
// transaction per quote (quote row locked first), so several workers may run this safely.
// A quote that keeps failing is skipped for a growing delay (1 min doubling to 6 h) and logged with its id and
// error code only (no data from the error text).
let expiringQuotes = false;
const quoteBackoff = new FailureBackoff({ baseMs: 60_000, maxMs: 6 * 3_600_000 });
const quoteTimer = setInterval(() => {
  if (expiringQuotes) return;
  expiringQuotes = true;
  void expireQuotes(db, { skip: quoteBackoff.skipped(Date.now()) })
    .then(({ offersExpired, expired, failed }) => {
      if (offersExpired > 0) log('info', 'quote_offers_expired', { count: offersExpired });
      if (expired > 0) log('info', 'quotes_expired', { count: expired });
      for (const f of failed) {
        const retryInMs = quoteBackoff.fail(f.quoteId, Date.now());
        log('error', 'quote_expiry_failed', { quoteId: f.quoteId, code: f.code, retryInMs });
      }
    })
    .catch((err: unknown) => {
      log('error', 'quote_expiry_failed', safeError(err));
    })
    .finally(() => {
      expiringQuotes = false;
    });
}, 300_000);
quoteTimer.unref();

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
// PostHog EU (decision 2026-11-14): consented events from the store, every 10 s, never on a request path. Rows
// wait 60 s (late commits); after a restart the read starts 10 minutes back (PostHog drops duplicates by uuid).
const posthog = config.posthog
  ? startPosthogForwarder({
      read: (after, limit) => readForwardableEvents(db, { after, limit, lagSeconds: 60, startMinutes: 10 }),
      sender: createPosthogSender(config.posthog),
      webBaseUrl: config.webBaseUrl,
      intervalMs: 10_000,
      log,
    })
  : null;

log('info', 'worker_started', {
  posthog: Boolean(posthog),
  sentry: Boolean(config.sentry),
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
  clearInterval(pauseTimer);
  clearInterval(paymentTimer);
  clearInterval(coinTimer);
  clearInterval(quoteTimer);
  clearInterval(partitionTimer);
  void Promise.all([relay.stop(), dispatcher.stop(), posthog?.stop()])
    .then(() => Promise.all([sql.end({ timeout: 5 }), listener?.end(), sentry.flush()]))
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
