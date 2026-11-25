import { describe, expect, it } from 'vitest';
import { parseSearchQuery, tyreSizeKeys } from '../src/search';

const parse = (q: string) => parseSearchQuery(q);

describe('search by size (spec 02 "Search by size")', () => {
  it.each([
    ['90 90 12', '90/90-12'],
    ['90 90 r12', '90/90R12'],
    ['175 65 r14', '175/65R14'],
    ['175/65R14', '175/65R14'],
    ['175/65 R14', '175/65R14'],
    ['90/90-12', '90/90-12'],
  ])('reads the tyre size in "%s"', (q, size) => {
    expect(parse(q).tyreSize).toBe(size);
  });
  it('does not read other number runs as a tyre size', () => {
    expect(parse('10 20 30').tyreSize).toBeNull();
    expect(parse('exide 12 35 40').tyreSize).toBeNull();
    expect(parse('bike 2 3 12').tyreSize).toBeNull();
  });
  it('compares a size in every spelling of it', () => {
    expect(tyreSizeKeys('90/90-12')).toEqual(['9090R12', '909012']);
    expect(tyreSizeKeys('175/65R14')).toEqual(['17565R14', '1756514']);
    expect(tyreSizeKeys('3.50-10')).toEqual(['35010']);
  });
});
