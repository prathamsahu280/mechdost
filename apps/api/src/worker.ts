/**
 * Worker entry (Cloud Run service with min 1 instance and CPU always allocated, or a VM): background loops that
 * must not live in request handlers: the live relay (decision 2026-11-01), the outbox dispatcher, the order/stock
 * timers, and PostHog forwarding (decision 2026-11-14).
 */
import { createDb, createListener } from '@mechdost/db';
import { loadKeyring, type Keyring } from '@mechdost/db/crypto';
import { grievanceContactLine } from '@mechdost/shared/company';
import { trustLineText } from '@mechdost/shared/content';
import { defaultEmailTrustLine } from '@mechdost/shared/email-layout';
import {
  bridgeInboundWhatsApp,
  emailOverrideFor,
  ensureEventPartitions,
  getCompany,
  getPublishedContent,
  expireDueAssignments,
  expireDueServiceRequests,
  releaseExpiredReservations,
  expireUnpaidOnlineOrders,
  expireDueCoins,
  releaseDueCoinRewards,
  expireQuotes,
  globalIntSetting,
  purgeOldNotices,
  queueOfferExpiryReminders,
  queueRefundOverdueAlerts,
  queueQuoteExpiringEmails,
  readForwardableEvents,
  resumeEndedPauses,
} from '@mechdost/db/repo';
import { createPosthogSender, startPosthogForwarder } from './analytics/posthog';
import { FailureBackoff } from './backoff';
import { dispatchDueRefunds, reconcileDueRefunds } from './payments/refunds';
import { httpRazorpay } from './payments/razorpay';
import { ConfigError, loadConfig } from './config';
import { pollingPublisher, type LivePublisher } from './live/publisher';
import { startDispatcher, type ChannelAdapter } from './notify/dispatcher';
import { createEmailAdapter } from './notify/email';
import { createFirebaseTransport, createPushAdapter } from './notify/push';
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
  ...(config.email
    ? [
        createEmailAdapter(config.email, {
          loadOverride: (key, locale) => emailOverrideFor(db, key, locale),
          // The grievance officer from Admin -> Company details; EMAIL_GRIEVANCE_CONTACT stays the fallback.
          loadGrievanceContact: async () => grievanceContactLine((await getCompany(db)).details),
          // Order emails' "genuine parts" footer line (Admin -> Content `trust.emailFooter`; design 2026-11-15).
          loadTrustLine: async (locale) =>
            trustLineText(
              (await getPublishedContent(db, { locale, cityId: null }))['trust.emailFooter'],
              defaultEmailTrustLine(locale),
            ),
        }),
      ]
    : []),
  // Web push through Firebase Cloud Messaging (spec 10, 2026-11-15): only with the real Firebase project (the
  // emulator and demo projects have no messaging). Tokens only exist once the VAPID key is set (Q103).
  ...(config.usingAuthEmulator || config.firebaseProjectId.startsWith('demo-')
    ? []
    : [
        createPushAdapter({
          db,
          webBaseUrl: config.webBaseUrl,
          transport: createFirebaseTransport({
            projectId: config.firebaseProjectId,
            keyFile: config.firebaseKeyFile,
          }),
        }),
      ]),
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

// Workshop acceptance timer (spec 06, workshops tier 1): requests waiting in `awaiting_workshop` past
// `service.acceptance_timeout_min` go back to routing and count against the workshop. Every 30 s; each expiry is its
// own compare-and-set transaction under the request lock, so several workers may run this safely.
let expiringRequests = false;
const requestTimer = setInterval(() => {
  if (expiringRequests) return;
  expiringRequests = true;
  void expireDueServiceRequests(db)
    .then(({ expired, failed }) => {
      if (expired > 0) log('info', 'service_requests_expired', { count: expired });
      for (const f of failed)
        log('error', 'service_request_expiry_failed', { requestId: f.requestId, ...safeError(f.error) });
    })
    .catch((err: unknown) => {
      log('error', 'service_request_expiry_failed', safeError(err));
    })
    .finally(() => {
      expiringRequests = false;
    });
}, 30_000);
requestTimer.unref();

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

