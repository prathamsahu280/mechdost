import { describe, expect, it } from 'vitest';
import {
  liveTopic,
  newPings,
  nextPollDelay,
  parseLivePing,
  parseLiveTopic,
  type LivePing,
} from '../src/live';

const ID = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const ping = (v: number, id = ID): LivePing => ({
  e: 'order.status_changed',
  k: 'order',
  id,
  v,
  at: '2026-11-01T10:00:00.000Z',
});

describe('live ping contract (decision 2026-11-01)', () => {
  it('accepts exactly the five thin keys', () => {
    expect(parseLivePing(ping(3))).toEqual(ping(3));
  });

  it('rejects pings that carry data, unknown codes or bad values', () => {
    expect(parseLivePing({ ...ping(3), phone: '+919876543210' })).toBeNull();
    expect(parseLivePing({ ...ping(3), e: 'order.deleted' })).toBeNull();
    expect(parseLivePing({ ...ping(3), k: 'user' })).toBeNull();
    expect(parseLivePing({ ...ping(3), id: 'MD-RPR-2026-AAAAAA' })).toBeNull();
    expect(parseLivePing({ ...ping(3), v: 0 })).toBeNull();
    expect(parseLivePing({ ...ping(3), v: 1.5 })).toBeNull();
    expect(parseLivePing({ ...ping(3), at: 'yesterday' })).toBeNull();
    expect(parseLivePing(null)).toBeNull();
    expect(parseLivePing([ping(3)])).toBeNull();
  });

  it('builds and parses topics with uuid ids only', () => {
    expect(liveTopic('shop', ID)).toBe(`shop:${ID}`);
    expect(parseLiveTopic(`staff_city:${ID}`)).toEqual({ kind: 'staff_city', id: ID });
    expect(parseLiveTopic('admin:everything')).toBeNull();
    expect(parseLiveTopic(`shop:${ID}/../x`)).toBeNull();
    expect(() => liveTopic('order', 'not-a-uuid')).toThrow();
  });

  it('drops duplicates and out-of-order pings (at-least-once delivery)', () => {
    const seen = new Map<string, number>();
    expect(newPings(seen, [ping(2), ping(2), ping(1)]).map((p) => p.v)).toEqual([2]);
    expect(newPings(seen, [ping(4), ping(3)]).map((p) => p.v)).toEqual([4]);
    const other = '0192f3a4-5b6c-7d8e-9f01-000000000000';
    expect(newPings(seen, [ping(1, other)])).toHaveLength(1);
  });

  it('backs polling off from 15 s to 60 s while nothing changes', () => {
    expect([0, 1, 2, 3, 4, 10].map(nextPollDelay)).toEqual([15_000, 15_000, 30_000, 30_000, 60_000, 60_000]);
  });
});
