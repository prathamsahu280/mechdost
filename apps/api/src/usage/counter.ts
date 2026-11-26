/**
 * Our own R2 operation counts (estimated; founder 2026-11-26). A `MediaHost` decorator counts, in memory, every call
 * that becomes a Class A or Class B request at R2 (a presigned URL counts as one, used or not, so the estimate errs
 * high: the safe side for a warning). Nothing is written on the media path: a timer flushes the tally to
 * `usage_counters` (`count + n`, so several instances add up), and a failed flush keeps the tally for the next one.
 */
import type { UsageMetricCode } from '@mechdost/shared/usage';
import { usageMonth } from '@mechdost/shared/usage';
import type { MediaHost } from '../ustaad/media/host';

type Counted = Extract<UsageMetricCode, 'r2_class_a_ops_month_count' | 'r2_class_b_ops_month_count'>;

export interface UsageCounter {
  bump: (metric: Counted, n?: number) => void;
  /** Hand the tally to `write`; on failure it is kept (added to whatever came in meanwhile). */
  flush: (
    write: (period: string, deltas: Partial<Record<Counted, number>>) => Promise<void>,
  ) => Promise<void>;
  pending: () => Partial<Record<Counted, number>>;
}

export function createUsageCounter(now: () => Date = () => new Date()): UsageCounter {
  // Keyed by month so a flush right after midnight on the 1st books the old month's calls to the old month.
  let tally = new Map<string, Partial<Record<Counted, number>>>();
  return {
    bump(metric, n = 1) {
      const period = usageMonth(now());
      const row = tally.get(period) ?? {};
      row[metric] = (row[metric] ?? 0) + n;
      tally.set(period, row);
    },
    async flush(write) {
      const taken = tally;
      tally = new Map();
      for (const [period, deltas] of taken) {
        try {
          await write(period, deltas);
        } catch (err) {
          const row = tally.get(period) ?? {};
          for (const [k, v] of Object.entries(deltas) as [Counted, number][]) row[k] = (row[k] ?? 0) + v;
          tally.set(period, row);
          throw err;
        }
      }
    },
    pending() {
      const out: Partial<Record<Counted, number>> = {};
      for (const row of tally.values())
        for (const [k, v] of Object.entries(row) as [Counted, number][]) out[k] = (out[k] ?? 0) + v;
      return out;
    },
  };
}

/** Counts R2 requests around a media host; behaviour and results are the host's own. Only for the R2 host. */
export function countingMediaHost(host: MediaHost, counter: UsageCounter): MediaHost {
  const a = () => {
    counter.bump('r2_class_a_ops_month_count');
  };
  const b = () => {
    counter.bump('r2_class_b_ops_month_count');
  };
  return {
    id: host.id,
    maxFileBytes: host.maxFileBytes,
    supportsMultipart: host.supportsMultipart,
    presignPut: (...args) => {
      a();
      return host.presignPut(...args);
    },
    createMultipart: (...args) => {
      a();
      return host.createMultipart(...args);
    },
    presignPart: (...args) => {
      a();
      return host.presignPart(...args);
    },
    completeMultipart: (...args) => {
      a();
      return host.completeMultipart(...args);
    },
    head: (...args) => {
      b();
      return host.head(...args);
    },
    getRange: (...args) => {
      b();
      return host.getRange(...args);
    },
    copy: (...args) => {
      a();
      return host.copy(...args);
    },
    presignGet: (...args) => {
      b();
      return host.presignGet(...args);
    },
    put: (...args) => {
      a();
      return host.put(...args);
    },
    // DeleteObject is free at R2.
    remove: (...args) => host.remove(...args),
  };
}
