import {
  claimOutboxBatch,
  markOutboxFailed,
  markOutboxRetry,
  markOutboxSent,
  openPayload,
  recordServerEvent,
  renewOutboxClaim,
  type Channel,
  type OutboxRow,
  withStatementTimeout,
  type Tx,
} from '@mechdost/db/repo';
import type { Keyring } from '@mechdost/db/crypto';
import { log, safeError } from '../logger';
import { PhaseTimeoutError, withDeadline } from './deadline';

/**
 * Notification dispatcher (spec 10). Runs in the worker. Claims due outbox rows only for channels that have an
 * adapter (code that queues a message checks the channel is enabled first, so nothing piles up for a channel
 * that is switched off), sends, and records the outcome:
 * - `retry`: exponential backoff 30 s → 1 h, up to 6 attempts, then failed.
 * - `later`: WhatsApp marketing frequency cap: retry in 24 h (Meta does not bill capped messages).
 * - `permanent`: failed now (bad number, not on WhatsApp, template missing); a fallback channel can take over.
 */
export type Failure = 'retry' | 'later' | 'permanent';

export class ChannelError extends Error {
  constructor(
    readonly failure: Failure,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ChannelError';
  }
}

export interface ChannelAdapter {
  readonly channel: Channel;
  send(row: OutboxRow): Promise<{ providerId: string | null }>;
}

/**
 * `email_sent` / `email_failed` and `push_sent` / `push_failed` server events (spec 12): template or notice kind,
 * language and an error code, never an address, token or text. The row is already recorded, so an analytics
 * failure is logged and never stops the dispatcher.
 */
async function recordOutcome(
  db: Tx,
  row: OutboxRow,
  outcome: { sent: true } | { sent: false; code: string },
): Promise<void> {
  if (row.channel !== 'email' && row.channel !== 'push') return;
  try {
    if (row.channel === 'push') {
      if (outcome.sent)
        await recordServerEvent(db, 'push_sent', {
          userId: row.recipientUserId,
          props: { kind: row.templateKey },
        });
      else
        await recordServerEvent(db, 'push_failed', {
          userId: row.recipientUserId,
          props: { code: outcome.code },
        });
    } else if (outcome.sent)
      await recordServerEvent(db, 'email_sent', {
        userId: row.recipientUserId,
        props: { template: row.templateKey, locale: row.locale },
      });
    else
      await recordServerEvent(db, 'email_failed', {
        userId: row.recipientUserId,
        props: { template: row.templateKey, code: outcome.code },
      });
  } catch (err) {
    log('warn', 'notify_event_failed', safeError(err));
  }
}

export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

/** Where a run is right now (and since when): the stuck line names it, and stuck is measured from the last progress. */
export interface DispatchPhase {
  current: string;
  since: number;
}

/** Per-step bounds, far under the 120 s lease: the database side (statement_timeout) and an app-side backstop. */
export const STEP_STATEMENT_MS = 8_000;
export const STEP_DEADLINE_MS = 12_000;
/** The whole provider call incl. its loaders (the Resend fetch itself is cut at 10 s). */
export const SEND_DEADLINE_MS = 30_000;

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  /** Rows whose claim was lost before sending (another worker owns them now). */
  skipped: number;
}

/**
 * Small batches (10 × ≤ 8 s send timeout = 80 s < 120 s lease) and a lease re-check right before each send:
 * a row reclaimed by another worker after our lease ran out is skipped, never sent twice (security review
 * 2026-11-02). Outcomes are recorded only while we still hold the claim token.
 */
