/**
 * Worker entry (Cloud Run service with min 1 instance and CPU always allocated, or a VM): background loops that
 * must not live in request handlers: the live relay (decision 2026-11-01), the outbox dispatcher, the order/stock
 * timers, and PostHog forwarding (decision 2026-11-14).
 */
import { RSA_PAYMENT_WINDOW_MINUTES } from '@mechdost/shared/rsa';
import { createDb, createListener } from '@mechdost/db';
import { sweepWatch } from './sweep-watch';
import { loadKeyring, type Keyring } from '@mechdost/db/crypto';
import { grievanceContactLine } from '@mechdost/shared/company';
import { trustLineText } from '@mechdost/shared/content';
import { defaultEmailTrustLine } from '@mechdost/shared/email-layout';
import {
  autoCloseResolvedTickets,
  bridgeInboundWhatsApp,
  emailOverrideFor,
  ensureEventPartitions,
  getCompany,
  getPublishedContent,
  expireDueAssignments,
  expireDueServiceRequests,
  expireDueRsaOffers,
  expireDueDeliveryOffers,
  resumePausedAgents,
  expireUnpaidRsa,
  releaseExpiredReservations,
  expireUnpaidOnlineOrders,
  buildDueDataExports,
  expireDataExports,
  expireDueCoins,
  notifyServedWaitlist,
  recomputeCopurchase,
  recordDailyPrices,
  buildUstaadZoneCounts,
  expireUstaadJobs,
  purgeUstaadRemovedArchive,
  runUstaadReportClock,
  sendUstaadRulesReminders,
  expireUstaadStories,
  releaseDueCoinRewards,
  expireQuotes,
  globalIntSetting,
  lastUsageRunAt,
  loadBillSource,
  purgeFinishedNotices,
  purgeOldNotices,
  queueOfferExpiryReminders,
  queueRefundOverdueAlerts,
  queueQuoteExpiringEmails,
  readForwardableEvents,
  resumeEndedPauses,
  withStatementTimeout,
  type Tx,
} from '@mechdost/db/repo';
import { createPosthogSender, startPosthogForwarder } from './analytics/posthog';
import { runUstaadHourly, runUstaadNightly, type UstaadHourlyState } from './ustaad/identity-jobs';
import { FailureBackoff } from './backoff';
import { dispatchDueRefunds, reconcileDueRefunds } from './payments/refunds';
import { httpRazorpay } from './payments/razorpay';
import { ConfigError, loadConfig } from './config';
import { pollingPublisher, type LivePublisher } from './live/publisher';
import { withDeadline } from './notify/deadline';
import { startDispatcher, type ChannelAdapter } from './notify/dispatcher';
import { createEmailAdapter } from './notify/email';
import { createBillAttachmentLoader } from './notify/pdf/attachment';
import { createFirebaseTransport, createPushAdapter } from './notify/push';
import { createWhatsAppAdapter } from './notify/whatsapp';
import { startRelay } from './live/relay';
import { createRtdbPublisher } from './live/rtdb';
import { log, safeError } from './logger';
import { startSentry } from './monitoring/sentry';
import { runUsageCheck, usageSourcesFromConfig } from './usage/check';

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
/**
 * Send-time lookups of the email adapter (template override, company, trust line, bill source): a local
 * statement_timeout plus an app deadline, so a slow or locked query falls back to the safe default text instead of
 * holding a mail for the 120 s server timeout (incident 2026-11-16, SQLSTATE 57014).
 */
