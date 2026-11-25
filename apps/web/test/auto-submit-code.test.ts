import { describe, expect, it } from 'vitest';
import {
  cleanCodeInput,
  decideAutoSubmit,
  manualSubmitAllowed,
  pastedCode,
  type AutoSubmitState,
} from '@/lib/auth/auto-submit-code';

const fresh = (): AutoSubmitState => ({ tried: null });
const run = (
  state: AutoSubmitState,
  value: string,
  over: { ready?: boolean; busy?: boolean; length?: number } = {},
) => decideAutoSubmit(state, { value, ready: true, busy: false, length: 6, ...over });

describe('cleanCodeInput', () => {
  it('keeps digits only and cuts to the length', () => {
    expect(cleanCodeInput('12a3 4-5678', 6)).toBe('123456');
    expect(cleanCodeInput('', 6)).toBe('');
  });
});

describe('pastedCode', () => {
  it('normalises "123 456" and "123-456"', () => {
    expect(pastedCode('123 456', 6)).toBe('123456');
    expect(pastedCode('123-456', 6)).toBe('123456');
  });
  it('finds the code inside an SMS and ignores text without one', () => {
    expect(pastedCode('Your MechDost code is 654321. Do not share.', 6)).toBe('654321');
    expect(pastedCode('12345', 6)).toBeNull();
    expect(pastedCode('abc', 4)).toBeNull();
  });
});

describe('decideAutoSubmit', () => {
  it('fires once when the full length is reached', () => {
    let s = fresh();
    for (const v of ['1', '12', '123', '1234', '12345']) {
      const d = run(s, v);
      expect(d.fire).toBe(false);
      s = d.state;
    }
    const d = run(s, '123456');
    expect(d.fire).toBe(true);
    // the same render again (state updates, other props) must not fire twice
    expect(run(d.state, '123456').fire).toBe(false);
  });

  it('does not resend the same wrong value, but does after it is edited and completed again', () => {
    let s = run(fresh(), '111111').state;
    expect(run(s, '111111').fire).toBe(false);
    s = run(s, '11111').state;
    expect(run(s, '111111').fire).toBe(true);
  });

  it('fires for a different complete value (a retyped code replaces the selected one)', () => {
    const s = run(fresh(), '111111').state;
    expect(run(s, '222222').fire).toBe(true);
  });

  it('waits while not ready, then fires exactly once when ready', () => {
    const waiting = run(fresh(), '123456', { ready: false });
    expect(waiting.fire).toBe(false);
    const go = run(waiting.state, '123456');
    expect(go.fire).toBe(true);
    expect(run(go.state, '123456').fire).toBe(false);
  });

  it('does not fire while a request is in flight and treats the value as tried', () => {
    const inflight = run(fresh(), '123456', { busy: true });
    expect(inflight.fire).toBe(false);
    // a manual Submit that failed: the busy flag ends, the same value is not auto-sent again
    expect(run(inflight.state, '123456').fire).toBe(false);
  });

  it('ignores non-digit or wrong-length values', () => {
    expect(run(fresh(), '12345a').fire).toBe(false);
    expect(run(fresh(), '1234567').fire).toBe(false);
    expect(run(fresh(), '1234', { length: 4 }).fire).toBe(true);
  });
});

/**
 * Bug found in the merged e2e run (2026-11-25): a shop typed a wrong delivery code (sent by itself), then pressed
 * "Confirm delivery" out of habit; the same wrong code went again and cost a second of the 5 tries.
 */
describe('manualSubmitAllowed', () => {
  it('refuses the value that was just sent by itself', () => {
    expect(manualSubmitAllowed({ tried: '0000' }, '0000', false)).toBe(false);
  });
  it('refuses while a check is running', () => {
    expect(manualSubmitAllowed({ tried: null }, '1234', true)).toBe(false);
  });
  it('allows a value that was not tried yet', () => {
    expect(manualSubmitAllowed({ tried: '0000' }, '1234', false)).toBe(true);
    expect(manualSubmitAllowed({ tried: null }, '1234', false)).toBe(true);
  });
});
