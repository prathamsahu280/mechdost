/**
 * Outage 2026-11-24: the free Upstash plan ran out of requests (500,000 a month) and every rate-limit call threw, so
 * every API route answered 500. The limiter now runs on the server's own Redis through the Upstash REST protocol
 * (SRH) with plain commands any Redis supports (the Upstash library's scripts use an Upstash-only Lua flag), and a
 * store failure no longer takes the site down: ordinary rules allow and log, `failClosed` rules (sign-in, payments)
 * still refuse.
 */
import { describe, expect, it } from 'vitest';
import { RateLimitUnavailable } from '../src/rate-limit/limiter';
import { RedisRestRateLimiter, type RedisLike } from '../src/rate-limit/redis-rest';

function fakeRedis(opts: { fail?: boolean } = {}) {
  const data = new Map<string, number>();
  const calls: string[][] = [];
  const store: RedisLike = {
    multi: () => {
      const ops: (() => unknown)[] = [];
      const tx = {
        incrby: (k: string, n: number) => {
          calls.push(['incrby', k, String(n)]);
          ops.push(() => {
            const v = (data.get(k) ?? 0) + n;
            data.set(k, v);
            return v;
          });
          return tx;
        },
        pexpire: (k: string, ms: number) => {
          calls.push(['pexpire', k, String(ms)]);
          ops.push(() => 1);
          return tx;
        },
        get: (k: string) => {
          ops.push(() => data.get(k) ?? null);
          return tx;
        },
        exec: () =>
          opts.fail
            ? Promise.reject(new Error('ERR max requests limit exceeded'))
            : Promise.resolve(ops.map((o) => o())),
      };
      return tx;
    },
    del: (...keys: string[]) => {
      if (opts.fail) return Promise.reject(new Error('down'));
      for (const k of keys) data.delete(k);
      return Promise.resolve(keys.length);
    },
  };
  return { store, data, calls };
}

const rule = { name: 'api_ip', limit: 3, windowSeconds: 60 };

describe('rate limits on our own Redis', () => {
  it('allows up to the limit in a window and refuses after, counting the weight', async () => {
    let now = 1_000_000_020_000;
    const { store } = fakeRedis();
    const rl = new RedisRestRateLimiter(store, () => now);
    expect((await rl.hit(rule, '1.2.3.4')).allowed).toBe(true);
    expect((await rl.hit(rule, '1.2.3.4', 2)).remaining).toBe(0);
    const over = await rl.hit(rule, '1.2.3.4');
    expect(over.allowed).toBe(false);
    expect(over.resetAt).toBeGreaterThan(now);
    // Another key has its own budget.
    expect((await rl.hit(rule, '5.6.7.8')).allowed).toBe(true);
    // Two windows later the old counts no longer weigh.
    now += 120_000;
    expect((await rl.hit(rule, '1.2.3.4')).allowed).toBe(true);
  });

  it('weighs the previous window by how much of it still overlaps (sliding window, no burst at the boundary)', async () => {
    let now = 1_000_000_020_000 - (1_000_000_020_000 % 60_000) + 59_000; // 1 s before the window ends
    const { store } = fakeRedis();
    const rl = new RedisRestRateLimiter(store, () => now);
    await rl.hit(rule, 'k', 3);
    now += 2_000; // 1 s into the next window: almost all of the previous window still counts
    expect((await rl.hit(rule, 'k')).allowed).toBe(false);
  });

  it('every counter key expires (no unbounded growth)', async () => {
    const { store, calls } = fakeRedis();
    const rl = new RedisRestRateLimiter(store);
    await rl.hit(rule, 'k');
    const incr = calls.find((c) => c[0] === 'incrby');
    const exp = calls.find((c) => c[0] === 'pexpire');
    expect(incr?.[1]).toBe(exp?.[1]);
    expect(Number(exp?.[2])).toBe(120_000);
    expect(incr?.[1]).toMatch(/^rl:api_ip:k:\d+$/);
  });

  it('when the store fails, ordinary rules allow (the site stays up) and fail-closed rules refuse', async () => {
    const { store } = fakeRedis({ fail: true });
    const logged: string[] = [];
    const rl = new RedisRestRateLimiter(store, Date.now, (m) => logged.push(m));
    const ok = await rl.hit(rule, 'k');
    expect(ok.allowed).toBe(true);
    expect(logged).toContain('rate_limit_store_failed');
    await expect(rl.hit({ ...rule, name: 'auth_password', failClosed: true }, 'k')).rejects.toBeInstanceOf(
      RateLimitUnavailable,
    );
    await expect(rl.reset({ ...rule, failClosed: true }, 'k')).rejects.toBeInstanceOf(RateLimitUnavailable);
    await expect(rl.reset(rule, 'k')).resolves.toBeUndefined();
  });

  it('reset forgets the key in both windows', async () => {
    const { store, data } = fakeRedis();
    const rl = new RedisRestRateLimiter(store);
    await rl.hit(rule, 'k', 3);
    await rl.reset(rule, 'k');
    expect([...data.keys()].filter((k) => k.startsWith('rl:api_ip:k:'))).toEqual([]);
    expect((await rl.hit(rule, 'k')).allowed).toBe(true);
  });
});

describe('probe-sensitive limits refuse while the store is down (security review 2026-11-24)', () => {
  it('guest support codes, partner status lookups, coupons and phone-keyed forms are fail-closed', async () => {
    const { STATUS_LOOKUP_IP, STATUS_LOOKUP_PHONE } = await import('../src/routes/shop-tools');
    const { COUPON_CHECK_IP_RATE, COUPON_CHECK_USER_RATE } = await import('../src/routes/coupons');
    const guest = await import('../src/routes/support-guest');
    const business = await import('../src/routes/business-applications');
    const partner = await import('../src/routes/partner-onboarding');
    for (const r of [
      STATUS_LOOKUP_IP,
      STATUS_LOOKUP_PHONE,
      COUPON_CHECK_IP_RATE,
      COUPON_CHECK_USER_RATE,
      guest.ACCESS_PER_IP,
      guest.ACCESS_PER_CODE,
      business.FLEET_PER_PHONE,
      partner.APPLY_PER_PHONE,
    ])
      expect(r.failClosed, r.name).toBe(true);
  });

  it('a refused fail-closed limit answers 503, not 500', async () => {
    const { handleError } = await import('../src/errors');
    const { RateLimitUnavailable: Unavailable } = await import('../src/rate-limit/limiter');
    let status = 0;
    const c = {
      get: () => 'req-1',
      json: (_body: unknown, s: number) => {
        status = s;
        return new Response();
      },
    };
    handleError(new Unavailable(), c as never);
    expect(status).toBe(503);
  });
});
