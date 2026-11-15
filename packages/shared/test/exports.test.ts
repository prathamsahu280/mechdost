import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  csvCell,
  csvLine,
  EXPORT_DATASETS,
  exportRangeError,
  exportWindow,
  paiseToRupees,
} from '../src/exports';

describe('csvCell', () => {
  it('quotes commas, quotes, CR and LF (RFC 4180) and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas with a leading apostrophe', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+91 98')).toBe("'+91 98");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@cmd|x')).toBe("'@cmd|x");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
    expect(csvCell('-5,2')).toBe(`"'-5,2"`);
  });

  it('leaves safe text, Hindi and nulls alone', () => {
    expect(csvCell('रायपुर')).toBe('रायपुर');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(true)).toBe('true');
    expect(csvCell('a-b')).toBe('a-b');
  });
});

describe('csvLine', () => {
  it('joins cells and ends with CRLF', () => {
    expect(csvLine(['a', 'b,c', null])).toBe('a,"b,c",\r\n');
  });
  it('has a UTF-8 BOM constant for Excel', () => {
    // Compare by code point: a source-level literal or escape slip must not pass both sides alike.
    expect(CSV_BOM.length).toBe(1);
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff);
    expect(Buffer.from(CSV_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe('paiseToRupees', () => {
  it('formats integer paise exactly, without floats', () => {
    expect(paiseToRupees(0)).toBe('0.00');
    expect(paiseToRupees(5)).toBe('0.05');
    expect(paiseToRupees(100)).toBe('1.00');
    expect(paiseToRupees(123456)).toBe('1234.56');
    expect(paiseToRupees(-250)).toBe('-2.50');
    expect(paiseToRupees(9007199254740991)).toBe('90071992547409.91');
    expect(paiseToRupees(BigInt('99999999999999999'))).toBe('999999999999999.99');
  });
  it('rejects non-integers and null stays empty', () => {
    expect(() => paiseToRupees(1.5)).toThrow();
    expect(paiseToRupees(null)).toBe('');
  });
});

describe('exportWindow', () => {
  it('runs from the IST start of the first day to the IST start of the day after the last', () => {
    const w = exportWindow('2026-11-01', '2026-11-02');
    expect(w.start.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-02T18:30:00.000Z');
  });
});

describe('exportRangeError', () => {
  it('accepts up to 180 days inclusive and refuses the rest', () => {
    expect(exportRangeError('2026-11-01', '2026-11-15')).toBeNull();
    expect(exportRangeError('2026-11-15', '2026-11-15')).toBeNull();
    expect(exportRangeError('2026-05-20', '2026-11-15')).toBeNull();
    expect(exportRangeError('2026-05-19', '2026-11-15')).toBe('RANGE_TOO_LONG');
    expect(exportRangeError('2026-11-16', '2026-11-15')).toBe('RANGE_ORDER');
    expect(exportRangeError('2026-02-30', '2026-03-01')).toBe('RANGE_DATE');
  });
});

describe('catalogue', () => {
  it('lists the seven datasets', () => {
    expect([...EXPORT_DATASETS]).toEqual([
      'orders',
      'sub_orders',
      'refunds',
      'service_requests',
      'partners',
      'customers',
      'coupon_usage',
    ]);
  });
});
