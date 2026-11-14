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
  type Tx,
} from '@mechdost/db/repo';
import type { Keyring } from '@mechdost/db/crypto';
import { log, safeError } from '../logger';

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
 * `email_sent` / `email_failed` server events (spec 12): template, language and an error code, never an address or
 * text. The row is already recorded, so an analytics failure is logged and never stops the dispatcher.
 */
async function recordEmailOutcome(
  db: Tx,
  row: OutboxRow,
  outcome: { sent: true } | { sent: false; code: string },
): Promise<void> {
  if (row.channel !== 'email') return;
  try {
    if (outcome.sent)
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
  opts: { limit?: number; keyring?: Keyring | null } = {},
): Promise<DispatchResult> {
  const limit = opts.limit ?? 10;
  const byChannel = new Map(adapters.map((a) => [a.channel, a]));
  const rows = await claimOutboxBatch(db, { channels: [...byChannel.keys()], limit });
  const result: DispatchResult = { claimed: rows.length, sent: 0, failed: 0, retried: 0, skipped: 0 };
  for (const row of rows) {
    const adapter = byChannel.get(row.channel);
    if (!adapter) continue;
    if (!(await renewOutboxClaim(db, row))) {
      result.skipped += 1;
      continue;
    }
    let open: OutboxRow;
    try {
      // Encrypted payload fields (e.g. the delivery code) are opened only here, just before the provider call.
      open = { ...row, payload: openPayload(row.payload, opts.keyring ?? null) };
    } catch {
      if (await markOutboxFailed(db, row, 'payload_decrypt')) result.failed += 1;
      log('error', 'notify_payload_decrypt_failed', { channel: row.channel });
      continue;
    }
    try {
      const { providerId } = await adapter.send(open);
      // If this returns false another worker took over after our send: the provider id is still logged as a
      // code-free warning so the (rare) duplicate is visible in ops.
      if (await markOutboxSent(db, row, providerId)) {
        result.sent += 1;
        await recordEmailOutcome(db, row, { sent: true });
      } else log('warn', 'notify_claim_lost_after_send', { channel: row.channel });
    } catch (err) {
      const e = err instanceof ChannelError ? err : new ChannelError('retry', 'unexpected');
      if (e.failure === 'permanent') {
        if (await markOutboxFailed(db, row, e.code)) {
          result.failed += 1;
          await recordEmailOutcome(db, row, { sent: false, code: e.code });
        }
      } else {
        const delay = e.failure === 'later' ? 86_400 : backoffSeconds(row.attempts);
        const outcome = await markOutboxRetry(db, row, { error: e.code, delaySeconds: delay });
        if (outcome === 'failed') {
          result.failed += 1;
          await recordEmailOutcome(db, row, { sent: false, code: e.code });
        } else if (outcome === 'retry') result.retried += 1;
      }
      // Codes only: never log the recipient or payload (PII, rule 16).
      log('warn', 'notify_send_failed', { channel: row.channel, code: e.code, failure: e.failure });
    }
  }
  return result;
}

export function startDispatcher(opts: {
  db: Tx;
  adapters: readonly ChannelAdapter[];
  keyring?: Keyring | null;
  intervalMs?: number;
}): {
  stop(): Promise<void>;
} {
  let running: Promise<void> | null = null;
  const state = { stopped: false };
  const tick = () => {
    if (running || state.stopped || opts.adapters.length === 0) return;
    running = (async () => {
      try {
        let r: DispatchResult;
        do {
          r = await dispatchOnce(opts.db, opts.adapters, { keyring: opts.keyring ?? null });
        } while (r.claimed > 0 && !state.stopped);
      } catch (err) {
        log('error', 'notify_dispatch_failed', safeError(err));
      }
    })().finally(() => {
      running = null;
    });
  };
  const timer = setInterval(tick, opts.intervalMs ?? 2000);
  timer.unref();
  tick();
  return {
    async stop() {
      state.stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
