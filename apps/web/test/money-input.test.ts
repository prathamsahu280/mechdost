import { describe, expect, it } from 'vitest';
import { parseRupees } from '../src/lib/money-input';

describe('rupee input (review B4)', () => {
  it('turns typed rupees into integer paise without float error', () => {
    expect(parseRupees('1250.5')).toEqual({ ok: true, paise: 125_050 });
    expect(parseRupees('0.29')).toEqual({ ok: true, paise: 29 });
    expect(parseRupees('₹1,250')).toEqual({ ok: true, paise: 125_000 });
    expect(parseRupees('१२५०')).toEqual({ ok: true, paise: 125_000 });
  });

  it('says why a value is refused instead of producing NaN', () => {
    expect(parseRupees('.')).toEqual({ ok: false, error: 'format' });
    expect(parseRupees('1.2.3')).toEqual({ ok: false, error: 'format' });
    expect(parseRupees('12.345')).toEqual({ ok: false, error: 'format' });
    expect(parseRupees('')).toEqual({ ok: false, error: 'empty' });
    expect(parseRupees('0')).toEqual({ ok: false, error: 'zero' });
    expect(parseRupees('0', { allowZero: true })).toEqual({ ok: true, paise: 0 });
  });
});
