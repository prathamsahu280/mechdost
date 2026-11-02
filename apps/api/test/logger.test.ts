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

  it('copes with non-Error values', () => {
    expect(safeError('boom')).toEqual({ errorName: 'string' });
    expect(safeError(null)).toEqual({ errorName: 'object' });
  });
});
