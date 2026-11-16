import { describe, expect, it } from 'vitest';
import { log, safeError, setLogSink } from '../src/logger';

/** Security review 2026-11-03: error logs never carry messages (they embed SQL parameters and request data). */
describe('safeError', () => {
  it('keeps the error class, Postgres code and stack frames, never the message', () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const err = new Error(
      'Failed query: insert into ticket_messages ... params: +919876543210,Where is my order?',
      {
        cause,
      },
    );
    const safe = safeError(err);
    expect(safe).toMatchObject({ errorName: 'Error', pgCode: '23505' });
    expect(safe.frames).toMatch(/^\s+at /);
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    log('error', 'whatsapp_bridge_failed', safe);
    expect(lines.join('\n')).not.toMatch(/919876543210|Where is my order|Failed query/);
  });

  it('adds the database error message of the wrapped cause, with every value hidden', () => {
    const cause = Object.assign(new Error('column "foo" does not exist'), { code: '42703' });
    const err = new Error('Failed query: select foo from t params: +919876543210', { cause });
    const safe = safeError(err);
    expect(safe).toMatchObject({ pgCode: '42703', reason: 'column "?" does not exist' });
    expect(JSON.stringify(safe)).not.toMatch(/919876543210|Failed query/);
    // Any class, not only data errors: quoted, parenthesised and long digit runs are hidden before the 200 cap.
    const dup = Object.assign(new Error('Key (phone)=(+919876543210) already exists. ref 4411223344'), {
      code: '23505',
    });
    const r = safeError(new Error('Failed query: x', { cause: dup })).reason ?? '';
    expect(r).not.toMatch(/9876543210|4411223344|phone/);
    const long = Object.assign(new Error(`${'x'.repeat(195)} "9876543210"`), { code: '42601' });
    expect(safeError(new Error('Failed query', { cause: long })).reason).not.toMatch(/98765/);
  });

  it('a non-Postgres cause logs only its name and code, never its message', () => {
    const typeError = new Error('Failed query: x', {
      cause: Object.assign(new TypeError('value +919876543210 must be of type string'), {
        code: 'ERR_INVALID_ARG_TYPE',
      }),
    });
    expect(safeError(typeError).reason).toBe('TypeError ERR_INVALID_ARG_TYPE');
    expect(safeError(new Error('top-level message with +91987')).reason).toBeUndefined();
  });

  it('copes with non-Error values', () => {
    expect(safeError('boom')).toEqual({ errorName: 'string' });
    expect(safeError(null)).toEqual({ errorName: 'object' });
  });
});