// Approved refunds (spec 05, decision 2026-11-15): the approving request sends the refund to Razorpay at once; this
// sweep sends the ones that never went out (a crash after the approval) and retries failures with a growing delay.
// Razorpay's refund idempotency header makes every try safe. Only while Razorpay is configured.
let sendingRefunds = false;
const refundGateway = config.razorpay ? httpRazorpay(config.razorpay.keyId, config.razorpay.keySecret) : null;
const refundTimer = refundGateway
  ? setInterval(() => {
      if (sendingRefunds) return;
      sendingRefunds = true;
      void (async () => {
        const r = await dispatchDueRefunds(db, refundGateway);
        if (r.sent + r.retry + r.failed + r.reconcile > 0) log('info', 'refunds_dispatched', { ...r });
        if (r.failed > 0) log('error', 'refunds_failed', { count: r.failed });
        // Finance must look at these: Razorpay's outcome is unknown and the amount stays reserved.
        if (r.reconcile > 0) log('error', 'refunds_need_reconciliation', { count: r.reconcile });
        const c = await reconcileDueRefunds(db, refundGateway);
        if (c.found + c.absent > 0) log('info', 'refunds_reconciled', { ...c });
      })()
        .catch((err: unknown) => {
          log('error', 'refund_dispatch_failed', safeError(err));
        })
        .finally(() => {
          sendingRefunds = false;
        });
    }, 30_000)
  : null;
refundTimer?.unref();

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
    .then(async ({ offersExpired, expired, failed }) => {
      // The 24-hour "offer ends soon" email (design 2026-11-15); idempotent per offer, so every sweep may call it.
      const reminded = await queueQuoteExpiringEmails(db).catch((err: unknown) => {
        log('error', 'quote_expiring_email_failed', safeError(err));
        return 0;
      });
      if (reminded > 0) log('info', 'quote_expiring_emails_queued', { count: reminded });
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

// Bell and push (spec 10, design 2026-11-15). Each body catches its own errors (L141): a throw in an interval would
// become an unhandled rejection and stop the worker.
// 1) A shop is reminded `notifications.offer_expiry_reminder_min` minutes before an order offer expires (every 60 s;
//    one notice per offer and person, so repeated runs and several workers write nothing twice).
let reminding = false;
const reminderTimer = setInterval(() => {
  if (reminding) return;
  reminding = true;
  void (async () => {
    const minutes = await globalIntSetting(db, 'notifications.offer_expiry_reminder_min');
    const sent = await queueOfferExpiryReminders(db, minutes);
    if (sent > 0) log('info', 'offer_reminders_queued', { count: sent });
  })()
    .catch((err: unknown) => {
      log('error', 'offer_reminders_failed', safeError(err));
    })
    .finally(() => {
      reminding = false;
    });
}, 60_000);
reminderTimer.unref();
// 2) Refund requests past `refunds.approval_sla_hours` alert the finance staff once each (hourly).
let alertingRefunds = false;
const noticeHourlyTimer = setInterval(() => {
  if (alertingRefunds) return;
  alertingRefunds = true;
  void (async () => {
    const hours = await globalIntSetting(db, 'refunds.approval_sla_hours');
    const sent = await queueRefundOverdueAlerts(db, hours);
    if (sent > 0) log('info', 'refund_overdue_alerts_queued', { count: sent });
  })()
    .catch((err: unknown) => {
      log('error', 'refund_overdue_alerts_failed', safeError(err));
    })
    .finally(() => {
      alertingRefunds = false;
    });
}, 3_600_000);
noticeHourlyTimer.unref();
// 3) Retention: bell rows older than `notifications.retention_days` are deleted (every 24 h, and once at start).
const purgeNotices = () => {
  void globalIntSetting(db, 'notifications.retention_days')
    .then((days) => purgeOldNotices(db, days))
    .then((n) => {
      if (n > 0) log('info', 'notifications_purged', { count: n });
    })
    .catch((err: unknown) => {
      log('error', 'notifications_purge_failed', safeError(err));
    });
};
purgeNotices();
const retentionTimer = setInterval(purgeNotices, 24 * 3_600_000);
retentionTimer.unref();

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
  clearInterval(requestTimer);
  clearInterval(holdTimer);
  clearInterval(pauseTimer);
  clearInterval(paymentTimer);
  if (refundTimer) clearInterval(refundTimer);
  clearInterval(coinTimer);
  clearInterval(quoteTimer);
  clearInterval(partitionTimer);
  clearInterval(reminderTimer);
  clearInterval(noticeHourlyTimer);
  clearInterval(retentionTimer);
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
