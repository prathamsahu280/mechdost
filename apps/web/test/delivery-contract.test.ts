/**
 * The delivery web seam against the merged backend contract (spec 24 § 16): the demo store's answers parse with the
 * shared schemas (so the demo and the API build serve the same shapes), and the API clients call the backend's paths
 * with its bodies (override path, application reject with version, payout idempotency key, correction `{ note }`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminAgentDetail,
  AdminAgentPage,
  AgentEarnings,
  AgentPayoutInput,
  AgentPayoutPage,
  AgentPayoutSummary,
  AgentProfile,
} from '@mechdost/shared/delivery/api';
import {
  DEMO_AGENT_IDS,
  adminAgent,
  adminAgents,
  adminPayouts,
  agentEarnings,
  agentProfile,
  correctPayout,
  payoutSummary,
  recordPayout,
} from '../src/demo/delivery-store';
import { nextPayoutKey, newPayoutKey } from '../src/lib/delivery/view';

const calls: { path: string; init: unknown }[] = [];
vi.mock('../src/lib/admin-api', () => ({
  adminApi: (_locale: string, path: string, _schema: unknown, init?: unknown) => {
    calls.push({ path, init });
    return Promise.resolve({ ok: true, data: null });
  },
}));

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
const payment = {
  agentId: A,
  amountPaise: 150_000,
  periodFrom: '2026-11-16',
  periodTo: '2026-11-22',
  method: 'upi' as const,
  reference: 'UTR123456789',
};

describe('demo delivery store speaks the shared contract', () => {
  beforeEach(() => {
    fakeWindow();
    calls.length = 0;
  });

  it('agent profile carries ratingAvgX10 + ratingCount', () => {
    const p = AgentProfile.safeParse(agentProfile(A));
    expect(p.success).toBe(true);
  });

  it('admin agent rows and detail parse (rating in tenths)', () => {
    expect(AdminAgentPage.safeParse({ items: adminAgents(), nextCursor: null }).success).toBe(true);
    expect(AdminAgentDetail.safeParse(adminAgent(A)).success).toBe(true);
  });

  it('payout rows, totals, earnings and summary parse; reversal rows are kind reversal', () => {
    expect(recordPayout({ ...payment, idempotencyKey: newPayoutKey() }).ok).toBe(true);
    const first = adminPayouts({}).items[0];
    expect(correctPayout(first?.id ?? '', 'wrong amount').ok).toBe(true);
    const page = adminPayouts({});
    expect(AgentPayoutPage.safeParse(page).success).toBe(true);
    expect(page.totalPaise).toBe(0);
    expect(page.items.find((r) => r.reversesId === first?.id)?.kind).toBe('reversal');
    const earnings = agentEarnings(A);
    expect(AgentEarnings.safeParse(earnings).success).toBe(true);
    expect(AgentPayoutSummary.safeParse({ items: payoutSummary('2026-11-01', '2026-11-30') }).success).toBe(
      true,
    );
  });

  it('the same payout key records once (double click, retry)', () => {
    const key = newPayoutKey();
    expect(recordPayout({ ...payment, idempotencyKey: key }).ok).toBe(true);
    expect(recordPayout({ ...payment, idempotencyKey: key }).ok).toBe(true);
    expect(adminPayouts({}).items).toHaveLength(1);
  });

  // Job, shop and customer views are parsed on a real demo run in `demo-delivery.test.ts` (happy path).
});

describe('payout idempotency key', () => {
  it('is accepted by AgentPayoutInput and never starts with rev-', () => {
    const key = newPayoutKey();
    expect(key.startsWith('rev-')).toBe(false);
    expect(AgentPayoutInput.safeParse({ ...payment, idempotencyKey: key }).success).toBe(true);
  });

  it('stays the same after a failed submission and renews after success', () => {
    const key = newPayoutKey();
    expect(nextPayoutKey(key, false)).toBe(key);
    const next = nextPayoutKey(key, true);
    expect(next).not.toBe(key);
    expect(AgentPayoutInput.safeParse({ ...payment, idempotencyKey: next }).success).toBe(true);
  });
});

describe('rating in tenths', () => {
  it('ratingAvgX10 ÷ 10 for display; null stays null', async () => {
    const { ratingFromX10 } = await import('../src/lib/delivery/view');
    expect(ratingFromX10(43)).toBe(4.3);
    expect(ratingFromX10(50)).toBe(5);
    expect(ratingFromX10(null)).toBeNull();
  });
});

describe('API delivery clients call the backend routes', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('override posts /override/{kind}', async () => {
    const { apiAdminDeliveryClient } = await import('../src/lib/delivery/api-clients');
    await apiAdminDeliveryClient('en').override('j1', 'pickup', 'code lost', 3);
    expect(calls[0]?.path).toBe('/admin/delivery/jobs/j1/override/pickup');
  });

  it('application reject posts to the delivery route with version', async () => {
    const { apiAdminDeliveryClient } = await import('../src/lib/delivery/api-clients');
    await apiAdminDeliveryClient('en').rejectApplication('PA-RPR-2026-ABC234', 'duplicate', 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      path: '/admin/delivery/applications/PA-RPR-2026-ABC234/reject',
      init: { method: 'POST', body: { reasonCode: 'duplicate', version: 2 } },
    });
  });

  it('record payout sends the idempotency key; correction sends { note } only', async () => {
    const { apiAdminDeliveryClient } = await import('../src/lib/delivery/api-clients');
    const c = apiAdminDeliveryClient('en');
    const key = newPayoutKey();
    await c.recordPayout({ ...payment, idempotencyKey: key });
    expect(calls[0]?.path).toBe('/admin/delivery/payouts');
    expect(AgentPayoutInput.safeParse((calls[0]?.init as { body: unknown }).body).success).toBe(true);
    await c.correctPayout('p1', 'typo');
    expect(calls[1]).toEqual({
      path: '/admin/delivery/payouts/p1/correct',
      init: { method: 'POST', body: { note: 'typo' } },
    });
  });

  it('agents and invites lists are not paged', async () => {
    const { apiAdminDeliveryClient } = await import('../src/lib/delivery/api-clients');
    const c = apiAdminDeliveryClient('en');
    await c.agents();
    await c.invites();
    expect(calls.map((x) => x.path)).toEqual(['/admin/delivery/agents', '/admin/delivery/invites']);
  });
});