// Live 2026-11-28: the mail lookups shared the 2-connection sweep pool and waited behind ~9 interval sweeps until their
// deadlines, so the bill mails (most lookups) failed every retry with send_timeout. They get their own small pool.
const mailLookups = createDb(config.databaseUrl, { max: 2, transactionPooler: true });
const bounded = <T>(ms: number, name: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withDeadline(ms + 2_000, name, () => withStatementTimeout(mailLookups.db, ms, fn));
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
          loadOverride: (key, locale) => bounded(4_000, 'override', (d) => emailOverrideFor(d, key, locale)),
          // The grievance officer from Admin -> Company details; EMAIL_GRIEVANCE_CONTACT stays the fallback.
          loadGrievanceContact: async () =>
            bounded(4_000, 'grievance', async (d) => grievanceContactLine((await getCompany(d)).details)),
          // The bill / receipt PDF on the bill emails (Q194): built here from the stored bill or order, not queued.
          loadAttachment: createBillAttachmentLoader({
            loadSource: (input) => bounded(10_000, 'bill_source', (d) => loadBillSource(d, input)),
            loadCompany: () => bounded(4_000, 'company', async (d) => (await getCompany(d)).details),
          }),
          // Order emails' "genuine parts" footer line (Admin -> Content `trust.emailFooter`; design 2026-11-15).
          loadTrustLine: async (locale) =>
            trustLineText(
              (await bounded(4_000, 'trust_line', (d) => getPublishedContent(d, { locale, cityId: null })))[
                'trust.emailFooter'
              ],
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
// The dispatcher has its own connection so long background jobs (exports, copurchase) can never starve it.
// A channel without its key is off by design (rows for it stay pending), so the start line says which are off.
const notifyConn = createDb(config.databaseUrl, { max: 1, transactionPooler: true });
if (!config.email) log('warn', 'notify_channel_off', { channel: 'email', missing: 'RESEND_API_KEY' });
if (!config.whatsapp) log('warn', 'notify_channel_off', { channel: 'whatsapp', missing: 'WHATSAPP_*' });
const dispatcher = startDispatcher({ db: notifyConn.db, adapters, keyring });

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

// Roadside (spec 22): an offer past the city's accept timer goes back to the dispatch queue, and a request whose advance
// was not paid within the window is closed (nothing was charged). Every 30 s; each is its own compare-and-set
// transaction under the request lock, so several workers may run this safely.
// Delivery agents (spec 24): offers past their timer go back to the admin queue; paused agents with an end date
// resume. One transaction per offer, so several workers may run this safely.
// DC-B11: a heartbeat (due count) every 10 min and one warning when a run hangs, so "nothing due" and "stuck" differ.
const deliveryWatch = sweepWatch('delivery_offers', {
  heartbeatEvery: 20,
  stuckAfterMs: 120_000,
  log: (message, data) => {
    log(message === 'sweep_stuck' ? 'warn' : 'info', message, data);
  },
});
let deliveryDue = 0;
const deliveryTimer = setInterval(() => {
  if (!deliveryWatch.begin(Date.now())) return;
  deliveryDue = 0;
  void expireDueDeliveryOffers(db)
    .then(async ({ due, expired, failed }) => {
      deliveryDue = due;
      if (expired > 0) log('info', 'delivery_offers_expired', { count: expired });
      // A due offer that neither expired nor failed would otherwise be silent (DC-B11): say so.
      if (due > expired + failed.length)
        log('warn', 'delivery_offers_not_expired', { due, expired, failed: failed.length });
      for (const f of failed)
        log('error', 'delivery_offer_expiry_failed', { offerId: f.offerId, ...safeError(f.error) });
      const resumed = await resumePausedAgents(db);
      if (resumed > 0) log('info', 'delivery_agents_resumed', { count: resumed });
    })
    .catch((err: unknown) => {
      log('error', 'delivery_sweep_failed', safeError(err));
    })
    .finally(() => {
      deliveryWatch.end(Date.now(), { due: deliveryDue });
    });
}, 30_000);

let expiringRsa = false;
const rsaTimer = setInterval(() => {
  if (expiringRsa) return;
  expiringRsa = true;
  void expireDueRsaOffers(db)
    .then(async ({ expired, failed }) => {
      if (expired > 0) log('info', 'rsa_offers_expired', { count: expired });
      for (const f of failed)
        log('error', 'rsa_offer_expiry_failed', { offerId: f.offerId, ...safeError(f.error) });
      const unpaid = await expireUnpaidRsa(db, { olderThanMinutes: RSA_PAYMENT_WINDOW_MINUTES });
      if (unpaid.closed > 0) log('info', 'rsa_unpaid_closed', { count: unpaid.closed });
      for (const f of unpaid.failed)
        log('error', 'rsa_unpaid_close_failed', { requestId: f.requestId, ...safeError(f.error) });
    })
    .catch((err: unknown) => {
      log('error', 'rsa_sweep_failed', safeError(err));
    })
    .finally(() => {
      expiringRsa = false;
    });
}, 30_000);
rsaTimer.unref();
deliveryTimer.unref();

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

// Support auto-close (design 2026-11-15 item 5): a request "resolved" `support.auto_close_days` ago with no customer
// reply is closed. Every 10 min; one conditional UPDATE per request on its version, so several workers are safe.
let closingTickets = false;
const ticketCloseTimer = setInterval(() => {
  if (closingTickets) return;
  closingTickets = true;
  void autoCloseResolvedTickets(db, new Date())
    .then(({ closed, skipped }) => {
      if (closed > 0 || skipped > 0) log('info', 'support_auto_closed', { closed, skipped });
    })
    .catch((err: unknown) => {
      log('error', 'support_auto_close_failed', safeError(err));
    })
    .finally(() => {
      closingTickets = false;
    });
}, 600_000);
ticketCloseTimer.unref();

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

// Ustaad Network identity jobs (spec 23 § 8 worker jobs; plan task B5; `ustaad/identity-jobs.ts`): hourly attestation
// expiry and qualified followers for members whose followers changed; nightly ring check (§ 14, SR-10), counter
// reconcile, 30-day counters, qualified followers, level recompute, badge awards and the evidence purge. Each step is
// idempotent (conditional UPDATEs, unique keys), so several workers may run it; one member failing never stops the rest.
let ustaadWork = false;
let ustaadLastNightly = 0;
const ustaadHourly: UstaadHourlyState = { followCursor: null };
const ustaadTimer = setInterval(() => {
  if (ustaadWork) return;
  ustaadWork = true;
  void (async () => {
    const hourly = await runUstaadHourly(db, ustaadHourly);
    if (hourly.expired > 0) log('info', 'ustaad_attestations_expired', { count: hourly.expired });
    if (Date.now() - ustaadLastNightly < 24 * 3_600_000) return;
    ustaadLastNightly = Date.now();
    const r = await runUstaadNightly(db, log);
    log('info', 'ustaad_identity_nightly', { ...r });
    if (r.failed > 0) log('error', 'ustaad_levels_failed', { members: r.failed });
  })()
    .catch((err: unknown) => {
      log('error', 'ustaad_jobs_failed', safeError(err));
    })
    .finally(() => {
      ustaadWork = false;
    });
}, 3_600_000);
ustaadTimer.unref();

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
// 3) Retention: bell rows older than `notifications.retention_days` are deleted, and so are the ones the person removed
//    (after 7 days), whose action is done (after 1 day) and read information older than `notifications.info_clear_days`
//    (every 24 h, and once at start; batched deletes, spec 10).
const purgeNotices = () => {
  void globalIntSetting(db, 'notifications.retention_days')
    .then((days) => purgeOldNotices(db, days))
    .then((n) => {
      if (n > 0) log('info', 'notifications_purged', { count: n });
      return globalIntSetting(db, 'notifications.info_clear_days');
    })
    .then((infoDays) => purgeFinishedNotices(db, { infoDays }))
    .then((done) => {
      const n = done.dismissed + done.resolved + done.info;
      if (n > 0) log('info', 'notifications_cleared', done);
    })
    .catch((err: unknown) => {
      log('error', 'notifications_purge_failed', safeError(err));
    });
};
purgeNotices();
const retentionTimer = setInterval(purgeNotices, 24 * 3_600_000);
retentionTimer.unref();

// Catalogue tier 2 (design 2026-11-15): background jobs that must not live in request handlers. Each body catches its
// own errors (L141) and is skipped while the previous run is still going.
// 1) "Bought together" counts (spec 11): rebuilt from delivered orders once a night (03:00 IST, checked hourly) and once
//    a minute after start, so a fresh deploy has them. One transaction under an advisory lock: two workers never overlap
//    and a repeat gives the same table.
let recomputing = false;
const recomputeCopurchaseNow = () => {
  if (recomputing) return;
  recomputing = true;
  void recomputeCopurchase(db, {})
    .then((r) => {
      if (r.ran) log('info', 'copurchase_computed', { pairs: r.pairs });
    })
    .catch((err: unknown) => {
      log('error', 'copurchase_failed', safeError(err));
    })
    .finally(() => {
      recomputing = false;
    });
};
const copurchaseStart = setTimeout(recomputeCopurchaseNow, 60_000);
copurchaseStart.unref();
const copurchaseTimer = setInterval(() => {
  const istHour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  if (istHour === 3) recomputeCopurchaseNow();
}, 3_600_000);
copurchaseTimer.unref();
// Daily price history (decision 2026-11-26 "Your savings"; Consumer Protection E-Commerce amendment from 1 Jan 2027):
// each live pack's printed MRP and lowest customer price per city, once per IST day. Checked hourly and at start; the
// insert is ON CONFLICT DO NOTHING, so a repeat (or a second worker) writes nothing and the day's first reading stays.
const recordPricesNow = () => {
  const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  void recordDailyPrices(db, day)
    .then((rows) => {
      if (rows > 0) log('info', 'price_history_recorded', { day, rows });
    })
    .catch((err: unknown) => {
      log('error', 'price_history_failed', safeError(err));
    });
};
const priceStart = setTimeout(recordPricesNow, 90_000);
priceStart.unref();
const priceTimer = setInterval(recordPricesNow, 3_600_000);
priceTimer.unref();
// Ustaad Network (spec 23 § 8 worker jobs, plan workstream E):
// a) `ustaad_zone_counts`: zone counts rebuilt nightly (02:00 IST, checked hourly) under an advisory lock, so two
//    workers never overlap; the member API bands them (SR-31). Refresh nightly only (no on-demand rebuild).
let zoning = false;
const ustaadZoneTimer = setInterval(() => {
  const istHour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  if (istHour !== 2 || zoning) return;
  zoning = true;
  void buildUstaadZoneCounts(db)
    .then((r) => {
      if (r.ran) log('info', 'ustaad_zone_counts_built', { zones: r.zones });
    })
    .catch((err: unknown) => {
      log('error', 'ustaad_zone_counts_failed', safeError(err));
    })
    .finally(() => {
      zoning = false;
    });
}, 3_600_000);
ustaadZoneTimer.unref();
// b) `ustaad_jobs_expire`: open/paused jobs past their expiry → expired, live applications closed (every 10 min;
//    conditional updates on (id, status, version), so overlapping workers are harmless).
let expiringJobs = false;
const ustaadJobsTimer = setInterval(() => {
  if (expiringJobs) return;
  expiringJobs = true;
  void expireUstaadJobs(db)
    .then((n) => {
      if (n > 0) log('info', 'ustaad_jobs_expired', { count: n });
    })
    .catch((err: unknown) => {
      log('error', 'ustaad_jobs_expire_failed', safeError(err));
    })
    .finally(() => {
      expiringJobs = false;
    });
}, 600_000);
ustaadJobsTimer.unref();
// c) `ustaad_report_clock` (every minute, F2): moderators get `staff.ustaad_report_overdue` at 50 % and 100 % of each
//    report's clock (once per stage, the notice version dedupes), and bans/restrictions past their end date end.
let ustaadClockRunning = false;
const ustaadClockTimer = setInterval(() => {
  if (ustaadClockRunning) return;
  ustaadClockRunning = true;
  void runUstaadReportClock(db)
    .then((r) => {
      if (r.half + r.overdue + r.lifted > 0) log('info', 'ustaad_report_clock', r);
    })
    .catch((err: unknown) => {
      log('error', 'ustaad_report_clock_failed', safeError(err));
    })
    .finally(() => {
      ustaadClockRunning = false;
    });
}, 60_000);
ustaadClockTimer.unref();
// d) `ustaad_removed_archive_purge` (hourly check, F2): archive rows past `mod.retention_days` (180) without a legal
//    hold are deleted and their archived media marked for the media purge; held rows and their media stay.
// e) `ustaad_rules_reminder` (same hourly tick): the Community Rules reminder once per `mod.rules_reminder_days`
//    period to every member (notice version = period number, so reruns and overlapping workers send nothing twice).
let ustaadHousekeeping = false;
const ustaadHousekeepingTimer = setInterval(() => {
  if (ustaadHousekeeping) return;
  ustaadHousekeeping = true;
  void (async () => {
    const purged = await purgeUstaadRemovedArchive(db);
    if (purged > 0) log('info', 'ustaad_removed_archive_purged', { count: purged });
    let afterId: string | null = null;
    let sent = 0;
    for (let i = 0; i < 200; i += 1) {
      const r = await sendUstaadRulesReminders(db, { afterId, batch: 500 });
      sent += r.sent;
      if (!r.lastId) break;
      afterId = r.lastId;
    }
    if (sent > 0) log('info', 'ustaad_rules_reminder_sent', { count: sent });
  })()
    .catch((err: unknown) => {
      log('error', 'ustaad_housekeeping_failed', safeError(err));
    })
    .finally(() => {
      ustaadHousekeeping = false;
    });
}, 3_600_000);
ustaadHousekeepingTimer.unref();
// d) `ustaad_story_expire` (D1): visible stories past `expires_at` → expired and their media scheduled for the purge
//    after `stories.purge_grace_hours` (every 5 min; reads already hide expired stories on the DB clock).
let expiringStories = false;
const ustaadStoriesTimer = setInterval(() => {
  if (expiringStories) return;
  expiringStories = true;
  void expireUstaadStories(db, { limit: 500 })
    .then((n) => {
      if (n > 0) log('info', 'ustaad_stories_expired', { count: n });
    })
    .catch((err: unknown) => {
      log('error', 'ustaad_story_expire_failed', safeError(err));
    })
    .finally(() => {
      expiringStories = false;
    });
}, 300_000);
ustaadStoriesTimer.unref();
// 2) Data downloads (Account -> Privacy): build the waiting ones (a few per run, each its own transaction with a row
//    lock) and clear the files past their 24 hours. Every 30 s.
let exporting = false;
const exportTimer = setInterval(() => {
  if (exporting) return;
  exporting = true;
  void (async () => {
    const built = await buildDueDataExports(db, {});
    if (built.ready + built.failed > 0) log('info', 'data_exports_built', built);
    const cleared = await expireDataExports(db, {});
    if (cleared > 0) log('info', 'data_exports_expired', { count: cleared });
  })()
    .catch((err: unknown) => {
      log('error', 'data_exports_failed', safeError(err));
    })
    .finally(() => {
      exporting = false;
    });
}, 30_000);
exportTimer.unref();
// 3) "Notify me": customers waiting for a PIN that is now served are told once (every 5 min; the row flips to
//    notified in the same transaction as the notice).
let tellingWaitlist = false;
const waitlistTimer = setInterval(() => {
  if (tellingWaitlist) return;
  tellingWaitlist = true;
  void notifyServedWaitlist(db, {})
    .then((n) => {
      if (n > 0) log('info', 'waitlist_notified', { count: n });
    })
    .catch((err: unknown) => {
      log('error', 'waitlist_notify_failed', safeError(err));
    })
    .finally(() => {
      tellingWaitlist = false;
    });
}, 300_000);
waitlistTimer.unref();

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
// Usage & limits (founder 2026-11-26; runbook monitoring.md): the daily check. Every hour (and 2 minutes after start)
// it runs when the last daily check finished more than 23 h ago, so a restart never skips a day. Measuring happens
// outside any transaction; storing and alerting is one short transaction under an advisory lock (two workers never
// alert twice: one alert per metric, level and month is a unique row).
let checkingUsage = false;
const usageSources = usageSourcesFromConfig(config);
const dailyUsageCheck = () => {
  if (checkingUsage) return;
  checkingUsage = true;
  void lastUsageRunAt(db, 'schedule')
    .then(async (last) => {
      if (last && Date.now() - last.getTime() < 23 * 3_600_000) return;
      const r = await runUsageCheck(db, usageSources, { trigger: 'schedule', actor: { type: 'system' } });
      log('info', 'usage_checked', { stored: r.stored, alerts: r.alerts.length, ...r.statuses });
    })
    .catch((err: unknown) => {
      log('error', 'usage_check_failed', safeError(err));
    })
    .finally(() => {
      checkingUsage = false;
    });
};
const usageStart = setTimeout(dailyUsageCheck, 120_000);
usageStart.unref();
const usageTimer = setInterval(dailyUsageCheck, 3_600_000);
usageTimer.unref();
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
  clearInterval(ticketCloseTimer);
  clearInterval(pauseTimer);
  clearInterval(paymentTimer);
  if (refundTimer) clearInterval(refundTimer);
  clearInterval(coinTimer);
  clearInterval(ustaadTimer);
  clearInterval(quoteTimer);
  clearInterval(partitionTimer);
  clearTimeout(usageStart);
  clearInterval(usageTimer);
  clearInterval(reminderTimer);
  clearInterval(noticeHourlyTimer);
  clearInterval(retentionTimer);
  clearTimeout(copurchaseStart);
  clearInterval(copurchaseTimer);
  clearInterval(priceTimer);
  clearTimeout(priceStart);
  clearInterval(exportTimer);
  clearInterval(waitlistTimer);
  clearInterval(ustaadZoneTimer);
  clearInterval(ustaadJobsTimer);
  clearInterval(ustaadClockTimer);
  clearInterval(ustaadHousekeepingTimer);
  void Promise.all([relay.stop(), dispatcher.stop(), posthog?.stop()])
    .then(() =>
      Promise.all([
        sql.end({ timeout: 5 }),
        notifyConn.sql.end({ timeout: 5 }),
        mailLookups.sql.end({ timeout: 5 }),
        listener?.end(),
        sentry.flush(),
      ]),
    )
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
