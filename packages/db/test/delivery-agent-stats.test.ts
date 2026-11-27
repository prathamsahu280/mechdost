/**
 * Rider per-day stats (decision 2026-11-27 night, Q-PP-F5): actor-scoped, IST days, zero-filled, oldest first.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentDailyStats } from '../src/repo';
import * as s from '../src/schema';
import { makeAgent, makeWorld, type World } from './delivery-fixture';

let w: World;
beforeAll(async () => {
  w = await makeWorld();
});
afterAll(async () => {
  await w.close();
});

describe('agentDailyStats', () => {
  it('returns every IST day in the window, oldest first, zero when nothing was delivered', async () => {
    const agent = await makeAgent(w);
    const r = await agentDailyStats(w.t(), { userId: agent.userId, days: 7, today: '2026-11-27' });
    expect(r.days.map((d) => d.date)).toEqual([
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
    ]);
    expect(r.days.every((d) => d.delivered === 0)).toBe(true);
    expect(r.totalDelivered).toBe(0);
  });

  it('ends today in IST by default and clamps the window', async () => {
    const agent = await makeAgent(w);
    const r = await agentDailyStats(w.t(), { userId: agent.userId, days: 500 });
    expect(r.days).toHaveLength(90);
    const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(r.days.at(-1)?.date).toBe(istToday);
  });

  it('a user who is not an agent gets not-found (no one else’s numbers)', async () => {
    const user = (
      await w.db
        .insert(s.users)
        .values({
          firebaseUid: `fb-stats-${randomUUID()}`,
          phone: '+919800000001',
          phoneVerifiedAt: new Date(),
        })
        .returning()
    )[0];
    await expect(agentDailyStats(w.t(), { userId: user?.id ?? '', days: 7 })).rejects.toThrow();
  });
});