export async function dispatchOnce(
  db: Tx,
  adapters: readonly ChannelAdapter[],
  opts: { limit?: number; keyring?: Keyring | null; phase?: DispatchPhase; sendDeadlineMs?: number } = {},
): Promise<DispatchResult> {
  const phase = opts.phase ?? { current: 'idle', since: Date.now() };
  const enter = (name: string) => {
    phase.current = name;
    phase.since = Date.now();
  };
  /** One bounded database step: local statement_timeout plus an app deadline, so no query can hold the tick. */
  const step = <T>(name: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    enter(name);
    return withDeadline(STEP_DEADLINE_MS, name, () => withStatementTimeout(db, STEP_STATEMENT_MS, fn));
  };
  /** Analytics event after the outcome is stored: bounded too, and a failure here never changes the outcome. */
  const outcomeOf = async (row: OutboxRow, outcome: Parameters<typeof recordOutcome>[2]): Promise<void> => {
    try {
      await step('event', (tx) => recordOutcome(tx, row, outcome));
    } catch (err) {
      log('warn', 'notify_event_failed', safeError(err));
    }
  };
  const limit = opts.limit ?? 10;
  const byChannel = new Map(adapters.map((a) => [a.channel, a]));
  const rows = await step('claim', (tx) => claimOutboxBatch(tx, { channels: [...byChannel.keys()], limit }));
  const result: DispatchResult = { claimed: rows.length, sent: 0, failed: 0, retried: 0, skipped: 0 };
  for (const row of rows) {
    const adapter = byChannel.get(row.channel);
    if (!adapter) continue;
    if (!(await step('renew', (tx) => renewOutboxClaim(tx, row)))) {
      result.skipped += 1;
      continue;
    }
    let open: OutboxRow;
    try {
      // Encrypted payload fields (e.g. the delivery code) are opened only here, just before the provider call.
      open = { ...row, payload: openPayload(row.payload, opts.keyring ?? null) };
    } catch {
      if (await step('record', (tx) => markOutboxFailed(tx, row, 'payload_decrypt'))) result.failed += 1;
      log('error', 'notify_payload_decrypt_failed', { channel: row.channel });
      continue;
    }
    try {
      enter('send');
      const { providerId } = await withDeadline(opts.sendDeadlineMs ?? SEND_DEADLINE_MS, 'send', () =>
        adapter.send(open),
      );
      // The mail is out: a slow database must not turn that into a retry (a second mail). Record it twice at most.
      let recorded: boolean | null = null;
      for (let i = 0; i < 2 && recorded === null; i += 1) {
        try {
          recorded = await step('record', (tx) => markOutboxSent(tx, row, providerId));
        } catch (err) {
          log('warn', 'notify_record_failed_after_send', { channel: row.channel, ...safeError(err) });
        }
      }
      // False = another worker took over after our send: logged code-free so the (rare) duplicate is visible.
      if (recorded) {
        result.sent += 1;
        await outcomeOf(row, { sent: true });
      } else log('warn', 'notify_claim_lost_after_send', { channel: row.channel });
    } catch (err) {
      const e =
        err instanceof ChannelError
          ? err
          : new ChannelError('retry', err instanceof PhaseTimeoutError ? 'send_timeout' : 'unexpected');
      if (e.failure === 'permanent') {
        if (await step('record', (tx) => markOutboxFailed(tx, row, e.code))) {
          result.failed += 1;
          await outcomeOf(row, { sent: false, code: e.code });
        }
      } else {
        const delay = e.failure === 'later' ? 86_400 : backoffSeconds(row.attempts);
        const outcome = await step('record', (tx) =>
          markOutboxRetry(tx, row, { error: e.code, delaySeconds: delay }),
        );
        if (outcome === 'failed') {
          result.failed += 1;
          await outcomeOf(row, { sent: false, code: e.code });
        } else if (outcome === 'retry') result.retried += 1;
      }
      // Codes only: never log the recipient or payload (PII, rule 16).
      log('warn', 'notify_send_failed', { channel: row.channel, code: e.code, failure: e.failure });
    }
  }
  enter('idle');
  return result;
}

export interface DispatcherOptions {
  db: Tx;
  adapters: readonly ChannelAdapter[];
  keyring?: Keyring | null;
  intervalMs?: number;
  /** A run with no progress (phase change) for this long is declared stuck and replaced by a new one. */
  tickTimeoutMs?: number;
  /** How often the `notify_tick` heartbeat line is logged (what the dispatcher did since the last one). */
  heartbeatMs?: number;
  /** Test seam; defaults to `dispatchOnce`. */
  dispatch?: (
    db: Tx,
    adapters: readonly ChannelAdapter[],
    opts: { keyring: Keyring | null; phase?: DispatchPhase },
  ) => Promise<DispatchResult>;
}

/**
 * A hung query must not stop sending forever (worker incident 2026-11-16): a run with no progress for `tickTimeoutMs` is logged (with the phase it sits in)
 * (`notify_tick_stuck`) and abandoned, and the next tick starts a fresh one. `notify_tick` is a periodic heartbeat with
 * the counts since the previous line: no heartbeat, or `claimed` at 0 while rows are pending, is the alert
 * (docs/runbooks/monitoring.md).
 */
export function startDispatcher(opts: DispatcherOptions): {
  stop(): Promise<void>;
} {
  const dispatch = opts.dispatch ?? dispatchOnce;
  const tickTimeoutMs = opts.tickTimeoutMs ?? 45_000;
  const totals = { ticks: 0, claimed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, stuck: 0, errors: 0 };
  let current: { promise: Promise<void>; startedAt: number; id: number; phase: DispatchPhase } | null = null;
  let generation = 0;
  const state = { stopped: false };
  const tick = () => {
    if (state.stopped || opts.adapters.length === 0) return;
    if (current) {
      const idleMs = Date.now() - Math.max(current.startedAt, current.phase.since);
      if (idleMs < tickTimeoutMs) return;
      totals.stuck += 1;
      log('error', 'notify_tick_stuck', {
        phase: current.phase.current,
        runningMs: Date.now() - current.startedAt,
        idleMs,
      });
      current = null;
    }
    generation += 1;
    const id = generation;
    const phase: DispatchPhase = { current: 'idle', since: Date.now() };
    const run = { startedAt: Date.now(), promise: Promise.resolve(), id, phase };
    totals.ticks += 1;
    run.promise = (async () => {
      try {
        let r: DispatchResult;
        do {
          r = await dispatch(opts.db, opts.adapters, { keyring: opts.keyring ?? null, phase });
          totals.claimed += r.claimed;
          totals.sent += r.sent;
          totals.failed += r.failed;
          totals.retried += r.retried;
          totals.skipped += r.skipped;
        } while (r.claimed > 0 && !state.stopped && generation === id);
      } catch (err) {
        totals.errors += 1;
        log('error', 'notify_dispatch_failed', { phase: phase.current, ...safeError(err) });
      }
    })().finally(() => {
      if (current?.id === id) current = null;
    });
    current = run;
  };
  const timer = setInterval(tick, opts.intervalMs ?? 2000);
  timer.unref();
  const channels = opts.adapters.map((a) => a.channel);
  const heartbeat = setInterval(() => {
    log('info', 'notify_tick', { channels, ...totals });
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = 0;
  }, opts.heartbeatMs ?? 300_000);
  heartbeat.unref();
  tick();
  return {
    async stop() {
      state.stopped = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      await current?.promise;
    },
  };
}
