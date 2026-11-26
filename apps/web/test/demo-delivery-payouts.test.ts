/**
 * Manual agent payouts in the demo (founder ruling 2026-11-26): staff record a payment (integer paise, period, method,
 * reference); a correction is a reversing entry, never an edit; the agent sees only their own payouts and their
 * delivered-jobs count.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_AGENT_IDS,
  adminPayouts,
  agentEarnings,
  correctPayout,
  recordPayout,
} from '../src/demo/delivery-store';
import { newPayoutKey } from '../src/lib/delivery/view';

function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}

const A = DEMO_AGENT_IDS.sunil;
const B = DEMO_AGENT_IDS.deepak;
const base = {
  agentId: A,
  amountPaise: 150_000,
  periodFrom: '2026-11-16',
  periodTo: '2026-11-22',
  method: 'upi' as const,
  reference: 'UTR123456789',
};

describe('demo agent payouts', () => {
  beforeEach(() => {
    fakeWindow();
  });

  it('records a payout in paise and refuses bad input', () => {
    expect(recordPayout({ ...base, idempotencyKey: newPayoutKey() }).ok).toBe(true);
    expect(recordPayout({ ...base, idempotencyKey: newPayoutKey(), amountPaise: 0 })).toEqual({
      ok: false,
      code: 'BAD_AMOUNT',
    });
    expect(recordPayout({ ...base, idempotencyKey: newPayoutKey(), amountPaise: 10.5 })).toEqual({
      ok: false,
      code: 'BAD_AMOUNT',
    });
    expect(recordPayout({ ...base, idempotencyKey: newPayoutKey(), periodFrom: '2026-11-23' })).toEqual({
      ok: false,
      code: 'BAD_PERIOD',
    });
    expect(adminPayouts({}).items).toHaveLength(1);
  });

  it('a correction adds a reversing entry once and keeps the original', () => {
    recordPayout({ ...base, idempotencyKey: newPayoutKey() });
    const first = adminPayouts({}).items[0];
    expect(correctPayout(first?.id ?? '', 'wrong amount').ok).toBe(true);
    const rows = adminPayouts({}).items;
    expect(rows).toHaveLength(2);
    expect(rows.reduce((n, r) => n + r.amountPaise, 0)).toBe(0);
    expect(rows.find((r) => r.id === first?.id)?.corrected).toBe(true);
    expect(correctPayout(first?.id ?? '', 'again')).toEqual({ ok: false, code: 'ALREADY_CORRECTED' });
    const reversal = rows.find((r) => r.reversesId === first?.id);
    expect(correctPayout(reversal?.id ?? '', 'x')).toEqual({ ok: false, code: 'ALREADY_CORRECTED' });
  });

  it('filters by agent and the agent sees only their own payouts', () => {
    recordPayout({ ...base, idempotencyKey: newPayoutKey() });
    recordPayout({ ...base, idempotencyKey: newPayoutKey(), agentId: B, amountPaise: 90_000 });
    expect(adminPayouts({ agentId: B }).items).toHaveLength(1);
    expect(agentEarnings(A).payouts.map((p) => p.amountPaise)).toEqual([150_000]);
    expect(agentEarnings(A).deliveredJobs).toBe(0);
  });
});
