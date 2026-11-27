import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AgentStatsQuery } from '@mechdost/shared/delivery/agent-stats';
import { dailyCounts, istDay, payoutBars } from '@/lib/delivery/agent-stats-view';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (l: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/shared/src/i18n/${l}.json`, import.meta.url), 'utf8'),
  ) as Record<string, Record<string, string>>;

describe('rider earnings numbers (design 2026-11-27 § 7)', () => {
  it('nets a payment and its correction per period, oldest first', () => {
    expect(
      payoutBars([
        { periodFrom: '2026-11-16', amountPaise: 5_000 },
        { periodFrom: '2026-11-16', amountPaise: -5_000 },
        { periodFrom: '2026-11-01', amountPaise: 120_000 },
      ]),
    ).toEqual([
      { date: '2026-11-01', value: 120_000 },
      { date: '2026-11-16', value: 0 },
    ]);
  });
  it('counts delivered jobs per IST day, zero-filled, ending today', () => {
    const now = Date.parse('2026-11-27T20:00:00Z'); // 01:30 on the 28th in IST
    const r = dailyCounts(['2026-11-27T19:00:00Z', '2026-11-27T10:00:00Z', '2026-11-20T10:00:00Z'], 7, now);
    expect(r.days.at(-1)).toEqual({ date: '2026-11-28', delivered: 1 });
    expect(r.days.find((d) => d.date === '2026-11-27')?.delivered).toBe(1);
    expect(r.days).toHaveLength(7);
    expect(r.totalDelivered).toBe(2);
    expect(istDay('2026-11-27T18:29:59Z')).toBe('2026-11-27');
  });
});

describe('stats API contract (Q-PP-F5)', () => {
  it('days is bounded 7–90, default 14', () => {
    expect(AgentStatsQuery.parse({})).toEqual({ days: 14 });
    expect(AgentStatsQuery.safeParse({ days: '3' }).success).toBe(false);
    expect(AgentStatsQuery.safeParse({ days: '91' }).success).toBe(false);
    expect(AgentStatsQuery.parse({ days: '30' })).toEqual({ days: 30 });
  });
});

describe('rider frame', () => {
  const portal = src('components/delivery/agent-portal.tsx');
  const layout = src('app/[locale]/partner/delivery/layout.tsx');
  it('uses the partner frame with bottom tabs and keeps a page heading', () => {
    expect(portal).toMatch(/<PartnerFrame[\s\S]*portal="rider"/);
    expect(portal).not.toMatch(/function AgentTabs/);
    expect(layout).toMatch(/<h1 className="sr-only">/);
    expect(layout).not.toMatch(/PageIntro/);
    expect(layout).toMatch(/'partnerKit', 'partnerRider'/);
  });
  it('the offer card has the shared timer and the list has the new-offer sound', () => {
    expect(portal).toMatch(/<OfferTimer endsAt=\{offer\.offerExpiresAt\}/);
    expect(portal).toMatch(/useNewWorkAlert\('rider'/);
    expect(portal).toMatch(/<OrderSoundButton/);
  });
  it('every partnerRider string has Hindi', () => {
    const en = json('en');
    const hi = json('hi');
    for (const k of Object.keys(en.partnerRider ?? {})) expect(hi.partnerRider?.[k], k).toBeTruthy();
  });
});
