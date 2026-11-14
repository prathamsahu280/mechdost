import { describe, expect, it } from 'vitest';
import { diffJson } from '../src/lib/audit-diff';

describe('audit before/after diff', () => {
  it('lists added, removed and changed paths in a stable order', () => {
    expect(
      diffJson(
        { a: 1, b: { c: 'x', d: true }, gone: 1 },
        { a: 2, b: { c: 'x', d: true, e: [1, 2] }, new: 'v' },
      ),
    ).toEqual([
      { path: 'a', kind: 'changed', before: '1', after: '2' },
      { path: 'b.e', kind: 'added', before: null, after: '[1,2]' },
      { path: 'gone', kind: 'removed', before: '1', after: null },
      { path: 'new', kind: 'added', before: null, after: '"v"' },
    ]);
  });

  it('treats a missing side as empty and equal values as no change', () => {
    expect(diffJson(null, { a: 1 })).toEqual([{ path: 'a', kind: 'added', before: null, after: '1' }]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: 'a', kind: 'removed', before: '1', after: null }]);
    expect(diffJson({ a: 1, b: [1] }, { a: 1, b: [1] })).toEqual([]);
    expect(diffJson(null, null)).toEqual([]);
  });

  it('handles scalars at the top level and caps long values', () => {
    expect(diffJson('x', 'y')).toEqual([{ path: '', kind: 'changed', before: '"x"', after: '"y"' }]);
    const [row] = diffJson({ t: 'a'.repeat(500) }, { t: 'b' });
    expect(row?.before?.length).toBeLessThanOrEqual(201);
  });
});
