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

  it('adds the database error message of the wrapped cause (not the query or its parameters)', () => {
    const cause = Object.assign(new Error('column "foo" does not exist'), { code: '42703' });
    const err = new Error('Failed query: select foo from t params: +919876543210', { cause });
    const safe = safeError(err);
    expect(safe).toMatchObject({ pgCode: '42703', reason: 'column "foo" does not exist' });
    expect(JSON.stringify(safe)).not.toMatch(/919876543210|Failed query/);
  });

  it('adds the cause message of a non-Postgres failure, and hides values in data errors', () => {
    const typeError = new Error('Failed query: x', {
      cause: new TypeError('argument must be of type string'),
    });
    expect(safeError(typeError).reason).toBe('argument must be of type string');
    const bad = new Error('Failed query: x', {
      cause: Object.assign(new Error('invalid input syntax for type uuid: "+919876543210"'), {
        code: '22P02',
      }),
    });
    expect(safeError(bad).reason).not.toMatch(/919876543210/);
    expect(safeError(new Error('top-level message with +91987')).reason).toBeUndefined();
  });

  it('copes with non-Error values', () => {
    expect(safeError('boom')).toEqual({ errorName: 'string' });
    expect(safeError(null)).toEqual({ errorName: 'object' });
  });
});
