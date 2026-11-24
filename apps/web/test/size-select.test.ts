import { describe, expect, it } from 'vitest';
import { resolveSizeParam, withSizeParam } from '../src/lib/catalogue/size-select';

const sizes = [
  { sku: 'CEAT-145', label: '145/70 R12 69T TL' },
  { sku: 'CEAT-155', label: '155/65 R13 73T TL' },
  { sku: 'CEAT-165', label: '165/80 R14 85T TL' },
];

describe('?size= deep link', () => {
  it('matches a SKU, ignoring case', () => {
    expect(resolveSizeParam(sizes, 'ceat-155')).toBe('CEAT-155');
  });
  it('matches the size text, ignoring spaces and case', () => {
    expect(resolveSizeParam(sizes, '165/80r14 85t tl')).toBe('CEAT-165');
  });
  it('an unknown, empty or missing size gives nothing, so the page keeps its default size', () => {
    expect(resolveSizeParam(sizes, 'nope')).toBeNull();
    expect(resolveSizeParam(sizes, '')).toBeNull();
    expect(resolveSizeParam(sizes, null)).toBeNull();
  });
  it('writes the chosen size into the address without touching other parameters', () => {
    expect(withSizeParam('?utm=x', 'CEAT-155')).toBe('?utm=x&size=CEAT-155');
    expect(withSizeParam('?size=OLD&a=1', 'CEAT-155')).toBe('?size=CEAT-155&a=1');
    expect(withSizeParam('', 'CEAT-155')).toBe('?size=CEAT-155');
  });
});
