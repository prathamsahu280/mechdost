import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import { startTiming } from '../src/lib/auth/auth-timing';

function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('auth timing', () => {
  it('adds up each stage, totals the attempt and matches the shared event schema', async () => {
    const c = clock();
    const timing = startTiming('staff_code', c.now);
    await timing.stage('botCheckMs', () => {
      c.advance(120.4);
      return Promise.resolve();
    });
    await timing.stage('apiMs', () => {
      c.advance(800);
      return Promise.resolve();
    });
    await timing.stage('apiMs', () => {
      c.advance(200); // a retry adds to the same stage
      return Promise.resolve();
    });
    timing.challengeShown();
    timing.botCheckSkipped();
    c.advance(50);
    const props = timing.done('ok');
    expect(props).toEqual({
      flow: 'staff_code',
      outcome: 'ok',
      botCheckMs: 120,
      apiMs: 1000,
      totalMs: 1170,
      challengeShown: true,
      botCheckSkipped: true,
    });
    expect(CLIENT_EVENT_SCHEMAS.auth_timing.safeParse({ ...props, path: '/login' }).success).toBe(true);
  });

  it('still counts a stage whose work throws, and leaves out stages that never ran', async () => {
    const c = clock();
    const timing = startTiming('password', c.now);
    await expect(
      timing.stage('apiMs', () => {
        c.advance(300);
        return Promise.reject(new Error('network'));
      }),
    ).rejects.toThrow('network');
    const props = timing.done('error');
    expect(props.apiMs).toBe(300);
    expect('smsSendMs' in props).toBe(false);
  });

  it('the event refuses extra fields and impossible numbers', () => {
    const ok = {
      flow: 'password',
      outcome: 'ok',
      totalMs: 5,
      challengeShown: false,
      botCheckSkipped: false,
      path: '/login',
    };
    expect(CLIENT_EVENT_SCHEMAS.auth_timing.safeParse(ok).success).toBe(true);
    expect(CLIENT_EVENT_SCHEMAS.auth_timing.safeParse({ ...ok, phone: '+919000000005' }).success).toBe(false);
    expect(CLIENT_EVENT_SCHEMAS.auth_timing.safeParse({ ...ok, totalMs: -1 }).success).toBe(false);
    expect(CLIENT_EVENT_SCHEMAS.auth_timing.safeParse({ ...ok, flow: 'other' }).success).toBe(false);
  });
});
