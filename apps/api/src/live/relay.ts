import {
  claimLiveBatch,
  claimLiveRevocations,
  markLiveRevocationsDone,
  markLiveSent,
  oldestPendingLiveMs,
  purgeSentLive,
  resolveLiveRecipients,
  type Tx,
} from '@mechdost/db/repo';
import { log, safeError } from '../logger';
import type { LiveDelivery, LivePublisher } from './publisher';

/**
 * Live relay (decision 2026-11-01): claim → resolve recipients from Postgres → publish → mark sent. Runs in the
 * always-on worker, not in request handlers (the API stays stateless). At-least-once: if publishing fails the rows
 * stay unsent and come back when their lease lapses; clients drop duplicates with the version gate.
 */
export interface RelayResult {
  claimed: number;
  delivered: number;
}

/** Wipes inboxes of people who lost access (security review follow-up). */
export async function revokeOnce(db: Tx, publisher: LivePublisher): Promise<number> {
  const rows = await claimLiveRevocations(db);
  if (rows.length === 0) return 0;
  await publisher.forget([...new Set(rows.map((r) => r.firebaseUid))]);
  await markLiveRevocationsDone(
    db,
    rows.map((r) => r.id),
  );
  return rows.length;
}

export async function relayOnce(db: Tx, publisher: LivePublisher, limit = 200): Promise<RelayResult> {
  await revokeOnce(db, publisher);
  const rows = await claimLiveBatch(db, { limit });
  if (rows.length === 0) return { claimed: 0, delivered: 0 };
  const byTopic = new Map<string, string[]>();
  for (const topic of new Set(rows.map((r) => r.topic))) {
    byTopic.set(
      topic,
      (await resolveLiveRecipients(db, topic)).map((r) => r.firebaseUid),
    );
  }
  const batch: LiveDelivery[] = rows.map((r) => ({ recipients: byTopic.get(r.topic) ?? [], ping: r.ping }));
  await publisher.publish(batch);
  await markLiveSent(
    db,
    rows.map((r) => r.id),
  );
  return { claimed: rows.length, delivered: batch.reduce((n, d) => n + d.recipients.length, 0) };
}

export interface RelayHandle {
  /** Run a pass now (called by the LISTEN wake-up). */
  wake(): void;
  stop(): Promise<void>;
}

/**
 * Loop: a pass on every wake-up (pg_notify) plus a sweep every `intervalMs` as the backstop; sent rows are purged
 * hourly; lag over 5 s is logged as an alert (research/realtime-alternatives.md §9).
 */
export function startRelay(opts: {
  db: Tx;
  publisher: LivePublisher;
  intervalMs?: number;
  alertLagMs?: number;
}): RelayHandle {
  const interval = opts.intervalMs ?? 1000;
  const alertLag = opts.alertLagMs ?? 5000;
  let running: Promise<void> | null = null;
  // Mutable flags live in an object: wake() flips them while a pass awaits.
  const state = { again: false, stopped: false };
  const repeatRequested = () => state.again && !state.stopped;
  let lastPurge = 0;

  const pass = async () => {
    do {
      state.again = false;
      try {
        let result: RelayResult;
        do {
          result = await relayOnce(opts.db, opts.publisher);
        } while (result.claimed > 0 && !state.stopped);
        const lag = await oldestPendingLiveMs(opts.db);
        if (lag > alertLag) log('warn', 'live_relay_lag', { lagMs: Math.round(lag) });
        if (Date.now() - lastPurge > 3_600_000) {
          lastPurge = Date.now();
          await purgeSentLive(opts.db);
        }
      } catch (err) {
        log('error', 'live_relay_failed', {
          transport: opts.publisher.name,
          ...safeError(err),
        });
      }
    } while (repeatRequested());
  };

  const wake = () => {
    if (state.stopped) return;
    if (running) {
      state.again = true;
      return;
    }
    running = pass().finally(() => {
      running = null;
    });
  };

  const timer = setInterval(wake, interval);
  timer.unref();
  wake();
  return {
    wake,
    async stop() {
      state.stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
