import {
  claimOutboxBatch,
  markOutboxFailed,
  markOutboxRetry,
  markOutboxSent,
  type Channel,
  type OutboxRow,
  type Tx,
} from '@mechdost/db/repo';
import { log } from '../logger';

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

export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
}

export async function dispatchOnce(
  db: Tx,
  adapters: readonly ChannelAdapter[],
  limit = 50,
): Promise<DispatchResult> {
  const byChannel = new Map(adapters.map((a) => [a.channel, a]));
  const rows = await claimOutboxBatch(db, { channels: [...byChannel.keys()], limit });
  const result: DispatchResult = { claimed: rows.length, sent: 0, failed: 0, retried: 0 };
  for (const row of rows) {
    const adapter = byChannel.get(row.channel);
    if (!adapter) continue;
    try {
      const { providerId } = await adapter.send(row);
      await markOutboxSent(db, row.id, providerId);
      result.sent += 1;
    } catch (err) {
      const e = err instanceof ChannelError ? err : new ChannelError('retry', 'unexpected');
      if (e.failure === 'permanent') {
        await markOutboxFailed(db, row.id, e.code);
        result.failed += 1;
      } else {
        const delay = e.failure === 'later' ? 86_400 : backoffSeconds(row.attempts);
        const outcome = await markOutboxRetry(db, row.id, { error: e.code, delaySeconds: delay });
        if (outcome === 'failed') result.failed += 1;
        else result.retried += 1;
      }
      // Codes only: never log the recipient or payload (PII, rule 16).
      log('warn', 'notify_send_failed', { channel: row.channel, code: e.code, failure: e.failure });
    }
  }
  return result;
}

export function startDispatcher(opts: { db: Tx; adapters: readonly ChannelAdapter[]; intervalMs?: number }): {
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
          r = await dispatchOnce(opts.db, opts.adapters);
        } while (r.claimed > 0 && !state.stopped);
      } catch (err) {
        log('error', 'notify_dispatch_failed', { error: err instanceof Error ? err.message : String(err) });
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
